export const LOGIN_THROTTLE_RETENTION_MS=24*60*60*1000;

/** Removes only expired or no-longer-effective authentication artefacts. */
export async function purgeExpiredAuthArtifacts(env,{nowMs=Date.now()}={}){
 const nowSeconds=Math.floor(nowMs/1000),staleFailureBefore=nowMs-LOGIN_THROTTLE_RETENTION_MS;
 await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(nowSeconds),
  env.DB.prepare('DELETE FROM password_resets WHERE expires_at<=?').bind(nowSeconds),
  env.DB.prepare('DELETE FROM login_throttles WHERE locked_until<=? AND last_failed_at<?').bind(nowMs,staleFailureBefore),
 ]);
 return {sessionsExpiredAtOrBefore:nowSeconds,passwordResetsExpiredAtOrBefore:nowSeconds,loginFailuresOlderThan:staleFailureBefore};
}
