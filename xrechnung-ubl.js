const CUSTOMIZATION_ID='urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const PROFILE_ID='urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
const SMALL_BUSINESS_REASON='Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';
const UNIT_CODES=new Map([
 ['stück','C62'],['stueck','C62'],['einsatz','C62'],['stunde','HUR'],['stunden','HUR'],
 ['m²','MTK'],['m2','MTK'],['lfm','MTR'],['meter','MTR'],['pauschal','LS']
]);

const text=value=>String(value??'').trim();
const xml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const money=cents=>{
 const value=Number(cents);
 if(!Number.isSafeInteger(value))throw Error('Geldbetrag ist ungültig.');
 return (value/100).toFixed(2);
};
const quantity=milli=>{
 const value=Number(milli);
 if(!Number.isSafeInteger(value)||value<=0)throw Error('Menge ist ungültig.');
 return (value/1000).toFixed(3).replace(/\.?0+$/,'');
};
const isoDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value))?text(value):'';
const country=value=>/^[A-Z]{2}$/.test(text(value).toUpperCase())?text(value).toUpperCase():'';
const email=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value))?text(value):'';
const unitCode=value=>UNIT_CODES.get(text(value).toLocaleLowerCase('de-DE'))||'C62';

function requireValue(value,label,missing){if(!value)missing.push(label);return value;}
function party(input,prefix,missing){
 return {
  name:requireValue(text(input[`${prefix}Name`]),`${prefix}Name`,missing),
  street:requireValue(text(input[`${prefix}Street`]),`${prefix}Street`,missing),
  postalCode:requireValue(text(input[`${prefix}PostalCode`]),`${prefix}PostalCode`,missing),
  city:requireValue(text(input[`${prefix}City`]),`${prefix}City`,missing),
  countryCode:requireValue(country(input[`${prefix}CountryCode`]),`${prefix}CountryCode`,missing),
  email:requireValue(email(input[`${prefix}Email`]),`${prefix}Email`,missing),
 };
}
function taxCategory(taxBasisPoints,taxMode){
 const rate=Number(taxBasisPoints||0);
 if(taxMode==='small_business')return {id:'E',rate:0,reason:SMALL_BUSINESS_REASON};
 if(!Number.isSafeInteger(rate)||rate<0||rate>10000)throw Error('Steuersatz ist ungültig.');
 return {id:'S',rate:rate/100,reason:''};
}
function taxXml(category){return `<cac:TaxCategory><cbc:ID>${category.id}</cbc:ID><cbc:Percent>${category.rate}</cbc:Percent>${category.reason?`<cbc:TaxExemptionReason>${xml(category.reason)}</cbc:TaxExemptionReason>`:''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`;}

