import {captureTenantSnapshot} from './backup-core.js';

export const DATA_EXPORT_SCHEMA='hausmeister-pro-company-data-export';
export const DATA_EXPORT_VERSION=1;

const canonical=row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]));
const ordered=rows=>rows.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Complete tenant-scoped portability export without authentication secrets. */
export async function buildTenantDataExport(env,tenantId,{createdAt=new Date().toISOString()}={}){
  const snapshot=await captureTenantSnapshot(env,tenantId,{createdAt});
  const accounts=await env.DB.prepare(`SELECT u.id,u.name,u.active,u.created_at,m.role,m.active AS membership_active,m.created_at AS membership_created_at,e.email,e.verified_at
    FROM tenant_memberships m JOIN users u ON u.id=m.user_id
    LEFT JOIN user_recovery_emails e ON e.user_id=u.id
    WHERE m.tenant_id=? ORDER BY lower(u.name),lower(u.id)`).bind(tenantId).all();
  const pending=await env.DB.prepare(`SELECT user_id,email,created_at,expires_at
    FROM user_email_activations WHERE tenant_id=? ORDER BY lower(user_id)`).bind(tenantId).all();
  return {
    schema:DATA_EXPORT_SCHEMA,version:DATA_EXPORT_VERSION,scope:'tenant',createdAt,tenantId,
    company:{...snapshot.tables.tenants[0],environment:snapshot.tables.tenant_environments[0]?.environment||'production'},
    accounts:ordered(accounts.results||[]),
    pendingActivations:ordered(pending.results||[]),
    data:snapshot.tables,
    excludedSecurityData:['password_hash','salt','session_tokens','activation_code_hashes','password_reset_code_hashes','login_throttles'],
  };
}
