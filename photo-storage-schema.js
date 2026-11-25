const columnNames=rows=>new Set((rows?.results||[]).map(row=>String(row.name||'')));

async function addMissingColumn(env,table,column,definition){
 const read=()=>env.DB.prepare(`PRAGMA table_info('${table}')`).all();
 if(columnNames(await read()).has(column))return false;
 try{await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();}
 catch(error){
  // Two fresh Worker instances can discover the same legacy schema at once.
  // A concurrent successful ALTER is harmless; every other error stays fatal.
  if(!columnNames(await read()).has(column))throw error;
 }
 return true;
}

let schemaFlight=null;
export async function ensurePhotoStorageSchema(env){
 if(schemaFlight)return schemaFlight;
 schemaFlight=(async()=>{
  await env.DB.batch([
   env.DB.prepare('CREATE TABLE IF NOT EXISTS photo_share_tokens (token_hash TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,photo_key TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)'),
   env.DB.prepare('CREATE TABLE IF NOT EXISTS photo_chunks (tenant_id TEXT NOT NULL,photo_key TEXT NOT NULL,chunk_index INTEGER NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,photo_key,chunk_index))')
  ]);
  await addMissingColumn(env,'photo_share_tokens','expires_at','INTEGER');
  await addMissingColumn(env,'photo_chunks','created_at','INTEGER NOT NULL DEFAULT 0');
  await env.DB.batch([
   env.DB.prepare('UPDATE photo_share_tokens SET expires_at=created_at+2592000000 WHERE expires_at IS NULL'),
   env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_photo_share_tokens_expiry ON photo_share_tokens(expires_at)'),
   env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_photo_chunks_tenant_created ON photo_chunks(tenant_id,created_at)')
  ]);
  return true;
 })();
 try{return await schemaFlight;}catch(error){schemaFlight=null;throw error;}
}

export function resetPhotoStorageSchemaForTest(){schemaFlight=null;}