export function buildXRechnungUblInvoice(input){
 const missing=[],seller=party(input,'seller',missing),buyer=party(input,'customer',missing),
  id=requireValue(text(input.invoiceNumber),'invoiceNumber',missing),
  issueDate=requireValue(isoDay(input.issuedOn),'issuedOn',missing),
  dueDate=requireValue(isoDay(input.dueOn),'dueOn',missing),
  serviceDate=requireValue(isoDay(input.serviceDate),'serviceDate',missing),
  buyerReference=requireValue(text(input.buyerReference),'buyerReference',missing),
  sellerIdentifier=requireValue(text(input.sellerIdentifier),'sellerIdentifier',missing),
  sellerTaxId=requireValue(text(input.sellerTaxId),'sellerTaxId',missing),
  contactName=requireValue(text(input.sellerContactName),'sellerContactName',missing),
  contactPhone=requireValue(text(input.sellerPhone),'sellerPhone',missing),
  iban=requireValue(text(input.iban).replace(/\s+/g,'').toUpperCase(),'iban',missing),
  currency=text(input.currency||'EUR').toUpperCase(),taxMode=input.taxMode==='vat'?'vat':'small_business';
 if(!/^[A-Z]{3}$/.test(currency))missing.push('currency');
 if(!/^DE[0-9]{20}$/.test(iban))missing.push('validIban');
 const lines=Array.isArray(input.lines)?input.lines:[];
 if(!lines.length)missing.push('lines');
 if(missing.length)throw Error(`XRechnung-Pflichtangaben fehlen oder sind ungültig: ${[...new Set(missing)].join(', ')}`);
 const normalized=lines.map((line,index)=>{
  const description=text(line.description),quantityMilli=Number(line.quantityMilli),unitCents=Number(line.unitCents),netCents=Number(line.netCents),taxBasisPoints=taxMode==='vat'?Number(line.taxBasisPoints):0;
  if(!description||description.length>300||!Number.isSafeInteger(quantityMilli)||quantityMilli<=0||!Number.isSafeInteger(unitCents)||unitCents<0||!Number.isSafeInteger(netCents)||netCents<0||Math.round(quantityMilli*unitCents/1000)!==netCents)throw Error(`Dokumentposition ${index+1} ist für XRechnung ungültig.`);
  const calculatedTax=Math.round(netCents*taxBasisPoints/10000),taxCents=Number(line.taxCents||0);if(calculatedTax!==taxCents)throw Error(`Steuerbetrag in Dokumentposition ${index+1} stimmt nicht.`);
  return {id:index+1,description,quantityMilli,unit:text(line.unit||'Stück'),unitCents,netCents,taxCents,taxBasisPoints,category:taxCategory(taxBasisPoints,taxMode)};
 });
 const subtotalCents=normalized.reduce((sum,line)=>sum+line.netCents,0),taxCents=normalized.reduce((sum,line)=>sum+line.taxCents,0),totalCents=subtotalCents+taxCents;
 if(Number(input.subtotalCents)!==subtotalCents||Number(input.taxCents)!==taxCents||Number(input.totalCents)!==totalCents)throw Error('Dokumentsummen stimmen für XRechnung nicht.');
 const groups=new Map();for(const line of normalized){const key=`${line.category.id}:${line.taxBasisPoints}`,group=groups.get(key)||{category:line.category,taxableCents:0,taxCents:0};group.taxableCents+=line.netCents;group.taxCents+=line.taxCents;groups.set(key,group);}
 const note=text(input.note),paymentTerms=text(input.paymentTerms||`Zahlbar bis ${dueDate} ohne Abzug.`),legalInfo=taxMode==='small_business'?SMALL_BUSINESS_REASON:text(input.sellerLegalInfo||'');
 return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID><cbc:ProfileID>${PROFILE_ID}</cbc:ProfileID><cbc:ID>${xml(id)}</cbc:ID><cbc:IssueDate>${issueDate}</cbc:IssueDate><cbc:DueDate>${dueDate}</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${note?`<cbc:Note>${xml(note)}</cbc:Note>`:''}<cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode><cbc:BuyerReference>${xml(buyerReference)}</cbc:BuyerReference>
<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="EM">${xml(seller.email)}</cbc:EndpointID><cac:PartyIdentification><cbc:ID>${xml(sellerIdentifier)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${xml(seller.name)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${xml(seller.street)}</cbc:StreetName><cbc:CityName>${xml(seller.city)}</cbc:CityName><cbc:PostalZone>${xml(seller.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${seller.countryCode}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${xml(sellerTaxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${xml(seller.name)}</cbc:RegistrationName>${legalInfo?`<cbc:CompanyLegalForm>${xml(legalInfo)}</cbc:CompanyLegalForm>`:''}</cac:PartyLegalEntity><cac:Contact><cbc:Name>${xml(contactName)}</cbc:Name><cbc:Telephone>${xml(contactPhone)}</cbc:Telephone><cbc:ElectronicMail>${xml(seller.email)}</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="EM">${xml(buyer.email)}</cbc:EndpointID><cac:PostalAddress><cbc:StreetName>${xml(buyer.street)}</cbc:StreetName><cbc:CityName>${xml(buyer.city)}</cbc:CityName><cbc:PostalZone>${xml(buyer.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${buyer.countryCode}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyLegalEntity><cbc:RegistrationName>${xml(buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:Delivery><cbc:ActualDeliveryDate>${serviceDate}</cbc:ActualDeliveryDate></cac:Delivery>
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${iban}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans><cac:PaymentTerms><cbc:Note>${xml(paymentTerms)}</cbc:Note></cac:PaymentTerms>
<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${money(taxCents)}</cbc:TaxAmount>${[...groups.values()].map(group=>`<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${money(group.taxableCents)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${money(group.taxCents)}</cbc:TaxAmount>${taxXml(group.category)}</cac:TaxSubtotal>`).join('')}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${currency}">${money(subtotalCents)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${currency}">${money(subtotalCents)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${currency}">${money(totalCents)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${currency}">${money(totalCents)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${normalized.map(line=>`<cac:InvoiceLine><cbc:ID>${line.id}</cbc:ID><cbc:InvoicedQuantity unitCode="${unitCode(line.unit)}">${quantity(line.quantityMilli)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${currency}">${money(line.netCents)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${xml(line.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${line.category.id}</cbc:ID><cbc:Percent>${line.category.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${currency}">${money(line.unitCents)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join('\n')}
</ubl:Invoice>`;
}

export const xrechnungConstants={CUSTOMIZATION_ID,PROFILE_ID,SMALL_BUSINESS_REASON};
