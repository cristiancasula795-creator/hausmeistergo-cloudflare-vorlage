export const MEMBER_PERMISSION_SCHEMA=`
CREATE TABLE IF NOT EXISTS tenant_member_permission_overrides(
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 permission_key TEXT NOT NULL,
 allowed INTEGER NOT NULL CHECK(allowed IN(0,1)),
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id,permission_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
)`;

export const MEMBER_PERMISSION_GROUPS={
 work:['work.daily','work.tasks','work.history','work.reports','work.plan.view','work.time','work.officeJobs','work.issues','work.sent','work.plan.edit'],
 objects:['objects.assigned','objects.all','objects.activities','objects.material','objects.archive','objects.keys.view','objects.keys.manage','objects.season.execute','objects.season.manage','objects.accessProofs','objects.manage','waste.execute','waste.manage'],
 office:['office.overview','office.calendar','office.planning','office.urgent','office.jobs','office.completions','office.times','office.issues','office.extra','office.messages'],
 staff:['staff.view','staff.create','staff.block','staff.roles','staff.permissions','staff.remove'],
 business:['business.customers','business.sites','business.contracts','business.services','business.estimates','business.orders','business.invoices','business.payments','business.credits','business.incoming','business.accounting','business.settings'],
 data:['export.work','export.business','backup.create','backup.download','backup.restore','backup.delete'],
 app:['app.language','app.intro','app.help','app.changelog','app.update','app.server','app.package','app.system']
};

export const MEMBER_PERMISSION_KEYS=Object.freeze(Object.values(MEMBER_PERMISSION_GROUPS).flat());
const KNOWN=new Set(MEMBER_PERMISSION_KEYS);
export const OPERATOR_LOCKED_PERMISSION_KEYS=Object.freeze([
 'staff.roles','staff.permissions','staff.remove',
 'business.settings',
 'backup.download','backup.restore','backup.delete',
 'app.server','app.package','app.system'
]);
const OPERATOR_LOCKED=new Set(OPERATOR_LOCKED_PERMISSION_KEYS);
const FIELD_KEYS=new Set([
 ...MEMBER_PERMISSION_GROUPS.work,
 'objects.assigned','objects.activities','objects.material','objects.archive','objects.keys.view','objects.season.execute','objects.accessProofs','waste.execute',
 'app.language','app.intro','app.help','app.changelog','app.update'
]);
const ADMIN_KEYS=new Set([
 ...FIELD_KEYS,...MEMBER_PERMISSION_GROUPS.office,
 'objects.all','objects.keys.manage','objects.season.manage','objects.manage','waste.manage',
 'staff.view','staff.create','staff.block',
 ...MEMBER_PERMISSION_GROUPS.business.filter(key=>key!=='business.settings'),
 'export.work','export.business','backup.create'
]);

export function normalizedMemberRole(role){
 const value=String(role||'field');
 if(value==='owner')return 'operator';
 if(value==='viewer')return 'viewer';
 return ['operator','admin','field'].includes(value)?value:'field';
}

export function defaultMemberPermissions(role){
 const normalized=normalizedMemberRole(role),allowed=normalized==='operator'?new Set(MEMBER_PERMISSION_KEYS):normalized==='admin'?ADMIN_KEYS:normalized==='field'?FIELD_KEYS:new Set();
 return Object.fromEntries(MEMBER_PERMISSION_KEYS.map(key=>[key,allowed.has(key)]));
}

export function normalizePermissionOverrides(role,input){
 const normalized=normalizedMemberRole(role);
 if(normalized==='operator')return {};
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Berechtigungen müssen als eindeutige Haken übergeben werden.');
 const defaults=defaultMemberPermissions(normalized),result={};
 for(const [key,value] of Object.entries(input)){
  if(!KNOWN.has(key))throw new TypeError(`Unbekannte Berechtigung: ${key}`);
  if(typeof value!=='boolean')throw new TypeError(`Berechtigung ${key} muss an oder aus sein.`);
  if(OPERATOR_LOCKED.has(key)&&value===true)throw new TypeError(`Berechtigung ${key} bleibt ausschließlich beim Operator.`);
  if(value!==defaults[key])result[key]=value;
 }
 return result;
}

export function effectiveMemberPermissions(role,overrides={}){
 const normalized=normalizedMemberRole(role),result=defaultMemberPermissions(normalized);
 if(normalized==='operator')return result;
 for(const [key,value] of Object.entries(overrides||{}))if(KNOWN.has(key)&&!OPERATOR_LOCKED.has(key)&&typeof value==='boolean')result[key]=value;
 return result;
}

