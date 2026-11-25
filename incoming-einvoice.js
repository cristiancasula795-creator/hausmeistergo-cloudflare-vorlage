const encoder=new TextEncoder();
const MAX_XML_BYTES=2*1024*1024;
const XML_FILE=/^[^\\/:*?"<>|\u0000-\u001f]{1,180}\.xml$/i;
const FORBIDDEN_XML=/(?:<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<xi:include\b|\u0000)/i;

export const INCOMING_EINVOICE_SCHEMA=`CREATE TABLE IF NOT EXISTS incoming_einvoices(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 id TEXT NOT NULL,
 filename TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN('ubl-invoice','cii-invoice')),
 sha256 TEXT NOT NULL,
 byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=${MAX_XML_BYTES}),
 original_xml TEXT NOT NULL,
 validation_status TEXT NOT NULL DEFAULT 'pending' CHECK(validation_status IN('pending','accepted','rejected')),
 invoice_date TEXT,
 retention_until INTEGER NOT NULL,
 uploaded_by TEXT NOT NULL,
 uploaded_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,sha256)
)`;

const hex=value=>[...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const randomId=()=>{const value=new Uint8Array(16);crypto.getRandomValues(value);return hex(value);};

function rootFormat(xml){
 const start=xml.replace(/^\uFEFF/,'').replace(/^\s*<\?xml[\s\S]*?\?>/i,'').replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/,'').trimStart();
 if(/^<(?:[A-Za-z_][\w.-]*:)?Invoice\b/i.test(start)&&/urn:oasis:names:specification:ubl:schema:xsd:Invoice-2/i.test(start.slice(0,5000)))return 'ubl-invoice';
 if(/^<(?:[A-Za-z_][\w.-]*:)?CrossIndustryInvoice\b/i.test(start)&&/urn:un:unece:uncefact:data:standard:CrossIndustryInvoice/i.test(start.slice(0,5000)))return 'cii-invoice';
 return '';
}

function validIsoDay(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!match)return '';
 const date=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:'';
}

function invoiceDate(format,xml){
 if(format==='ubl-invoice')return validIsoDay((/<(?:[A-Za-z_][\w.-]*:)?IssueDate\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*</i.exec(xml)||[])[1]);
 const compact=(/<(?:[A-Za-z_][\w.-]*:)?IssueDateTime\b[\s\S]*?<(?:(?:[A-Za-z_][\w.-]*):)?DateTimeString\b[^>]*\bformat=["']102["'][^>]*>\s*(\d{8})\s*</i.exec(xml)||[])[1];
 return compact?validIsoDay(`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`):'';
}

export function minimumInvoiceRetentionUntil(issueDate,now=Date.now()){
 const safeIssueDate=validIsoDay(issueDate),year=safeIssueDate?Number(safeIssueDate.slice(0,4)):new Date(now).getUTCFullYear();
 if(!Number.isInteger(year)||year<1900||year>9990)throw Error('Das Rechnungsjahr ist ungültig.');
 return Date.UTC(year+9,0,1)-1;
}

export async function inspectIncomingEInvoice({filename,xml}){
 filename=String(filename||'').trim();xml=String(xml||'');
 if(!XML_FILE.test(filename))throw Error('Bitte eine XML-Datei mit einem sicheren Dateinamen auswählen.');
 const byteLength=encoder.encode(xml).length;
 if(!byteLength)throw Error('Die XML-Datei ist leer.');
 if(byteLength>MAX_XML_BYTES)throw Error('Die XML-Datei ist größer als 2 MB.');
 if(FORBIDDEN_XML.test(xml))throw Error('Die XML-Datei enthält nicht erlaubte externe oder ausführbare XML-Bestandteile.');
 const format=rootFormat(xml);
 if(!format)throw Error('Die Datei ist keine erkennbare UBL- oder CII-Rechnung.');
 const extractedInvoiceDate=invoiceDate(format,xml);
 return {filename,format,sha256:await digest(xml),byteLength,originalXml:xml,validationStatus:'pending',invoiceDate:extractedInvoiceDate||null};
}

export async function archiveIncomingEInvoice(env,{tenantId,userId,filename,xml,now=Date.now(),id=randomId()}={}){
 tenantId=String(tenantId||'').trim();userId=String(userId||'').trim();
 if(!tenantId||!userId)throw Error('Firma und angemeldetes Konto sind erforderlich.');
 const inspected=await inspectIncomingEInvoice({filename,xml}),retentionUntil=minimumInvoiceRetentionUntil(inspected.invoiceDate,now);
 await env.DB.prepare(INCOMING_EINVOICE_SCHEMA).run();
 const existing=await env.DB.prepare('SELECT id,filename,format,sha256,byte_length AS byteLength,validation_status AS validationStatus,invoice_date AS invoiceDate,retention_until AS retentionUntil,uploaded_at AS uploadedAt FROM incoming_einvoices WHERE tenant_id=? AND sha256=?').bind(tenantId,inspected.sha256).first();
 if(existing)return {created:false,invoice:existing};
 await env.DB.prepare('INSERT INTO incoming_einvoices(tenant_id,id,filename,format,sha256,byte_length,original_xml,validation_status,invoice_date,retention_until,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(tenantId,id,inspected.filename,inspected.format,inspected.sha256,inspected.byteLength,inspected.originalXml,'pending',inspected.invoiceDate,retentionUntil,userId,now).run();
 return {created:true,invoice:{id,filename:inspected.filename,format:inspected.format,sha256:inspected.sha256,byteLength:inspected.byteLength,validationStatus:'pending',invoiceDate:inspected.invoiceDate,retentionUntil,uploadedAt:now}};
}

export const incomingEInvoiceLimits=Object.freeze({maxXmlBytes:MAX_XML_BYTES});
