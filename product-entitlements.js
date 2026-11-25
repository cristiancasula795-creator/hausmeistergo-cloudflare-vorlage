export const PRODUCT_ENTITLEMENT_SCHEMA=`CREATE TABLE IF NOT EXISTS tenant_product_entitlements(
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 plan_code TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('legacy','trial','active','grace','suspended','cancelled')),
 user_limit INTEGER NOT NULL CHECK(user_limit>=1 AND user_limit<=10000),
 storage_limit_bytes INTEGER NOT NULL CHECK(storage_limit_bytes>=1048576 AND storage_limit_bytes<=4294967296),
 features_json TEXT NOT NULL DEFAULT '[]',
 trial_ends_at INTEGER NOT NULL DEFAULT 0,
 current_period_ends_at INTEGER NOT NULL DEFAULT 0,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN(0,1)),
 support_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL
)`;

export const PRODUCT_STORAGE_MAX_BYTES=4*1024*1024*1024;
export const DEFAULT_TRIAL_DAYS=30;
export const DEFAULT_TRIAL_USER_LIMIT=3;
export const DEFAULT_TRIAL_STORAGE_BYTES=512*1024*1024;
const STATUSES=new Set(['legacy','trial','active','grace','suspended','cancelled']);
const PLAN_CODE=/^[a-z0-9][a-z0-9_-]{0,39}$/;
const FEATURE_CODE=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const EINVOICE_MUTATIONS=new Set(['/invoices/xrechnung','/incoming-einvoices']);
const BUSINESS_MUTATIONS=new Set(['/customer-onboarding','/customers','/customers/update','/structured-addresses','/customer-sites','/customer-contacts','/customer-contracts','/customer-notes','/service-catalog','/business-settings','/invoices','/invoices/status','/invoice-payments','/invoice-reminders','/estimates','/estimates/status','/order-confirmations','/order-confirmations/status','/credit-notes','/credit-notes/status']);
const READ_ONLY_SELF_SERVICE_WRITES=new Set(['/accounting-export','/objects/purge-preview','/objects/purge','/customers/purge-preview','/customers/purge']);
// Starter keeps the simple daily clock. Detailed preferences, corrections and
// period reports remain a Team feature.
const RECORD_FEATURES=Object.freeze({planning:'team_planning',plans:'team_planning',seasonWorks:'team_planning',objectReschedules:'team_planning',timePreferences:'time_tracking',timeReports:'time_tracking'});

const cleanFeatures=value=>{
 const values=Array.isArray(value)?value:[];
 if(values.length>100)throw Error('Zu viele Produktfunktionen.');
 return [...new Set(values.map(item=>String(item||'').trim().toLowerCase()).filter(Boolean))].sort().map(item=>{
  if(!FEATURE_CODE.test(item))throw Error('Ungültige Produktfunktion.');
  return item;
 });
};
const timestamp=value=>{
 const result=Number(value||0);
 if(!Number.isSafeInteger(result)||result<0)throw Error('Ungültiger Produktzeitpunkt.');
 return result;
};
const integer=(value,min,max,label)=>{
 const result=Number(value);
 if(!Number.isInteger(result)||result<min||result>max)throw Error(`${label} ist ungültig.`);
 return result;
};
const parseFeatures=value=>{try{return cleanFeatures(JSON.parse(String(value||'[]')));}catch{return [];}};
const publicRow=(row,now)=>{
 const storedStatus=String(row.status),trialExpired=storedStatus==='trial'&&Number(row.trial_ends_at||0)>0&&Number(row.trial_ends_at)<=now,periodCancelled=Number(row.cancel_at_period_end||0)===1&&Number(row.current_period_ends_at||0)>0&&Number(row.current_period_ends_at)<=now,readOnly=trialExpired||periodCancelled||storedStatus==='suspended'||storedStatus==='cancelled';
 return {
 planCode:String(row.plan_code),status:String(row.status),userLimit:Number(row.user_limit),storageLimitBytes:Number(row.storage_limit_bytes),
 features:parseFeatures(row.features_json),trialEndsAt:Number(row.trial_ends_at||0),currentPeriodEndsAt:Number(row.current_period_ends_at||0),
 cancelAtPeriodEnd:Number(row.cancel_at_period_end||0)===1,supportUntil:Number(row.support_until||0),updatedAt:Number(row.updated_at||0),
 effectiveStatus:trialExpired?'trial_expired':periodCancelled?'cancelled':storedStatus,accessMode:readOnly?'read_only':'full'
 };
};

