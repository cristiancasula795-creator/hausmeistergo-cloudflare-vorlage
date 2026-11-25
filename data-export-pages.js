import {TENANT_BACKUP_TABLES} from './backup-core.js';

export const PAGED_DATA_EXPORT_SCHEMA='hausmeister-pro-company-data-export-stream';
export const PAGED_DATA_EXPORT_VERSION=1;
export const PAGED_DATA_EXPORT_SECTIONS=Object.freeze([...TENANT_BACKUP_TABLES,'accounts','pendingActivations']);

const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw Error('Ungültiger Exportbereich.');return `"${value}"`;};
const tenantColumn=table=>table==='tenants'?'id':'tenant_id';
const cleanRows=rows=>(rows||[]).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='__cursor')));
const boundedLimit=(section,value)=>section==='photo_chunks'?1:Math.max(1,Math.min(100,Number(value)||50));

function sectionQuery(section,tenantId,cursor,limit,count=false){
 if(section==='accounts')return count?{
  sql:'SELECT count(*) AS n FROM tenant_memberships m WHERE m.tenant_id=?',args:[tenantId]
 }:{
  sql:`SELECT m.rowid AS __cursor,u.id,u.name,u.active,u.created_at,m.role,m.active AS membership_active,m.created_at AS membership_created_at,e.email,e.verified_at
    FROM tenant_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN user_recovery_emails e ON e.user_id=u.id
    WHERE m.tenant_id=? AND m.rowid>? ORDER BY m.rowid LIMIT ?`,args:[tenantId,cursor,limit]
 };
 if(section==='pendingActivations')return count?{
  sql:'SELECT count(*) AS n FROM user_email_activations WHERE tenant_id=?',args:[tenantId]
 }:{
  sql:`SELECT rowid AS __cursor,user_id,email,created_at,expires_at FROM user_email_activations
    WHERE tenant_id=? AND rowid>? ORDER BY rowid LIMIT ?`,args:[tenantId,cursor,limit]
 };
 if(!TENANT_BACKUP_TABLES.includes(section))throw Error('Ungültiger Exportbereich.');
 const table=identifier(section),key=identifier(tenantColumn(section));
 return count?{sql:`SELECT count(*) AS n FROM ${table} WHERE ${key}=?`,args:[tenantId]}:{sql:`SELECT rowid AS __cursor,* FROM ${table} WHERE ${key}=? AND rowid>? ORDER BY rowid LIMIT ?`,args:[tenantId,cursor,limit]};
}

export async function pagedDataExportManifest(env,tenantId,{createdAt=new Date().toISOString()}={}){
 const sections=[];
 for(const section of PAGED_DATA_EXPORT_SECTIONS){const query=sectionQuery(section,tenantId,0,1,true),row=await env.DB.prepare(query.sql).bind(...query.args).first();sections.push({name:section,rows:Number(row?.n||0),pageSize:section==='photo_chunks'?1:50});}
 return {schema:PAGED_DATA_EXPORT_SCHEMA,version:PAGED_DATA_EXPORT_VERSION,scope:'tenant',createdAt,tenantId,sections,excludedSecurityData:['password_hash','salt','session_tokens','activation_code_hashes','password_reset_code_hashes','login_throttles']};
}

export async function pagedDataExportPage(env,tenantId,{section,cursor=0,limit}={}){
 section=String(section||'');cursor=Number(cursor||0);if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('Ungültiger Exportcursor.');
 const pageSize=boundedLimit(section,limit),query=sectionQuery(section,tenantId,cursor,pageSize,false),result=await env.DB.prepare(query.sql).bind(...query.args).all(),raw=result.results||[],nextCursor=raw.length?Number(raw.at(-1).__cursor):cursor;
 if(raw.some(row=>!Number.isSafeInteger(Number(row.__cursor))))throw Error('Exportcursor konnte nicht gelesen werden.');
 return {schema:PAGED_DATA_EXPORT_SCHEMA,version:PAGED_DATA_EXPORT_VERSION,scope:'tenant',tenantId,section,rows:cleanRows(raw),nextCursor,done:raw.length<pageSize};
}
