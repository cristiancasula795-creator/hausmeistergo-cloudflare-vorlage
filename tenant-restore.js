import {TENANT_BACKUP_TABLES,captureTenantSnapshot,decryptTenantBackup,encryptTenantBackup,restoreTenantSnapshot,validateTenantSnapshot} from './backup-core.js';
import {backupConfigurationStatus,listCompleteTenantBackups,loadEncryptedTenantBackup,pruneTenantBackups,storeEncryptedTenantBackup} from './backup-store.js';

const tenantColumn=table=>table==='tenants'?'id':'tenant_id';
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw Error('Ungültiger Datenbankbezeichner.');return `"${value}"`;};
const clean=value=>String(value||'').trim();

export async function deletePortableTenantData(env,tenantId){
 const statements=[...TENANT_BACKUP_TABLES].reverse().map(table=>env.DB.prepare(`DELETE FROM ${identifier(table)} WHERE ${identifier(tenantColumn(table))}=?`).bind(tenantId));
 await env.DB.batch(statements);
}

export async function invalidateRestoredTenantSessions(env,tenantId){
 await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id=?)').bind(tenantId),
  env.DB.prepare('DELETE FROM photo_share_tokens WHERE tenant_id=?').bind(tenantId),
 ]);
}

async function storeSafetyBackup(env,tenantId,snapshot,createdAt,dependencies){
 const encrypt=dependencies.encryptTenantBackup||encryptTenantBackup,store=dependencies.storeEncryptedTenantBackup||storeEncryptedTenantBackup,prune=dependencies.pruneTenantBackups||pruneTenantBackups,envelope=await encrypt(snapshot,env.TENANT_BACKUP_SECRET,{createdAt}),stored=await store(env.TENANT_BACKUP_STORE,tenantId,envelope,{reason:'manual'}),retention=await prune(env.TENANT_BACKUP_STORE,tenantId,backupConfigurationStatus(env).retention);
 return {backupId:stored.backupId,createdAt:stored.createdAt,retained:retention.kept.length,removed:retention.removed.length};
}

export async function replaceTenantFromBackup(env,tenantId,{backupId,confirmation,createdAt=new Date().toISOString(),dependencies={}}={}){
 const configuration=backupConfigurationStatus(env),restoreEngineEnabled=configuration.configured&&String(env?.TENANT_BACKUP_RESTORE||'')==='enabled';if(!restoreEngineEnabled)throw Error('Wiederherstellung ist noch nicht ausdrücklich freigeschaltet.');
 tenantId=clean(tenantId);backupId=clean(backupId);confirmation=clean(confirmation);if(!tenantId||!backupId)throw Error('Firma oder Sicherung fehlt.');
 const list=dependencies.listCompleteTenantBackups||listCompleteTenantBackups,load=dependencies.loadEncryptedTenantBackup||loadEncryptedTenantBackup,decrypt=dependencies.decryptTenantBackup||decryptTenantBackup,capture=dependencies.captureTenantSnapshot||captureTenantSnapshot,remove=dependencies.deletePortableTenantData||deletePortableTenantData,restore=dependencies.restoreTenantSnapshot||restoreTenantSnapshot,invalidate=dependencies.invalidateRestoredTenantSessions||invalidateRestoredTenantSessions;
 const selected=(await list(env.TENANT_BACKUP_STORE,tenantId)).find(item=>item.backupId===backupId);if(!selected)throw Error('Die ausgewählte vollständige Sicherung wurde nicht gefunden.');
 const target=validateTenantSnapshot(await decrypt((await load(env.TENANT_BACKUP_STORE,selected.manifestKey)).envelope,env.TENANT_BACKUP_SECRET));if(target.tenantId!==tenantId)throw Error('Die Sicherung gehört nicht zum gewählten Firmenbereich.');
 const companyName=clean(target.tables.tenants[0]?.name);if(!companyName||confirmation!==companyName)throw Error('Der Firmenname wurde nicht exakt bestätigt.');
 const current=await capture(env,tenantId,{createdAt}),safety=dependencies.storeSafetyBackup?await dependencies.storeSafetyBackup(env,tenantId,current,createdAt):await storeSafetyBackup(env,tenantId,current,createdAt,dependencies);
 await remove(env,tenantId);
 try{await restore(env,target);await invalidate(env,tenantId);return {restored:true,tenantId,sourceBackupId:selected.backupId,sourceCreatedAt:selected.createdAt,safetyBackupId:safety.backupId,safetyCreatedAt:safety.createdAt,sessionsInvalidated:true};}
 catch(error){
  try{await remove(env,tenantId);await restore(env,current);await invalidate(env,tenantId);}
  catch(rollbackError){throw Error(`Wiederherstellung und automatische Rücknahme sind fehlgeschlagen: ${rollbackError.message||rollbackError}`,{cause:error});}
  throw Error(`Wiederherstellung fehlgeschlagen; der vorherige Firmenstand wurde aus der frischen Vorsicherung vollständig zurückgesetzt: ${error.message||error}`,{cause:error});
 }
}
