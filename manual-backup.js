import {captureTenantSnapshot,encryptTenantBackup} from './backup-core.js';
import {backupConfigurationStatus,storeEncryptedTenantBackup,pruneTenantBackups} from './backup-store.js';

export async function createManualTenantBackup(env,tenantId,{createdAt=new Date().toISOString(),dependencies={}}={}){
 const configuration=backupConfigurationStatus(env);if(!configuration.configured)throw Error('Unabhängiger Sicherungsspeicher und Serverschlüssel sind noch nicht vollständig eingerichtet.');
 const capture=dependencies.captureTenantSnapshot||captureTenantSnapshot,encrypt=dependencies.encryptTenantBackup||encryptTenantBackup,store=dependencies.storeEncryptedTenantBackup||storeEncryptedTenantBackup,prune=dependencies.pruneTenantBackups||pruneTenantBackups;
 const snapshot=await capture(env,tenantId,{createdAt}),envelope=await encrypt(snapshot,env.TENANT_BACKUP_SECRET,{createdAt});
 const stored=await store(env.TENANT_BACKUP_STORE,tenantId,envelope,{reason:'manual'}),retention=await prune(env.TENANT_BACKUP_STORE,tenantId,configuration.retention);
 return {createdAt:stored.createdAt,reason:'manual',backupId:stored.backupId,retained:retention.kept.length,removed:retention.removed.length,encrypted:true,complete:true};
}
