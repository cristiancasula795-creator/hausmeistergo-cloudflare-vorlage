import {tenantStorageAnalysis} from './storage-inventory.js';

const encoder=new TextEncoder();
const base64url=value=>{let binary='';for(const byte of value)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const unbase64url=value=>Uint8Array.from(atob(String(value).replaceAll('-','+').replaceAll('_','/')+'==='.slice((String(value).length+3)%4)),character=>character.charCodeAt(0));
const equal=(a,b)=>{if(a.length!==b.length)return false;let result=0;for(let index=0;index<a.length;index++)result|=a[index]^b[index];return result===0;};
const hex=value=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
async function digest(rows){
 const payload=JSON.stringify(rows.map(row=>[String(row.photo_key),Number(row.bytes||0),Number(row.last_created_at||0)]));
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(payload))));
}
async function tokenKey(secret){return crypto.subtle.importKey('raw',encoder.encode(`Hausmeister Pro storage cleanup preview\n${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function cleanupPreviewToken(secret,{tenantId,candidateDigest,expiresAt}){const payload=base64url(encoder.encode(JSON.stringify({tenantId,candidateDigest,expiresAt}))),signature=base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await tokenKey(secret),encoder.encode(payload))));return `${payload}.${signature}`;}
export async function verifyCleanupPreviewToken(secret,token,{tenantId,candidateDigest,now=Date.now()}={}){try{const [payload,signature,...rest]=String(token||'').split('.');if(!payload||!signature||rest.length)throw Error();const expected=new Uint8Array(await crypto.subtle.sign('HMAC',await tokenKey(secret),encoder.encode(payload)));if(!equal(expected,unbase64url(signature)))throw Error();const row=JSON.parse(new TextDecoder().decode(unbase64url(payload)));if(row.tenantId!==tenantId||row.candidateDigest!==candidateDigest||!Number.isFinite(row.expiresAt)||row.expiresAt<now)throw Error();return row;}catch{throw Error('Die Bereinigungsvorschau ist ungültig, abgelaufen oder der Datenbestand hat sich geändert.');}}

/** Password-gated cleanup impact preview. It deliberately exposes no photo keys and performs no deletion. */
export async function storageCleanupPreview(env,tenantId,options={}){
 if(String(env?.TENANT_BACKUP_SECRET||'').length<32)throw Error('Der geschützte Serverschlüssel ist noch nicht vollständig eingerichtet.');
 const {inventory,eligibleRows}=await tenantStorageAnalysis(env,tenantId,options),orphans=inventory.orphanPhotos;
 if(!orphans.detectionComplete)throw Error('Die Bereinigung kann erst geprüft werden, wenn alle Firmendatensätze lesbar sind.');
 const now=Number(options.now||Date.now()),candidateDigest=await digest(eligibleRows),confirmationExpiresAt=now+10*60*1000,confirmationToken=await cleanupPreviewToken(env.TENANT_BACKUP_SECRET,{tenantId,candidateDigest,expiresAt:confirmationExpiresAt});
 return {tenantId,action:'preview-only',cleanupEnabled:String(env.TENANT_STORAGE_CLEANUP||'')==='enabled',eligiblePhotos:orphans.eligibleCount,eligibleBytes:orphans.eligibleBytes,retentionDays:orphans.retentionDays,protectedUnknownAgePhotos:orphans.unknownAgeCount,requiresFreshBackup:true,requiresPassword:true,requiresExactConfirmation:true,requiresInventoryRecheck:true,confirmationToken,confirmationExpiresAt};
}
export async function currentCleanupCandidates(env,tenantId,options={}){const analysis=await tenantStorageAnalysis(env,tenantId,options);if(!analysis.inventory.orphanPhotos.detectionComplete)throw Error('Die Bereinigung kann erst geprüft werden, wenn alle Firmendatensätze lesbar sind.');return {...analysis,candidateDigest:await digest(analysis.eligibleRows)};}
