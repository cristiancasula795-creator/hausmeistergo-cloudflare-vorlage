const encoder=new TextEncoder(),decoder=new TextDecoder();
const bytes=value=>typeof value==='string'?encoder.encode(value):value;
const base64=value=>{let binary='';for(let offset=0;offset<value.length;offset+=32768)binary+=String.fromCharCode(...value.subarray(offset,offset+32768));return btoa(binary);};
const unbase64=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
const hex=value=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');

export const BACKUP_SCHEMA='hausmeister-pro-tenant-backup';
export const BACKUP_VERSION=1;
export const BACKUP_CIPHER='AES-256-GCM/HKDF-SHA-256';
export const TENANT_BACKUP_TABLES=Object.freeze([
 'tenants','tenant_memberships','records','photo_chunks','tenant_storage_usage',
 'customers','customer_sites','customer_sequences','service_catalog',
 'invoices','invoice_lines','invoice_source_claims','invoice_payments','invoice_reminders','invoice_sequences','estimates','estimate_lines','estimate_sequences','order_confirmations','order_confirmation_lines','order_confirmation_sequences','credit_notes','credit_note_lines','credit_note_sequences',
 'business_document_parties','incoming_einvoices',
 'business_settings','dispatch_jobs','audit_events','translation_cache','translation_tenant_daily_usage',
 'tenant_environments',
]);
// These document tables were added after version-1 backups already existed.
// Missing additive tables in such a backup are losslessly equivalent to empty
// tables. Every older core table remains mandatory so damaged backups still fail.
export const ADDITIVE_BACKUP_TABLES=Object.freeze([
 'order_confirmations','order_confirmation_lines','order_confirmation_sequences',
 'credit_notes','credit_note_lines','credit_note_sequences',
 'business_document_parties','incoming_einvoices',
]);
export const EPHEMERAL_TABLES=Object.freeze([
 'sessions','password_resets','user_email_activations','login_throttles','photo_share_tokens',
 'registration_invites','registration_request_limits','translation_daily_usage','security_events',
]);

async function keyFor(secret,salt){
 if(String(secret||'').length<32)throw Error('Der Sicherungsschlüssel muss mindestens 32 Zeichen lang sein.');
 const material=await crypto.subtle.importKey('raw',bytes(String(secret)),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:bytes('Hausmeister Pro tenant backup v1')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const random=count=>crypto.getRandomValues(new Uint8Array(count));

export async function encryptTenantBackup(snapshot,secret,{randomBytes=random,createdAt=new Date().toISOString()}={}){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw Error('Ungültiger Sicherungsinhalt.');
 const plaintext=bytes(JSON.stringify(snapshot)),salt=randomBytes(32),iv=randomBytes(12),key=await keyFor(secret,salt);
 const additionalData=bytes(`${BACKUP_SCHEMA}\n${BACKUP_VERSION}\n${createdAt}`);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,plaintext));
 const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',plaintext)));
 return {schema:BACKUP_SCHEMA,version:BACKUP_VERSION,cipher:BACKUP_CIPHER,createdAt,plainBytes:plaintext.length,plainSha256:digest,salt:base64(salt),iv:base64(iv),payload:base64(encrypted)};
}

export async function decryptTenantBackup(envelope,secret){
 if(!envelope||envelope.schema!==BACKUP_SCHEMA||envelope.version!==BACKUP_VERSION||envelope.cipher!==BACKUP_CIPHER)throw Error('Unbekanntes Sicherungsformat.');
 if(!envelope.createdAt||!envelope.salt||!envelope.iv||!envelope.payload)throw Error('Sicherung ist unvollständig.');
 try{
  const salt=unbase64(envelope.salt),iv=unbase64(envelope.iv),encrypted=unbase64(envelope.payload),key=await keyFor(secret,salt),additionalData=bytes(`${BACKUP_SCHEMA}\n${BACKUP_VERSION}\n${envelope.createdAt}`);
  const plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,encrypted));
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',plaintext)));
  if(plaintext.length!==Number(envelope.plainBytes)||digest!==envelope.plainSha256)throw Error('Prüfsumme stimmt nicht.');
  return JSON.parse(decoder.decode(plaintext));
 }catch(error){throw Error('Sicherungsschlüssel ist falsch oder die Sicherung wurde verändert.');}
}

export function splitTenantBackup(envelope,maxChars=900000){
 if(!Number.isInteger(maxChars)||maxChars<1024)throw Error('Ungültige Teilstückgröße.');
 const {payload,...metadata}=envelope,chunks=[];
 for(let offset=0;offset<payload.length;offset+=maxChars)chunks.push(payload.slice(offset,offset+maxChars));
 return {metadata:{...metadata,chunks:chunks.length,payloadChars:payload.length},chunks};
}

export function joinTenantBackup(metadata,chunks){
 if(!metadata||!Array.isArray(chunks)||chunks.length!==metadata.chunks)throw Error('Sicherungsteile fehlen.');
 const payload=chunks.join('');
 if(payload.length!==metadata.payloadChars)throw Error('Sicherungsteile sind unvollständig.');
 const {chunks:_chunks,payloadChars:_payloadChars,...rest}=metadata;
 return {...rest,payload};
}

export function retentionSelection(backups,{daily=7,manual=3}={}){
 const ordered=[...backups].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),kept=[],dailyDays=new Set();let manualCount=0;
 for(const backup of ordered){
  if(backup.reason==='manual'){if(manualCount++<manual)kept.push(backup);continue;}
  const day=String(backup.createdAt).slice(0,10);if(!dailyDays.has(day)&&dailyDays.size<daily){dailyDays.add(day);kept.push(backup);}
 }
 return kept;
}