export function platformOperatorIds(env){const raw=String(env.PRODUCT_OPERATOR_USER_IDS||''),separator=/[;\n]/.test(raw)?/[;\n]/:/,/;return new Set(raw.split(separator).map(value=>value.trim().toLowerCase()).filter(Boolean));}
export function productPackagesConfigured(env){return platformOperatorIds(env).size>0;}
export function isPlatformProductOperator(env,user){return String(user?.role||'')==='operator'&&platformOperatorIds(env).has(String(user?.id||'').trim().toLowerCase());}

export async function ensureProductEntitlementSchema(env){await env.DB.prepare(PRODUCT_ENTITLEMENT_SCHEMA).run();}

export async function productEntitlement(env,tenantId,{now=Date.now()}={}){
 await ensureProductEntitlementSchema(env);
 const row=await env.DB.prepare('SELECT * FROM tenant_product_entitlements WHERE tenant_id=?').bind(tenantId).first();
 if(!row&&env.CUSTOMER_LICENSE_REQUIRED==='true'){
  return {planCode:'unlicensed',status:'unlicensed',effectiveStatus:'unlicensed',accessMode:'read_only',userLimit:1,storageLimitBytes:0,features:[],trialEndsAt:0,currentPeriodEndsAt:0,cancelAtPeriodEnd:false,supportUntil:0,updatedAt:0,source:'customer-license-required'};
 }
 // Existing companies keep their current behaviour until the operator assigns
 // a real package. This fallback is intentionally not persisted or billable.
 return row?{...publicRow(row,now),source:'assigned'}:{planCode:'legacy',status:'legacy',effectiveStatus:'legacy',accessMode:'full',userLimit:10000,storageLimitBytes:PRODUCT_STORAGE_MAX_BYTES,features:['business','core','custom_pdfs','einvoice','team_planning','time_tracking'],trialEndsAt:0,currentPeriodEndsAt:0,cancelAtPeriodEnd:false,supportUntil:0,updatedAt:0,source:'legacy-fallback'};
}

export function hasProductFeature(entitlement,feature){return entitlement?.source==='legacy-fallback'||Array.isArray(entitlement?.features)&&entitlement.features.includes(feature);}
export function requestAllowedInReadOnly(path,method){return String(method||'GET').toUpperCase()==='GET'||READ_ONLY_SELF_SERVICE_WRITES.has(String(path||''));}
export function requiredProductFeature(path,method){
 if(String(method||'GET').toUpperCase()==='GET'||path==='/accounting-export')return '';
 if(EINVOICE_MUTATIONS.has(path))return 'einvoice';
 if(BUSINESS_MUTATIONS.has(path))return 'business';
 return '';
}
export function requiredProductFeatureForRecord(collection){return RECORD_FEATURES[String(collection||'')]||'';}

