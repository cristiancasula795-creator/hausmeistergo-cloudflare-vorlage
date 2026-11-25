export const PRODUCT_CATALOG_SCHEMA=`CREATE TABLE IF NOT EXISTS platform_product_packages(
 code TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 monthly_price_cents INTEGER,
 user_limit INTEGER NOT NULL CHECK(user_limit>=1 AND user_limit<=10000),
 storage_limit_bytes INTEGER NOT NULL CHECK(storage_limit_bytes>=1048576 AND storage_limit_bytes<=4294967296),
 features_json TEXT NOT NULL DEFAULT '[]',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL
)`;

// Public HausmeisterGo packages. INSERT OR IGNORE keeps later operator changes
// intact while ensuring a fresh production database always has the packages
// advertised on the website.
export const DEFAULT_PRODUCT_PACKAGES=Object.freeze([
 {code:'pilot',displayName:'Pilot',monthlyPriceCents:2900,userLimit:3,storageLimitBytes:512*1024*1024,features:['business','core','custom_pdfs','einvoice','team_planning','time_tracking'],active:true},
 {code:'starter',displayName:'Starter',monthlyPriceCents:4900,userLimit:3,storageLimitBytes:512*1024*1024,features:['core'],active:true},
 {code:'team',displayName:'Team',monthlyPriceCents:7900,userLimit:10,storageLimitBytes:1024*1024*1024,features:['core','custom_pdfs','team_planning','time_tracking'],active:true},
 {code:'business',displayName:'Business',monthlyPriceCents:12900,userLimit:25,storageLimitBytes:2*1024*1024*1024,features:['business','core','custom_pdfs','einvoice','team_planning','time_tracking'],active:true},
 {code:'enterprise',displayName:'Enterprise',monthlyPriceCents:null,userLimit:10000,storageLimitBytes:4*1024*1024*1024,features:['business','core','custom_pdfs','einvoice','team_planning','time_tracking'],active:true}
]);

const CODE=/^[a-z0-9][a-z0-9_-]{0,39}$/;
const FEATURE=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const cleanFeatures=value=>{
 const result=[...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim().toLowerCase()).filter(Boolean))].sort();
 if(result.length>100||result.some(item=>!FEATURE.test(item)))throw Error('Produktfunktionen sind ungültig.');
 if(!result.includes('core'))throw Error('Jedes Produktpaket benötigt die Grundfunktionen.');
 if(result.includes('business')&&!result.includes('team_planning'))throw Error('Die Geschäftsverwaltung benötigt die Teamplanung.');
 if(result.includes('einvoice')&&!result.includes('business'))throw Error('E-Rechnungen benötigen die Büro- und Geschäftsverwaltung.');
 return result;
};
const integer=(value,min,max,label)=>{const result=Number(value);if(!Number.isInteger(result)||result<min||result>max)throw Error(`${label} ist ungültig.`);return result;};
const price=value=>{
 if(value===null||value===undefined||String(value).trim()==='')return null;
 return integer(value,0,100000000,'Monatspreis');
};
const row=value=>({code:String(value.code),displayName:String(value.display_name),monthlyPriceCents:value.monthly_price_cents===null?null:Number(value.monthly_price_cents),currency:'EUR',billingInterval:'month',userLimit:Number(value.user_limit),storageLimitBytes:Number(value.storage_limit_bytes),features:(()=>{try{return cleanFeatures(JSON.parse(String(value.features_json||'[]')));}catch{return ['core'];}})(),active:Number(value.active)===1,updatedAt:Number(value.updated_at||0)});

export function validateProductPackage(input){
 const code=String(input?.code||'').trim().toLowerCase(),displayName=String(input?.displayName||'').trim();
 if(!CODE.test(code))throw Error('Paketkennung ist ungültig.');
 if(displayName.length<2||displayName.length>80)throw Error('Paketname muss zwischen 2 und 80 Zeichen lang sein.');
 return {code,displayName,monthlyPriceCents:price(input?.monthlyPriceCents),userLimit:integer(input?.userLimit,1,10000,'Nutzergrenze'),storageLimitBytes:integer(input?.storageLimitBytes,1048576,4294967296,'Speichergrenze'),features:cleanFeatures(input?.features),active:input?.active!==false};
}

export async function ensureProductCatalogSchema(env,{now=Date.now()}={}){
 await env.DB.prepare(PRODUCT_CATALOG_SCHEMA).run();
 for(const item of DEFAULT_PRODUCT_PACKAGES){
  const value=validateProductPackage(item);
  await env.DB.prepare(`INSERT OR IGNORE INTO platform_product_packages(code,display_name,monthly_price_cents,user_limit,storage_limit_bytes,features_json,active,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(value.code,value.displayName,value.monthlyPriceCents,value.userLimit,value.storageLimitBytes,JSON.stringify(value.features),value.active?1:0,now,now,'__published_catalog__').run();
  await env.DB.prepare(`UPDATE platform_product_packages SET display_name=?,monthly_price_cents=?,user_limit=?,storage_limit_bytes=?,features_json=?,active=?,updated_at=? WHERE code=? AND updated_by='__published_catalog__'`).bind(value.displayName,value.monthlyPriceCents,value.userLimit,value.storageLimitBytes,JSON.stringify(value.features),value.active?1:0,now,value.code).run();
 }
}

export async function listProductPackages(env,{includeInactive=false}={}){
 await ensureProductCatalogSchema(env);
 const result=await env.DB.prepare(`SELECT * FROM platform_product_packages${includeInactive?'':' WHERE active=1'} ORDER BY display_name,code`).all();
 return (result.results||[]).map(row);
}

export async function productPackage(env,code){
 await ensureProductCatalogSchema(env);
 const found=await env.DB.prepare('SELECT * FROM platform_product_packages WHERE code=?').bind(String(code||'').trim().toLowerCase()).first();
 return found?row(found):null;
}

export async function saveProductPackage(env,input,actorUserId,{now=Date.now()}={}){
 const value=validateProductPackage(input);await ensureProductCatalogSchema(env);
 await env.DB.prepare(`INSERT INTO platform_product_packages(code,display_name,monthly_price_cents,user_limit,storage_limit_bytes,features_json,active,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(code) DO UPDATE SET display_name=excluded.display_name,monthly_price_cents=excluded.monthly_price_cents,user_limit=excluded.user_limit,storage_limit_bytes=excluded.storage_limit_bytes,features_json=excluded.features_json,active=excluded.active,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(value.code,value.displayName,value.monthlyPriceCents,value.userLimit,value.storageLimitBytes,JSON.stringify(value.features),value.active?1:0,now,now,String(actorUserId||'')).run();
 return productPackage(env,value.code);
}
