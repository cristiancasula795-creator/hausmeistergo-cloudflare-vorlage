export const TRANSLATION_CACHE_CONFIRMATION='ÜBERSETZUNGEN LÖSCHEN';

export async function translationCacheInventory(env,tenantId){
 const row=await env.DB.prepare('SELECT count(*) AS entries,COALESCE(sum(length(translated_text)),0) AS characters FROM translation_cache WHERE tenant_id=?').bind(tenantId).first();
 return {entries:Number(row?.entries||0),characters:Number(row?.characters||0)};
}

export async function purgeTranslationCache(env,tenantId,confirmation){
 if(String(confirmation||'')!==TRANSLATION_CACHE_CONFIRMATION)throw Error('Die Bestätigung für das Löschen des Übersetzungscaches ist nicht exakt richtig.');
 const before=await translationCacheInventory(env,tenantId);
 await env.DB.prepare('DELETE FROM translation_cache WHERE tenant_id=?').bind(tenantId).run();
 return {...before,deleted:true,usageCountersUntouched:true};
}
