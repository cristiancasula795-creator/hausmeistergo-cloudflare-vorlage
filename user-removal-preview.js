const count=row=>Number(row?.n||0);
const one=async statement=>statement.first();

/** Read-only impact inventory. It deliberately performs no deletion. */
export async function userRemovalPreview(env,tenantId,userId,{actorUserId}={}){
 const membership=await one(env.DB.prepare('SELECT m.role,m.active,u.name,u.active AS user_active FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=?').bind(tenantId,userId));
 if(!membership)throw Error('Konto in dieser Firma nicht gefunden.');
 const [memberships,ownedRecords,editedRecords,assignedJobs,createdJobs,actorAudits,targetAudits,sessions,recovery,pending]=await Promise.all([
  one(env.DB.prepare('SELECT count(*) AS n FROM tenant_memberships WHERE user_id=?').bind(userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM records WHERE tenant_id=? AND employee=?').bind(tenantId,userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM records WHERE tenant_id=? AND updated_by=? AND employee<>?').bind(tenantId,userId,userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM dispatch_jobs WHERE tenant_id=? AND assigned_user_id=?').bind(tenantId,userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM dispatch_jobs WHERE tenant_id=? AND created_by=? AND assigned_user_id<>?').bind(tenantId,userId,userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM audit_events WHERE tenant_id=? AND actor_user_id=?').bind(tenantId,userId)),
  one(env.DB.prepare("SELECT count(*) AS n FROM audit_events WHERE tenant_id=? AND target_type='user' AND target_id=?").bind(tenantId,userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM user_recovery_emails WHERE user_id=?').bind(userId)),
  one(env.DB.prepare('SELECT count(*) AS n FROM user_email_activations WHERE user_id=?').bind(userId)),
 ]);
 const inventory={memberships:count(memberships),ownedRecords:count(ownedRecords),editedForeignRecords:count(editedRecords),assignedJobs:count(assignedJobs),createdForeignJobs:count(createdJobs),actorAuditEvents:count(actorAudits),targetAuditEvents:count(targetAudits),activeSessions:count(sessions),recoveryAddresses:count(recovery),pendingActivations:count(pending)};
 const protectedReason=membership.role==='owner'?'owner':String(userId)===String(actorUserId||'')?'self':'';
 const historicalReferences=inventory.ownedRecords+inventory.editedForeignRecords+inventory.assignedJobs+inventory.createdForeignJobs+inventory.actorAuditEvents+inventory.targetAuditEvents;
 return {tenantId,userId,name:membership.name,role:membership.role,active:!!membership.active,userActive:!!membership.user_active,inventory,
  membershipRemovalAllowed:!protectedReason,hardDeletionEligible:!protectedReason&&inventory.memberships===1&&historicalReferences===0,
  protectedReason,historicalReferences,action:'preview-only'};
}
