import {createManualTenantBackup} from './manual-backup.js';
import {currentCleanupCandidates,verifyCleanupPreviewToken} from './storage-cleanup-preview.js';

export const STORAGE_CLEANUP_CONFIRMATION='VERWAISTE FOTOS LÖSCHEN';

async function deleteCandidate(env,tenantId,row,cutoff){
 const key=String(row.photo_key),deleted=await env.DB.prepare("DELETE FROM photo_chunks WHERE tenant_id=? AND photo_key=? AND created_at>0 AND created_at<? AND NOT EXISTS (SELECT 1 FROM records WHERE tenant_id=? AND body LIKE '%' || ? || '%') RETURNING length(data) AS bytes").bind(tenantId,key,cutoff,tenantId,key).all(),bytes=(deleted.results||[]).reduce((sum,item)=>sum+Number(item.bytes||0),0);
 if(bytes)await env.DB.prepare('DELETE FROM photo_share_tokens WHERE tenant_id=? AND photo_key=?').bind(tenantId,key).run();
 return bytes;
}

/** Gated cleanup with a fresh encrypted backup and a final inventory recheck. */
export async function applyStorageCleanup(env,tenantId,{confirmationToken,confirmation,acknowledgePermanentDeletion}={},options={}){
 if(String(env?.TENANT_STORAGE_CLEANUP||'')!=='enabled')throw Error('Die Speicherbereinigung ist serverseitig noch nicht ausdrücklich freigeschaltet.');
 if(String(confirmation||'')!==STORAGE_CLEANUP_CONFIRMATION||acknowledgePermanentDeletion!==true)throw Error('Die Speicherbereinigung wurde nicht vollständig bestätigt.');
 const now=Number(options.now||Date.now()),dependencies=options.dependencies||{},analyze=dependencies.currentCleanupCandidates||currentCleanupCandidates,verify=dependencies.verifyCleanupPreviewToken||verifyCleanupPreviewToken,backup=dependencies.createManualTenantBackup||createManualTenantBackup,remove=dependencies.deleteCandidate||deleteCandidate;
 const before=await analyze(env,tenantId,{now});if(before.eligibleRows.length>1000)throw Error('Zu viele Bereinigungskandidaten. Bitte den Bestand zuerst durch den Support prüfen.');
 await verify(env.TENANT_BACKUP_SECRET,String(confirmationToken||''),{tenantId,candidateDigest:before.candidateDigest,now});
 const safetyBackup=await backup(env,tenantId,{createdAt:new Date(now).toISOString()});
 const current=await analyze(env,tenantId,{now});if(current.candidateDigest!==before.candidateDigest)throw Error('Der Datenbestand hat sich während der Sicherung geändert. Die Bereinigung wurde nicht ausgeführt.');
 let deletedBytes=0,deletedPhotos=0;for(const row of current.eligibleRows){const bytes=await remove(env,tenantId,row,current.cutoff);if(bytes){deletedBytes+=bytes;deletedPhotos++;}}
 if(deletedBytes)await env.DB.prepare('UPDATE tenant_storage_usage SET used=MAX(0,used-?) WHERE tenant_id=?').bind(deletedBytes,tenantId).run();
 return {deletedPhotos,deletedBytes,safetyBackup:{backupId:safetyBackup.backupId,createdAt:safetyBackup.createdAt,encrypted:safetyBackup.encrypted===true,complete:safetyBackup.complete===true},inventoryRechecked:true,unknownAgePhotosProtected:current.inventory.orphanPhotos.unknownAgeCount};
}