export function assertPermissionEditor(actorRole,targetRole){
 const actor=normalizedMemberRole(actorRole),target=normalizedMemberRole(targetRole);
 if(actor!=='operator')throw new Error('Nur der Operator darf einzelne Firmenberechtigungen verändern.');
 if(target==='operator')throw new Error('Operatoren behalten immer alle Firmenrechte.');
 if(target==='viewer')throw new Error('Alte Lesekonten werden nicht über die neue Berechtigungsmaske erweitert.');
 return true;
}

export async function ensureMemberPermissionSchema(env){
 await env.DB.prepare(MEMBER_PERMISSION_SCHEMA).run();
}

export async function memberPermissionOverrides(env,tenantId,userId){
 await ensureMemberPermissionSchema(env);
 const rows=await env.DB.prepare('SELECT permission_key,allowed FROM tenant_member_permission_overrides WHERE tenant_id=? AND user_id=? ORDER BY permission_key').bind(tenantId,userId).all();
 return Object.fromEntries((rows.results||[]).filter(row=>KNOWN.has(String(row.permission_key))).map(row=>[String(row.permission_key),Number(row.allowed)===1]));
}

const RECORD_WRITE_PERMISSIONS=Object.freeze({
 profiles:'objects.manage',
 plans:'work.plan.edit',
 visits:'work.tasks',
 urgent:'office.urgent',
 done:'work.tasks',
 events:'work.daily',
 working:'work.daily',
 dayReports:'work.reports',
 sessions:'work.daily',
 messages:'work.officeJobs',
 issues:'work.issues',
 extra:'work.tasks',
 evidence:'work.reports',
 planning:'office.planning',
 employees:'staff.create',
 settings:'business.settings',
 workDays:'work.time',
 wasteSettings:'waste.manage',
 wasteEvents:'waste.execute',
 objectDone:'objects.activities',
 timeClocks:'work.time',
 timePreferences:'work.time',
 timeReports:'work.time',
 objectFiles:'objects.archive',
 officeAppointments:'office.calendar',
 officeReports:'work.officeJobs',
 seasonWorks:'objects.season.execute',
 objectReschedules:'work.plan.edit'
});

