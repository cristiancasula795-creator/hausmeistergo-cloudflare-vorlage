const CATEGORY_BY_COLLECTION={
 profiles:'objects',objectFiles:'objects',visits:'work',urgent:'work',done:'work',objectDone:'work',extra:'work',officeAppointments:'work',officeReports:'work',seasonWorks:'work',objectReschedules:'work',
 dayReports:'proofs',evidence:'proofs',plans:'planning',planning:'planning',events:'planning',messages:'communication',issues:'communication',
 workDays:'time',working:'time',sessions:'time',timeClocks:'time',timePreferences:'time',timeReports:'time',
 wasteSettings:'waste',wasteEvents:'waste',employees:'administration',settings:'administration'
};
const categories=['objects','work','proofs','planning','communication','time','waste','administration','other'];
const photoReferences=(value,result=new Set())=>{if(!value||typeof value!=='object')return result;if(Array.isArray(value)){for(const item of value)photoReferences(item,result);return result;}if(typeof value.serverPhotoKey==='string'&&value.serverPhotoKey)result.add(value.serverPhotoKey);for(const item of Object.values(value))if(item&&typeof item==='object')photoReferences(item,result);return result;};
const blank=()=>Object.fromEntries(categories.map(category=>[category,{records:0,bytes:0}]));
async function photoChunkTimeAvailable(env){try{return !!await env.DB.prepare("SELECT name FROM pragma_table_info('photo_chunks') WHERE name='created_at' LIMIT 1").first();}catch{return false;}}

/** Internal analysis. Candidate keys never leave the server module boundary. */
export async function tenantStorageAnalysis(env,tenantId,{now=Date.now(),orphanRetentionDays=30}={}){
 const recordRows=await env.DB.prepare('SELECT collection,id,body,length(body) AS bytes FROM records WHERE tenant_id=? ORDER BY collection,id').bind(tenantId).all();
 const records=recordRows.results||[];if(records.length>20000)throw Error('Für die sichere Speicherübersicht sind zu viele Datensätze vorhanden.');
 const grouped=blank(),references=new Set();let unreadableRecords=0,recordBytes=0;
 for(const row of records){const bytes=Number(row.bytes||0),category=CATEGORY_BY_COLLECTION[row.collection]||'other';grouped[category].records++;grouped[category].bytes+=bytes;recordBytes+=bytes;try{photoReferences(JSON.parse(row.body),references);}catch{unreadableRecords++;}}
 const hasPhotoChunkTime=await photoChunkTimeAvailable(env),photoTimeColumns=hasPhotoChunkTime?'min(created_at) AS first_created_at,max(created_at) AS last_created_at':'0 AS first_created_at,0 AS last_created_at';
 const photoRows=await env.DB.prepare(`SELECT photo_key,count(*) AS chunks,coalesce(sum(length(data)),0) AS bytes,${photoTimeColumns} FROM photo_chunks WHERE tenant_id=? GROUP BY photo_key ORDER BY photo_key`).bind(tenantId).all();
 const photos=photoRows.results||[],photoBytes=photos.reduce((sum,row)=>sum+Number(row.bytes||0),0),orphanDetectionComplete=unreadableRecords===0,orphanRows=orphanDetectionComplete?photos.filter(row=>!references.has(String(row.photo_key))):[];
 const tracked=await env.DB.prepare('SELECT used FROM tenant_storage_usage WHERE tenant_id=?').bind(tenantId).first();
 const cutoff=now-Math.max(1,Number(orphanRetentionDays)||30)*86400000,eligibleRows=orphanRows.filter(row=>Number(row.last_created_at||0)>0&&Number(row.last_created_at)<cutoff),unknownAgeRows=orphanRows.filter(row=>Number(row.last_created_at||0)<=0);
 const inventory={tenantId,action:'inventory-only',records:{count:records.length,bytes:recordBytes,unreadable:unreadableRecords},photos:{count:photos.length,chunks:photos.reduce((sum,row)=>sum+Number(row.chunks||0),0),bytes:photoBytes,referenced:orphanDetectionComplete?photos.length-orphanRows.length:null},orphanPhotos:{detectionComplete:orphanDetectionComplete,count:orphanRows.length,chunks:orphanRows.reduce((sum,row)=>sum+Number(row.chunks||0),0),bytes:orphanRows.reduce((sum,row)=>sum+Number(row.bytes||0),0),retentionDays:Math.max(1,Number(orphanRetentionDays)||30),eligibleCount:eligibleRows.length,eligibleBytes:eligibleRows.reduce((sum,row)=>sum+Number(row.bytes||0),0),unknownAgeCount:unknownAgeRows.length},categories:grouped,totalBytes:recordBytes+photoBytes,trackedBytes:Number(tracked?.used||0)};
 return {inventory,eligibleRows,cutoff};
}

/** Read-only, tenant-scoped storage inventory. Never returns record bodies, photo data or candidate keys. */
export async function tenantStorageInventory(env,tenantId,options={}){return (await tenantStorageAnalysis(env,tenantId,options)).inventory;}
