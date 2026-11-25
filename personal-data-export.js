export const PERSONAL_DATA_EXPORT_SCHEMA='hausmeister-pro-personal-data-export';
export const PERSONAL_DATA_EXPORT_VERSION=1;

const canonical=row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]));
const ordered=rows=>(rows||[]).map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const rows=async statement=>ordered((await statement.all()).results);

/** Data-subject access export for the signed-in account inside one tenant. */
export async function buildPersonalDataExport(env,tenantId,userId,{createdAt=new Date().toISOString()}={}){
 tenantId=String(tenantId||'').trim();userId=String(userId||'').trim();
 if(!tenantId||!userId)throw Error('Firma und Konto sind für den persönlichen Export erforderlich.');
 const account=await env.DB.prepare(`SELECT u.id,u.name,u.active,u.created_at,m.role,m.active AS membership_active,m.created_at AS membership_created_at,e.email,e.verified_at
  FROM tenant_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN user_recovery_emails e ON e.user_id=u.id
  WHERE m.tenant_id=? AND m.user_id=?`).bind(tenantId,userId).first();
 if(!account)throw Error('Das Konto gehört nicht zu diesem Firmenbereich.');
 const [records,dispatchJobs,auditEvents,pendingActivations]=await Promise.all([
  rows(env.DB.prepare(`SELECT collection,id,employee,body,revision,updated_at,updated_by FROM records WHERE tenant_id=? AND employee=? ORDER BY collection,id`).bind(tenantId,userId)),
  rows(env.DB.prepare(`SELECT id,title,object_id,assigned_user_id,priority,status,due_at,note,created_by,created_at,updated_at FROM dispatch_jobs WHERE tenant_id=? AND assigned_user_id=? ORDER BY created_at,id`).bind(tenantId,userId)),
  rows(env.DB.prepare(`SELECT id,action,target_type,target_id,created_at FROM audit_events WHERE tenant_id=? AND actor_user_id=? ORDER BY created_at,id`).bind(tenantId,userId)),
  rows(env.DB.prepare(`SELECT user_id,email,created_at,expires_at FROM user_email_activations WHERE tenant_id=? AND user_id=? ORDER BY created_at`).bind(tenantId,userId)),
 ]);
 return {schema:PERSONAL_DATA_EXPORT_SCHEMA,version:PERSONAL_DATA_EXPORT_VERSION,scope:'person',createdAt,tenantId,userId,
  account:canonical(account),records,dispatchJobs,auditEvents,pendingActivations,
  excludedSecurityData:['password_hash','salt','session_tokens','activation_code_hashes','password_reset_code_hashes','login_throttles']};
}