const REQUEST_PERMISSIONS=Object.freeze({
 'GET /users':'staff.view',
 'POST /users':'staff.create',
 'POST /users/recovery-setup':'staff.create',
 'POST /users/activation-preview':'staff.create',
 'POST /users/activation-resend-managed':'staff.create',
 'POST /users/update':'staff.block',
 'GET /users/removal-preview':'staff.remove',
 'POST /memberships':'staff.roles',
 'GET /memberships/permissions':'staff.permissions',
 'POST /memberships/permissions':'staff.permissions',
 'POST /memberships/remove':'staff.remove',
 'GET /customers':'business.customers',
 'POST /customers':'business.customers',
 'POST /customers/update':'business.customers',
 'POST /customers/archive':'business.customers',
 'POST /customers/purge-preview':'business.customers',
 'POST /customers/purge':'business.customers',
 'GET /structured-addresses':'business.sites',
 'POST /structured-addresses':'business.sites',
 'POST /customer-sites':'business.sites',
 'POST /customer-contacts':'business.customers',
 'DELETE /customer-contacts':'business.customers',
 'POST /customer-contracts':'business.contracts',
 'DELETE /customer-contracts':'business.contracts',
 'POST /customer-notes':'business.customers',
 'DELETE /customer-notes':'business.customers',
 'POST /customer-onboarding':'business.customers',
 'GET /service-catalog':'business.services',
 'POST /service-catalog':'business.services',
 'GET /estimates':'business.estimates',
 'GET /estimates/detail':'business.estimates',
 'POST /estimates':'business.estimates',
 'POST /estimates/status':'business.estimates',
 'GET /order-confirmations':'business.orders',
 'GET /order-confirmations/detail':'business.orders',
 'POST /order-confirmations':'business.orders',
 'POST /order-confirmations/status':'business.orders',
 'GET /invoices':'business.invoices',
 'GET /invoices/detail':'business.invoices',
 'POST /invoices':'business.invoices',
 'POST /invoices/status':'business.invoices',
 'POST /invoices/xrechnung':'business.invoices',
 'POST /invoice-payments':'business.payments',
 'POST /invoice-reminders':'business.payments',
 'GET /credit-notes':'business.credits',
 'GET /credit-notes/detail':'business.credits',
 'POST /credit-notes':'business.credits',
 'POST /credit-notes/status':'business.credits',
 'GET /incoming-einvoices':'business.incoming',
 'GET /incoming-einvoices/detail':'business.incoming',
 'POST /incoming-einvoices':'business.incoming',
 'POST /accounting-export':'business.accounting',
 'GET /billing-sources':'business.accounting',
 'GET /business-settings':'business.settings',
 'POST /business-settings':'business.settings',
 'POST /business-settings/reset':'business.settings',
 'GET /dashboard':'office.overview',
 'GET /dispatch':'work.officeJobs',
 'POST /dispatch':'office.jobs',
 'POST /dispatch/status':'work.officeJobs',
 'POST /office-reports/recall':'office.completions',
 'GET /operator/data-export':'export.business',
 'GET /operator/data-export/manifest':'export.business',
 'GET /operator/data-export/page':'export.business',
 'GET /operator/backup-status':'backup.create',
 'POST /operator/backups/manual':'backup.create',
 'GET /operator/backups':'backup.download',
 'POST /operator/backups/integrity':'backup.download',
 'POST /operator/backups/restore-preview':'backup.restore',
 'POST /operator/backups/restore':'backup.restore',
 'GET /operator/storage-inventory':'backup.delete',
 'POST /operator/storage-cleanup/preview':'backup.delete',
 'POST /operator/storage-cleanup/apply':'backup.delete',
 'GET /operator/tenant-deletion-preview':'backup.delete',
 'POST /objects/purge-preview':'objects.manage',
 'POST /objects/purge':'objects.manage',
 'GET /audit':'app.system',
 'GET /operator/system-status':'app.system',
 'GET /operator/translation-cache':'app.system',
 'POST /operator/translation-cache/purge':'app.system',
 'POST /photo-chunk':'work.reports',
 'GET /photo-chunk':'work.reports',
 'POST /photo-share':'work.reports',
 'POST /translate':'app.language',
 'GET /email-delivery-status':'app.system'
});

export function requiredMemberPermissionForRecord(collection){
 return RECORD_WRITE_PERMISSIONS[String(collection||'')]||null;
}

export function requiredMemberPermissionForRequest(path,method){
 return REQUEST_PERMISSIONS[`${String(method||'GET').toUpperCase()} ${String(path||'')}`]||null;
}

export function authorizationRoleForGrantedPermission(role,permissionKey){
 const normalized=normalizedMemberRole(role);
 if(normalized==='operator'||normalized==='viewer'||!KNOWN.has(String(permissionKey||'')))return normalized;
 return normalized==='field'?'admin':normalized;
}

export async function effectivePermissionsForMember(env,{tenantId,userId,role}){
 const normalized=normalizedMemberRole(role);
 if(normalized==='operator'||normalized==='viewer')return effectiveMemberPermissions(normalized);
 return effectiveMemberPermissions(normalized,await memberPermissionOverrides(env,tenantId,userId));
}

export function assertMemberPermission(permissions,key){
 if(!KNOWN.has(String(key||'')))throw new Error(`Unbekannte Berechtigung: ${key}`);
 if(permissions?.[key]!==true)throw new Error('Diese Funktion wurde für dieses Firmenkonto nicht freigegeben.');
 return true;
}

export async function replaceMemberPermissionOverrides(env,{tenantId,userId,actorRole,targetRole,permissions,updatedBy,now=Date.now()}){
 assertPermissionEditor(actorRole,targetRole);
 const overrides=normalizePermissionOverrides(targetRole,permissions);
 await ensureMemberPermissionSchema(env);
 const statements=[env.DB.prepare('DELETE FROM tenant_member_permission_overrides WHERE tenant_id=? AND user_id=?').bind(tenantId,userId)];
 for(const [key,allowed] of Object.entries(overrides))statements.push(env.DB.prepare('INSERT INTO tenant_member_permission_overrides(tenant_id,user_id,permission_key,allowed,updated_at,updated_by) VALUES(?,?,?,?,?,?)').bind(tenantId,userId,key,allowed?1:0,now,updatedBy));
 await env.DB.batch(statements);
 return {overrides,effective:effectiveMemberPermissions(targetRole,overrides)};
}
