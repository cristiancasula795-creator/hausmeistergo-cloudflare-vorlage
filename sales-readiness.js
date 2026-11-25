import {backupConfigurationStatus} from './backup-store.js';
import {platformCostSettings} from './platform-operations.js';
import {listProductPackages} from './product-catalog.js';
import {productPackagesConfigured} from './product-entitlements.js';

const enabled=(env,key)=>String(env?.[key]||'').trim().toLowerCase()==='enabled';
const item=(key,ready,detail)=>({key,ready:ready===true,detail});

export async function platformSalesReadiness(env){
 const [packages,costs]=await Promise.all([listProductPackages(env,{includeInactive:true}),platformCostSettings(env)]),active=packages.filter(value=>value.active),priced=active.filter(value=>value.monthlyPriceCents!==null),commerciallyDefined=active.filter(value=>value.monthlyPriceCents!==null||value.code==='enterprise'),backup=backupConfigurationStatus(env);
 const checks=[
  item('platform_operator',productPackagesConfigured(env),'platform-operator-allow-list'),
  item('active_package',active.length>0,`${active.length}`),
  item('package_prices',active.length>0&&commerciallyDefined.length===active.length,`${commerciallyDefined.length}/${active.length}`),
  item('provider_costs',costs.storageEurPerGbMonth!==null&&costs.emailEurPer1000!==null,'storage-and-email'),
  item('independent_backup',backup.configured,'encrypted-independent-store'),
  item('customer_contract',enabled(env,'CUSTOMER_CONTRACT_FLOW'),'explicit-operator-confirmation'),
  item('customer_payment',enabled(env,'CUSTOMER_PAYMENT_FLOW'),'explicit-operator-confirmation')
 ];
 return {ready:checks.every(value=>value.ready),checks,summary:{catalogPackages:packages.length,activePackages:active.length,pricedActivePackages:priced.length},automaticActivation:false,automaticBilling:false,checkedAt:new Date().toISOString()};
}
