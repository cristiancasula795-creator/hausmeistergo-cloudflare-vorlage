import {decryptTenantBackup,validateTenantSnapshot} from './backup-core.js';
import {backupConfigurationStatus,listCompleteTenantBackups,loadEncryptedTenantBackup} from './backup-store.js';

const encoder=new TextEncoder();
const base64url=value=>{let binary='';for(const byte of value)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const unbase64url=value=>Uint8Array.from(atob(String(value).replaceAll('-','+').replaceAll('_','/')+'==='.slice((String(value).length+3)%4)),character=>character.charCodeAt(0));
const equal=(a,b)=>{if(a.length!==b.length)return false;let result=0;for(let index=0;index<a.length;index++)result|=a[index]^b[index];return result===0;};
async function tokenKey(secret){return crypto.subtle.importKey('raw',encoder.encode(`Hausmeister Pro restore preview\n${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function restorePreviewToken(secret,{tenantId,backupId,expiresAt}){const payload=base64url(encoder.encode(JSON.stringify({tenantId,backupId,expiresAt}))),signature=base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await tokenKey(secret),encoder.encode(payload))));return `${payload}.${signature}`;}
export async function verifyRestorePreviewToken(secret,token,{tenantId,backupId,now=Date.now()}={}){try{const [payload,signature,...rest]=String(token||'').split('.');if(!payload||!signature||rest.length)throw Error();const expected=new Uint8Array(await crypto.subtle.sign('HMAC',await tokenKey(secret),encoder.encode(payload)));if(!equal(expected,unbase64url(signature)))throw Error();const row=JSON.parse(new TextDecoder().decode(unbase64url(payload)));if(row.tenantId!==tenantId||row.backupId!==backupId||!Number.isFinite(row.expiresAt)||row.expiresAt<now)throw Error();return row;}catch{throw Error('Die Wiederherstellungsvorschau ist ungültig oder abgelaufen.');}}

const cleanId=value=>{
 const id=String(value||'').trim();
 if(!id||id.length>200||!/^[0-9A-Za-z.-]+$/.test(id))throw Error('Ungültige Sicherungskennung.');
 return id;
};

export async function listTenantBackupSummaries(env,tenantId,{dependencies={}}={}){
 const configuration=backupConfigurationStatus(env);
 if(!configuration.configured)throw Error('Unabhängiger Sicherungsspeicher und Serverschlüssel sind noch nicht vollständig eingerichtet.');
 const list=dependencies.listCompleteTenantBackups||listCompleteTenantBackups;
 const backups=await list(env.TENANT_BACKUP_STORE,tenantId);
 return {action:'list-only',restoreEnabled:false,backups:backups.map(item=>({backupId:item.backupId,createdAt:item.createdAt,reason:item.reason==='manual'?'manual':'daily',encrypted:true,complete:true,plainBytes:Number(item.metadata?.plainBytes||0)}))};
}

export async function previewTenantBackupRestore(env,tenantId,backupId,{dependencies={},now=Date.now()}={}){
 const configuration=backupConfigurationStatus(env);
 if(!configuration.configured)throw Error('Unabhängiger Sicherungsspeicher und Serverschlüssel sind noch nicht vollständig eingerichtet.');
 backupId=cleanId(backupId);
 const list=dependencies.listCompleteTenantBackups||listCompleteTenantBackups,load=dependencies.loadEncryptedTenantBackup||loadEncryptedTenantBackup,decrypt=dependencies.decryptTenantBackup||decryptTenantBackup;
 const backups=await list(env.TENANT_BACKUP_STORE,tenantId),selected=backups.find(item=>item.backupId===backupId);
 if(!selected)throw Error('Die ausgewählte vollständige Sicherung wurde nicht gefunden.');
 const loaded=await load(env.TENANT_BACKUP_STORE,selected.manifestKey),snapshot=validateTenantSnapshot(await decrypt(loaded.envelope,env.TENANT_BACKUP_SECRET));
 if(snapshot.tenantId!==tenantId)throw Error('Die Sicherung gehört nicht zum gewählten Firmenbereich.');
 const tables=Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,rows.length])),totalRows=Object.values(tables).reduce((sum,count)=>sum+count,0);
 const targetExists=dependencies.targetTenantExists?await dependencies.targetTenantExists(env,tenantId):!!await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first(),companyName=String(snapshot.tables.tenants[0]?.name||'').trim(),expiresAt=now+10*60*1000,createToken=dependencies.restorePreviewToken||restorePreviewToken,confirmationToken=await createToken(env.TENANT_BACKUP_SECRET,{tenantId,backupId:selected.backupId,expiresAt});
 return {action:'preview-only',restoreEnabled:false,backup:{backupId:selected.backupId,createdAt:selected.createdAt,reason:selected.reason==='manual'?'manual':'daily',encrypted:true,complete:true},inventory:{tables,totalRows},companyName,targetExists,replacementRequired:targetExists,requiresFreshBackup:true,requiresExactTenantName:true,requiresPassword:true,confirmationToken,confirmationExpiresAt:expiresAt};
}
