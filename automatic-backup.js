import {captureTenantSnapshot,encryptTenantBackup} from './backup-core.js';
import {backupConfigurationStatus,storeEncryptedTenantBackup,pruneTenantBackups} from './backup-store.js';

export async function createDailyTenantBackup(env,tenantId,{createdAt=new Date().toISOString(),dependencies={}}={}){
 const configuration=backupConfigurationStatus(env);if(!configuration.automatic)throw Error('Automatische Serversicherung ist nicht freigeschaltet.');
 const capture=dependencies.captureTenantSnapshot||captureTenantSnapshot,encrypt=dependencies.encryptTenantBackup||encryptTenantBackup,store=dependencies.storeEncryptedTenantBackup||storeEncryptedTenantBackup,prune=dependencies.pruneTenantBackups||pruneTenantBackups;
 const snapshot=await capture(env,tenantId,{createdAt}),envelope=await encrypt(snapshot,env.TENANT_BACKUP_SECRET,{createdAt}),stored=await store(env.TENANT_BACKUP_STORE,tenantId,envelope,{reason:'daily'}),retention=await prune(env.TENANT_BACKUP_STORE,tenantId,configuration.retention);
 return {tenantId,createdAt:stored.createdAt,reason:'daily',backupId:stored.backupId,retained:retention.kept.length,removed:retention.removed.length,encrypted:true,complete:true};
}

export async function runAutomaticTenantBackups(env,{createdAt=new Date().toISOString(),dependencies={}}={}){
 const configuration=backupConfigurationStatus(env);if(!configuration.automatic)return {enabled:false,created:[],failed:[]};
 const listTenants=dependencies.listTenants||(async target=>(await target.DB.prepare('SELECT id FROM tenants ORDER BY id').all()).results||[]),create=dependencies.createDailyTenantBackup||createDailyTenantBackup;
 const tenants=await listTenants(env),created=[],failed=[];
 for(const row of tenants){const tenantId=String(row?.id||'').trim();if(!tenantId)continue;try{const result=await create(env,tenantId,{createdAt,dependencies});created.push({tenantId,backupId:result.backupId,createdAt:result.createdAt});}catch(error){failed.push({tenantId,error:'backup_failed'});}}
 return {enabled:true,created,failed};
}
