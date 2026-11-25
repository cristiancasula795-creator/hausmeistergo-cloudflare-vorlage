import {BACKUP_SCHEMA,BACKUP_VERSION,splitTenantBackup,joinTenantBackup,retentionSelection} from './backup-core.js';

const encoder=new TextEncoder(),decoder=new TextDecoder();
const jsonBytes=value=>encoder.encode(JSON.stringify(value));
const parsed=async object=>{
 if(!object)throw Error('Sicherungsdatei fehlt im unabhängigen Speicher.');
 const text=typeof object.text==='function'?await object.text():decoder.decode(await object.arrayBuffer());
 try{return JSON.parse(text);}catch{throw Error('Sicherungsdatei ist nicht lesbar.');}
};
const safeReason=value=>value==='manual'?'manual':'daily';
const safeStamp=value=>String(value||'').replace(/[^0-9A-Za-z.-]/g,'-').slice(0,80);
const hex=value=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
const sha256=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(String(value)))));

export async function tenantBackupPrefix(tenantId){
 tenantId=String(tenantId||'').trim();if(!tenantId)throw Error('Firmenkennung fehlt.');
 return `tenant-backups/${await sha256(tenantId)}/`;
}

export function backupConfigurationStatus(env){
 const externalStore=!!env?.TENANT_BACKUP_STORE,encryptionKey=String(env?.TENANT_BACKUP_SECRET||'').length>=32;
 const configured=externalStore&&encryptionKey,automatic=configured&&String(env?.TENANT_BACKUP_AUTOMATIC||'')==='enabled',restoreEnabled=configured&&String(env?.TENANT_BACKUP_RESTORE||'')==='enabled';return {configured,externalStore,encryptionKey,manualCreateEnabled:configured,automatic,restoreEnabled,retention:{daily:7,manual:3},mode:automatic&&restoreEnabled?'live':'prepared-not-live'};
}

export async function storeEncryptedTenantBackup(store,tenantId,envelope,{reason='daily',maxChars=900000,backupId=crypto.randomUUID()}={}){
 if(!store?.put||!store?.delete)throw Error('Unabhängiger Sicherungsspeicher ist nicht eingerichtet.');
 if(envelope?.schema!==BACKUP_SCHEMA||envelope?.version!==BACKUP_VERSION)throw Error('Unbekanntes Sicherungsformat.');
 const prefix=await tenantBackupPrefix(tenantId),createdAt=String(envelope.createdAt||''),id=`${safeStamp(createdAt)}-${safeStamp(backupId)}`;
 if(!createdAt||!safeStamp(backupId))throw Error('Sicherungskennung ist unvollständig.');
 const split=splitTenantBackup(envelope,maxChars),written=[],chunkKeys=split.chunks.map((_,index)=>`${prefix}${id}/part-${String(index+1).padStart(5,'0')}.txt`),manifestKey=`${prefix}${id}.complete.json`;
 try{
  for(let index=0;index<split.chunks.length;index++){
   await store.put(chunkKeys[index],split.chunks[index],{httpMetadata:{contentType:'text/plain; charset=utf-8'}});written.push(chunkKeys[index]);
  }
  const manifest={schema:BACKUP_SCHEMA,version:BACKUP_VERSION,kind:'complete-tenant-backup',backupId:id,createdAt,reason:safeReason(reason),metadata:split.metadata,chunkKeys};
  await store.put(manifestKey,jsonBytes(manifest),{httpMetadata:{contentType:'application/json'}});written.push(manifestKey);
  return {...manifest,manifestKey};
 }catch(error){
  try{if(written.length)await store.delete(written);}catch{}
  throw Error(`Sicherung konnte nicht vollständig in den unabhängigen Speicher geschrieben werden: ${error.message||error}`,{cause:error});
 }
}

function validateManifest(manifest,manifestKey){
 if(manifest?.schema!==BACKUP_SCHEMA||manifest?.version!==BACKUP_VERSION||manifest?.kind!=='complete-tenant-backup'||!Array.isArray(manifest.chunkKeys))throw Error('Abschlussdatei der Sicherung ist ungültig.');
 if(manifest.chunkKeys.length!==manifest.metadata?.chunks||!manifest.chunkKeys.length)throw Error('Abschlussdatei und Sicherungsteile passen nicht zusammen.');
 const base=String(manifestKey||'').replace(/\.complete\.json$/,'/');
 if(!base||base===manifestKey)throw Error('Pfad der Abschlussdatei ist ungültig.');
 for(let index=0;index<manifest.chunkKeys.length;index++)if(manifest.chunkKeys[index]!==`${base}part-${String(index+1).padStart(5,'0')}.txt`)throw Error('Abschlussdatei verweist auf fremde oder ungeordnete Sicherungsteile.');
 return manifest;
}

export async function loadEncryptedTenantBackup(store,manifestKey){
 if(!store?.get)throw Error('Unabhängiger Sicherungsspeicher ist nicht eingerichtet.');
 const manifest=validateManifest(await parsed(await store.get(manifestKey)),manifestKey);
 const chunks=[];for(const key of manifest.chunkKeys){const object=await store.get(key);if(!object)throw Error('Sicherungsteile fehlen im unabhängigen Speicher.');chunks.push(typeof object.text==='function'?await object.text():decoder.decode(await object.arrayBuffer()));}
 return {manifest,envelope:joinTenantBackup(manifest.metadata,chunks)};
}

async function listAll(store,prefix){
 const objects=[];let cursor;
 do{const page=await store.list({prefix,cursor});objects.push(...(page.objects||[]));cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return objects;
}

export async function listCompleteTenantBackups(store,tenantId){
 if(!store?.list||!store?.get)throw Error('Unabhängiger Sicherungsspeicher ist nicht eingerichtet.');
 const prefix=await tenantBackupPrefix(tenantId),objects=await listAll(store,prefix),results=[];
 for(const object of objects.filter(item=>String(item.key||'').endsWith('.complete.json'))){
  try{const manifest=validateManifest(await parsed(await store.get(object.key)),object.key);results.push({...manifest,manifestKey:object.key});}catch{}
 }
 return results.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function pruneTenantBackups(store,tenantId,limits={daily:7,manual:3}){
 const complete=await listCompleteTenantBackups(store,tenantId),kept=retentionSelection(complete,limits),keep=new Set(kept.map(item=>item.manifestKey)),removed=[];
 for(const backup of complete){if(keep.has(backup.manifestKey))continue;await store.delete([...backup.chunkKeys,backup.manifestKey]);removed.push(backup.manifestKey);}
 return {kept,removed};
}