const tenantColumn=table=>table==='tenants'?'id':'tenant_id';
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw Error('Ungültiger Datenbankbezeichner.');return `"${value}"`;};
const canonicalRow=row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]));
const canonicalRows=rows=>rows.map(canonicalRow).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));

export function validateTenantSnapshot(snapshot){
 if(!snapshot||snapshot.schema!==BACKUP_SCHEMA||snapshot.version!==BACKUP_VERSION)throw Error('Unbekannter Firmen-Sicherungsstand.');
 const tenantId=String(snapshot.tenantId||'').trim();if(!tenantId)throw Error('Firmenkennung fehlt in der Sicherung.');
 if(!snapshot.tables||typeof snapshot.tables!=='object'||Array.isArray(snapshot.tables))throw Error('Tabelleninhalt fehlt in der Sicherung.');
 for(const name of Object.keys(snapshot.tables))if(!TENANT_BACKUP_TABLES.includes(name))throw Error(`Nicht erlaubte Sicherungstabelle: ${name}`);
 for(const name of TENANT_BACKUP_TABLES){
  if(snapshot.tables[name]===undefined&&ADDITIVE_BACKUP_TABLES.includes(name))snapshot.tables[name]=[];
  const rows=snapshot.tables[name];if(!Array.isArray(rows))throw Error(`Sicherungstabelle fehlt: ${name}`);
  const key=tenantColumn(name);for(const row of rows){
   if(!row||typeof row!=='object'||String(row[key])!==tenantId)throw Error(`Fremde Firmendaten in Tabelle ${name}.`);
   if(name==='incoming_einvoices'&&row.retention_until==null){const year=new Date(Number(row.uploaded_at)||Date.now()).getUTCFullYear();row.invoice_date=row.invoice_date||null;row.retention_until=Date.UTC(year+9,0,1)-1;}
  }
 }
 if(snapshot.tables.tenants.length!==1)throw Error('Die Sicherung muss genau eine Firma enthalten.');
 return snapshot;
}

export async function captureTenantSnapshot(env,tenantId,{createdAt=new Date().toISOString()}={}){
 tenantId=String(tenantId||'').trim();if(!tenantId)throw Error('Firmenkennung fehlt.');
 const tables={};
 for(const table of TENANT_BACKUP_TABLES){
  const key=tenantColumn(table),rows=await env.DB.prepare(`SELECT * FROM ${identifier(table)} WHERE ${identifier(key)}=?`).bind(tenantId).all();
  tables[table]=canonicalRows(rows.results||[]);
 }
 return validateTenantSnapshot({schema:BACKUP_SCHEMA,version:BACKUP_VERSION,scope:'tenant',tenantId,createdAt,tables});
}

async function columnsFor(env,table){
 const rows=await env.DB.prepare(`PRAGMA table_info(${identifier(table)})`).all(),columns=(rows.results||[]).map(row=>String(row.name));
 if(!columns.length)throw Error(`Sicherungstabelle ist nicht vorhanden: ${table}`);
 return new Set(columns);
}

export async function restoreTenantSnapshot(env,snapshot){
 validateTenantSnapshot(snapshot);const tenantId=snapshot.tenantId;
 const existing=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first();
 if(existing)throw Error('Die Zielfirma existiert bereits. Eine Wiederherstellung darf sie nicht still überschreiben.');
 const prepared=[];
 for(const table of TENANT_BACKUP_TABLES){
  const allowed=await columnsFor(env,table),rows=snapshot.tables[table],statements=[];
  for(const row of rows){
   const columns=Object.keys(row);if(!columns.length)throw Error(`Leere Zeile in Sicherungstabelle ${table}.`);
   for(const column of columns)if(!allowed.has(column))throw Error(`Unbekannte Spalte ${table}.${column}.`);
   const names=columns.map(identifier).join(','),values=columns.map(()=>'?').join(',');
   statements.push(env.DB.prepare(`INSERT INTO ${identifier(table)}(${names}) VALUES(${values})`).bind(...columns.map(column=>row[column])));
  }
  prepared.push({table,statements});
 }
 const cleanup=async()=>{
  const statements=[...TENANT_BACKUP_TABLES].reverse().map(table=>env.DB.prepare(`DELETE FROM ${identifier(table)} WHERE ${identifier(tenantColumn(table))}=?`).bind(tenantId));
  await env.DB.batch(statements);
 };
 try{
  for(const {statements} of prepared)for(let offset=0;offset<statements.length;offset+=50)await env.DB.batch(statements.slice(offset,offset+50));
  const restored=await captureTenantSnapshot(env,tenantId,{createdAt:snapshot.createdAt});
  const expected=Object.fromEntries(TENANT_BACKUP_TABLES.map(table=>[table,canonicalRows(snapshot.tables[table])]));
  if(JSON.stringify(restored.tables)!==JSON.stringify(expected))throw Error('Wiederherstellungsprüfung stimmt nicht mit der Sicherung überein.');
  return restored;
 }catch(error){
  try{await cleanup();}
  catch(rollbackError){throw Error(`Wiederherstellung fehlgeschlagen und der unvollständige Stand konnte nicht automatisch entfernt werden: ${rollbackError.message||rollbackError}`,{cause:error});}
  throw Error(`Wiederherstellung fehlgeschlagen; der unvollständige Stand wurde vollständig entfernt: ${error.message||error}`,{cause:error});
 }
}
