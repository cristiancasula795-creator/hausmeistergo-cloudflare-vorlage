import {decryptTenantBackup,validateTenantSnapshot} from './backup-core.js';
import {backupConfigurationStatus,listCompleteTenantBackups,loadEncryptedTenantBackup} from './backup-store.js';

export async function verifyTenantBackupIntegrity(env,tenantId,{dependencies={}}={}){
 const configuration=backupConfigurationStatus(env);if(!configuration.configured)throw Error('Unabhängiger Sicherungsspeicher und Serverschlüssel sind noch nicht vollständig eingerichtet.');
 const list=dependencies.listCompleteTenantBackups||listCompleteTenantBackups,load=dependencies.loadEncryptedTenantBackup||loadEncryptedTenantBackup,decrypt=dependencies.decryptTenantBackup||decryptTenantBackup,backups=await list(env.TENANT_BACKUP_STORE,tenantId),results=[];
 for(const backup of backups){try{const loaded=await load(env.TENANT_BACKUP_STORE,backup.manifestKey),snapshot=validateTenantSnapshot(await decrypt(loaded.envelope,env.TENANT_BACKUP_SECRET));if(snapshot.tenantId!==tenantId)throw Error('tenant mismatch');const totalRows=Object.values(snapshot.tables).reduce((sum,rows)=>sum+rows.length,0);results.push({backupId:backup.backupId,createdAt:backup.createdAt,reason:backup.reason==='manual'?'manual':'daily',valid:true,totalRows});}catch{results.push({backupId:backup.backupId,createdAt:backup.createdAt,reason:backup.reason==='manual'?'manual':'daily',valid:false,totalRows:null});}}
 return {action:'integrity-check-only',checkedAt:new Date().toISOString(),total:results.length,valid:results.filter(row=>row.valid).length,invalid:results.filter(row=>!row.valid).length,backups:results};
}
