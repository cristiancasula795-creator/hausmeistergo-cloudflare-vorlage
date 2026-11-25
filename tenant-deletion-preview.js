import {TENANT_BACKUP_TABLES} from './backup-core.js';
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw Error('Ungültiger Datenbankbezeichner.');return `"${value}"`;};
const tenantColumn=table=>table==='tenants'?'id':'tenant_id';
const number=row=>Number(row?.n||0);
async function optionalCount(env,sql,args){try{return number(await env.DB.prepare(sql).bind(...args).first());}catch{return 0;}}

/** Complete, read-only impact inventory for a future protected tenant deletion. */
export async function tenantDeletionPreview(env,tenantId){
 const tables={};for(const table of TENANT_BACKUP_TABLES){const key=tenantColumn(table),row=await env.DB.prepare(`SELECT count(*) AS n FROM ${identifier(table)} WHERE ${identifier(key)}=?`).bind(tenantId).first();tables[table]=number(row);}
 const [members,exclusiveAccounts,crossTenantAccounts,sessions,recoveryAddresses,exclusiveRecoveryAddresses,passwordResets,pendingActivations,shareLinks,registrationInvites,registrationInviteEnvironments,productAssignments]=await Promise.all([
  env.DB.prepare('SELECT count(*) AS n FROM tenant_memberships WHERE tenant_id=?').bind(tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM tenant_memberships current WHERE current.tenant_id=? AND NOT EXISTS (SELECT 1 FROM tenant_memberships other WHERE other.user_id=current.user_id AND other.tenant_id<>?)').bind(tenantId,tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM tenant_memberships current WHERE current.tenant_id=? AND EXISTS (SELECT 1 FROM tenant_memberships other WHERE other.user_id=current.user_id AND other.tenant_id<>?)').bind(tenantId,tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id=?)').bind(tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM user_recovery_emails WHERE user_id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id=?)').bind(tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM user_recovery_emails WHERE user_id IN (SELECT current.user_id FROM tenant_memberships current WHERE current.tenant_id=? AND NOT EXISTS (SELECT 1 FROM tenant_memberships other WHERE other.user_id=current.user_id AND other.tenant_id<>?))').bind(tenantId,tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM password_resets WHERE user_id IN (SELECT current.user_id FROM tenant_memberships current WHERE current.tenant_id=? AND NOT EXISTS (SELECT 1 FROM tenant_memberships other WHERE other.user_id=current.user_id AND other.tenant_id<>?))').bind(tenantId,tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM user_email_activations WHERE tenant_id=?').bind(tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM photo_share_tokens WHERE tenant_id=?').bind(tenantId).first(),
  env.DB.prepare('SELECT count(*) AS n FROM registration_invites WHERE tenant_id=? OR created_from_tenant_id=?').bind(tenantId,tenantId).first(),
  optionalCount(env,'SELECT count(*) AS n FROM registration_invite_environments WHERE invite_id IN (SELECT id FROM registration_invites WHERE tenant_id=? OR created_from_tenant_id=?)',[tenantId,tenantId]),
  optionalCount(env,'SELECT count(*) AS n FROM tenant_product_entitlements WHERE tenant_id=?',[tenantId]),
 ]);
 const tableRows=Object.values(tables).reduce((sum,value)=>sum+value,0);
 return {tenantId,action:'preview-only',tables,tableRows,members:number(members),exclusiveAccounts:number(exclusiveAccounts),crossTenantAccounts:number(crossTenantAccounts),sessions:number(sessions),recoveryAddresses:number(recoveryAddresses),exclusiveRecoveryAddresses:number(exclusiveRecoveryAddresses),passwordResets:number(passwordResets),pendingActivations:number(pendingActivations),shareLinks:number(shareLinks),registrationInvites:number(registrationInvites),registrationInviteEnvironments:Number(registrationInviteEnvironments),productAssignments:Number(productAssignments),requiresFreshBackup:true,requiresExactName:true,requiresPassword:true};
}
