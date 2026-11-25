export const PLATFORM_OPERATIONS_SCHEMA=`CREATE TABLE IF NOT EXISTS platform_email_usage(
 day TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('activation','registration','reset','other')),
 accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted>=0),
 failed INTEGER NOT NULL DEFAULT 0 CHECK(failed>=0),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(day,kind)
);
CREATE TABLE IF NOT EXISTS platform_operation_snapshots(
 day TEXT PRIMARY KEY,
 tenant_count INTEGER NOT NULL CHECK(tenant_count>=0),
 active_tenant_count INTEGER NOT NULL CHECK(active_tenant_count>=0),
 active_membership_count INTEGER NOT NULL CHECK(active_membership_count>=0),
 storage_bytes INTEGER NOT NULL CHECK(storage_bytes>=0),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_cost_settings(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 storage_eur_per_gb_month TEXT,
 email_eur_per_1000 TEXT,
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);`;

const day=value=>new Date(value).toISOString().slice(0,10);
const safeKind=value=>['activation','registration','reset'].includes(String(value))?String(value):'other';
const number=value=>Math.max(0,Number(value)||0);
const configuredPrice=value=>{const entered=String(value??'').trim();if(!/^\d+(?:\.\d{1,6})?$/.test(entered))return null;const parsed=Number(entered);return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
const enteredPrice=value=>{const entered=String(value??'').trim();if(!entered)return null;if(configuredPrice(entered)===null)throw Error('Anbieterpreise müssen nichtnegative Euro-Zahlen mit Punkt und höchstens sechs Nachkommastellen sein.');return entered;};

export function validatePlatformCostSettings(input){return {storageEurPerGbMonth:enteredPrice(input?.storageEurPerGbMonth),emailEurPer1000:enteredPrice(input?.emailEurPer1000)};}

export async function platformCostSettings(env){
 await ensurePlatformOperationsSchema(env);
 const row=await env.DB.prepare('SELECT storage_eur_per_gb_month,email_eur_per_1000,updated_at FROM platform_cost_settings WHERE singleton=1').first();
 if(row)return {storageEurPerGbMonth:row.storage_eur_per_gb_month===null?null:String(row.storage_eur_per_gb_month),emailEurPer1000:row.email_eur_per_1000===null?null:String(row.email_eur_per_1000),source:'operator',updatedAt:Number(row.updated_at||0)};
 const storage=configuredPrice(env.PLATFORM_STORAGE_EUR_PER_GB_MONTH),email=configuredPrice(env.PLATFORM_EMAIL_EUR_PER_1000);
 return {storageEurPerGbMonth:storage===null?null:String(env.PLATFORM_STORAGE_EUR_PER_GB_MONTH).trim(),emailEurPer1000:email===null?null:String(env.PLATFORM_EMAIL_EUR_PER_1000).trim(),source:storage!==null||email!==null?'environment':'unconfigured',updatedAt:0};
}

export async function updatePlatformCostSettings(env,input,actorUserId,{now=Date.now()}={}){
 const value=validatePlatformCostSettings(input);await ensurePlatformOperationsSchema(env);
 await env.DB.prepare(`INSERT INTO platform_cost_settings(singleton,storage_eur_per_gb_month,email_eur_per_1000,updated_at,updated_by) VALUES(1,?,?,?,?)
  ON CONFLICT(singleton) DO UPDATE SET storage_eur_per_gb_month=excluded.storage_eur_per_gb_month,email_eur_per_1000=excluded.email_eur_per_1000,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(value.storageEurPerGbMonth,value.emailEurPer1000,now,String(actorUserId||'')).run();
 return platformCostSettings(env);
}

export async function ensurePlatformOperationsSchema(env){await env.DB.prepare(PLATFORM_OPERATIONS_SCHEMA).run();}

export async function recordPlatformEmailUsage(env,kind,outcome,{now=Date.now()}={}){
 try{
  await ensurePlatformOperationsSchema(env);
  const accepted=outcome==='accepted'?1:0,failed=outcome==='failed'?1:0;
  await env.DB.prepare(`INSERT INTO platform_email_usage(day,kind,accepted,failed,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(day,kind) DO UPDATE SET accepted=accepted+excluded.accepted,failed=failed+excluded.failed,updated_at=excluded.updated_at`).bind(day(now),safeKind(kind),accepted,failed,now).run();
 }catch{
  // Monitoring must never turn an otherwise valid account email into a failure.
 }
}

export async function platformOperationsSummary(env,{now=Date.now()}={}){
 await ensurePlatformOperationsSchema(env);
 const [tenants,memberships,storage,email]=await Promise.all([
  env.DB.prepare('SELECT count(*) AS total,sum(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active FROM tenants').first(),
  env.DB.prepare('SELECT count(*) AS total FROM tenant_memberships WHERE active=1').first(),
  env.DB.prepare('SELECT COALESCE(sum(used),0) AS total FROM tenant_storage_usage').first(),
  env.DB.prepare('SELECT day,kind,accepted,failed FROM platform_email_usage WHERE day>=? ORDER BY day,kind').bind(day(now-6*86400000)).all()
 ]);
 const current={tenants:number(tenants?.total),activeTenants:number(tenants?.active),activeMemberships:number(memberships?.total),storageBytes:number(storage?.total)};
 await env.DB.prepare(`INSERT INTO platform_operation_snapshots(day,tenant_count,active_tenant_count,active_membership_count,storage_bytes,created_at) VALUES(?,?,?,?,?,?)
  ON CONFLICT(day) DO UPDATE SET tenant_count=excluded.tenant_count,active_tenant_count=excluded.active_tenant_count,active_membership_count=excluded.active_membership_count,storage_bytes=excluded.storage_bytes,created_at=excluded.created_at`).bind(day(now),current.tenants,current.activeTenants,current.activeMemberships,current.storageBytes,now).run();
 const history=await env.DB.prepare('SELECT day,tenant_count AS tenants,active_tenant_count AS activeTenants,active_membership_count AS activeMemberships,storage_bytes AS storageBytes FROM platform_operation_snapshots WHERE day>=? ORDER BY day').bind(day(now-29*86400000)).all();
 const emailDays=(email.results||[]).map(row=>({day:String(row.day),kind:String(row.kind),accepted:number(row.accepted),failed:number(row.failed)})),settings=await platformCostSettings(env),storagePrice=configuredPrice(settings.storageEurPerGbMonth),emailPrice=configuredPrice(settings.emailEurPer1000),emailAttempts=emailDays.reduce((sum,row)=>sum+row.accepted+row.failed,0),costConfiguration={currency:'EUR',storageConfigured:storagePrice!==null,emailConfigured:emailPrice!==null,source:settings.source,storageEurPerGbMonth:settings.storageEurPerGbMonth,emailEurPer1000:settings.emailEurPer1000},estimatedCosts={storageMonthEur:storagePrice===null?null:Number((current.storageBytes/1073741824*storagePrice).toFixed(4)),emailSevenDaysEur:emailPrice===null?null:Number((emailAttempts/1000*emailPrice).toFixed(4))};
 return {current,emailDays,history:history.results||[],costMode:'verified-provider-rates-only',costConfiguration,estimatedCosts,automaticPaidUpgrade:false,checkedAt:new Date(now).toISOString()};
}

