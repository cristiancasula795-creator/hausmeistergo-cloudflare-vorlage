const SEVERITIES=new Set(['info','warning','critical']);
const MAX_DURATION_MS=31*24*60*60*1000;

const clean=value=>String(value||'').trim();
const finiteTime=value=>{const number=Number(value);return Number.isFinite(number)&&number>=0?Math.trunc(number):0;};

export function validateSystemNotice(value,now=Date.now()){
 const active=value?.active===true,severity=clean(value?.severity)||'info',title=clean(value?.title),message=clean(value?.message),startsAt=finiteTime(value?.startsAt)||now,endsAt=finiteTime(value?.endsAt);
 if(!SEVERITIES.has(severity))throw [400,'Bitte Information, Warnung oder kritisch auswählen.'];
 if(title.length>100)throw [400,'Die Überschrift darf höchstens 100 Zeichen haben.'];
 if(message.length>600)throw [400,'Der Hinweis darf höchstens 600 Zeichen haben.'];
 if(active&&(!title||!message))throw [400,'Für einen aktiven Wartungshinweis sind Überschrift und Text erforderlich.'];
 if(active&&(!endsAt||endsAt<=startsAt))throw [400,'Das Ende muss nach dem Beginn liegen.'];
 if(active&&endsAt-startsAt>MAX_DURATION_MS)throw [400,'Ein Wartungshinweis darf höchstens 31 Tage gelten.'];
 return {active,severity,title,message,startsAt,endsAt:active?endsAt:0};
}

export function publicSystemNotice(row,now=Date.now()){
 if(!row||Number(row.active)!==1)return null;
 const startsAt=finiteTime(row.starts_at),endsAt=finiteTime(row.ends_at);
 if(startsAt>now||!endsAt||endsAt<=now)return null;
 const severity=SEVERITIES.has(row.severity)?row.severity:'info',title=clean(row.title),message=clean(row.message);
 if(!title||!message)return null;
 return {severity,title,message,startsAt,endsAt};
}

export const SYSTEM_NOTICE_SCHEMA="CREATE TABLE IF NOT EXISTS system_notice (id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN('info','warning','critical')),title TEXT NOT NULL DEFAULT '',message TEXT NOT NULL DEFAULT '',starts_at INTEGER NOT NULL DEFAULT 0,ends_at INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL)";