export function validateProductEntitlement(input){
 const planCode=String(input?.planCode||'').trim().toLowerCase(),status=String(input?.status||'').trim().toLowerCase();
 if(!PLAN_CODE.test(planCode))throw Error('Produktpaket ist ungültig.');
 if(!STATUSES.has(status))throw Error('Abonnementstatus ist ungültig.');
 const result={planCode,status,userLimit:integer(input.userLimit,1,10000,'Nutzergrenze'),storageLimitBytes:integer(input.storageLimitBytes,1048576,PRODUCT_STORAGE_MAX_BYTES,'Speichergrenze'),features:cleanFeatures(input.features),trialEndsAt:timestamp(input.trialEndsAt),currentPeriodEndsAt:timestamp(input.currentPeriodEndsAt),cancelAtPeriodEnd:input.cancelAtPeriodEnd===true,supportUntil:timestamp(input.supportUntil)};
 if(!result.features.includes('core'))throw Error('Jedes Produktpaket benötigt die Grundfunktionen.');
 if(result.features.includes('business')&&!result.features.includes('team_planning'))throw Error('Die Geschäftsverwaltung benötigt die Teamplanung.');
 if(result.features.includes('einvoice')&&!result.features.includes('business'))throw Error('E-Rechnungen benötigen die Büro- und Geschäftsverwaltung.');
 if(status==='trial'&&result.trialEndsAt<=Date.now())throw Error('Der Testzeitraum muss in der Zukunft enden.');
 if(result.cancelAtPeriodEnd&&result.currentPeriodEndsAt===0)throw Error('Eine vorgemerkte Beendigung benötigt ein Ende des aktuellen Zeitraums.');
 return result;
}

export async function assignProductEntitlement(env,tenantId,input,actorUserId,{now=Date.now()}={}){
 await ensureProductEntitlementSchema(env);
 const tenant=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first();
 if(!tenant)throw Error('Firma nicht gefunden.');
 const value=validateProductEntitlement(input);
 await env.DB.prepare(`INSERT INTO tenant_product_entitlements(tenant_id,plan_code,status,user_limit,storage_limit_bytes,features_json,trial_ends_at,current_period_ends_at,cancel_at_period_end,support_until,created_at,updated_at,updated_by)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET plan_code=excluded.plan_code,status=excluded.status,user_limit=excluded.user_limit,storage_limit_bytes=excluded.storage_limit_bytes,features_json=excluded.features_json,trial_ends_at=excluded.trial_ends_at,current_period_ends_at=excluded.current_period_ends_at,cancel_at_period_end=excluded.cancel_at_period_end,support_until=excluded.support_until,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(tenantId,value.planCode,value.status,value.userLimit,value.storageLimitBytes,JSON.stringify(value.features),value.trialEndsAt,value.currentPeriodEndsAt,value.cancelAtPeriodEnd?1:0,value.supportUntil,now,now,actorUserId).run();
 return productEntitlement(env,tenantId);
}

export async function createDefaultTrialEntitlement(env,tenantId,actorUserId,{now=Date.now()}={}){
 await ensureProductEntitlementSchema(env);
 await env.DB.prepare(`INSERT OR IGNORE INTO tenant_product_entitlements(tenant_id,plan_code,status,user_limit,storage_limit_bytes,features_json,trial_ends_at,current_period_ends_at,cancel_at_period_end,support_until,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,'["business","core","custom_pdfs","einvoice","team_planning","time_tracking"]',?,0,0,0,?,?,?)`).bind(tenantId,'trial','trial',DEFAULT_TRIAL_USER_LIMIT,DEFAULT_TRIAL_STORAGE_BYTES,now+DEFAULT_TRIAL_DAYS*86400000,now,now,actorUserId).run();
 return productEntitlement(env,tenantId);
}

export async function assertUserSeatAvailable(env,tenantId){
 const entitlement=await productEntitlement(env,tenantId);
 if(entitlement.accessMode==='read_only')throw Error('Das Abonnement erlaubt derzeit keine weiteren Konten.');
 const row=await env.DB.prepare('SELECT count(*) AS n FROM tenant_memberships WHERE tenant_id=?').bind(tenantId).first();
 if(Number(row?.n||0)>=entitlement.userLimit)throw Error(`Die Nutzergrenze dieses Produktpakets (${entitlement.userLimit}) ist erreicht.`);
 return entitlement;
}

export async function effectiveStorageLimit(env,tenantId){return (await productEntitlement(env,tenantId)).storageLimitBytes;}
