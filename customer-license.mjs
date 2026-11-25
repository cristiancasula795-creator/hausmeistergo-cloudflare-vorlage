const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const plans = new Set(DEFAULT_PRODUCT_PACKAGES.map(product => product.code));

function fromBase64Url(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Ungültiges Lizenzformat.');
  }
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}

// The configured public key must come from the app vendor, never from the license file.
export async function verifyCustomerLicense(license, publicKey, {tenantId, serverOrigin, now = Date.now()}) {
  const payload = fromBase64Url(license?.payload, 8192);
  const signature = fromBase64Url(license?.signature, 86);
  if (signature.length !== 64 || !await crypto.subtle.verify('Ed25519', publicKey, signature, payload)) {
    throw new Error('Die Lizenzsignatur ist ungültig.');
  }
  const data = JSON.parse(decoder.decode(payload));
  if (data.version !== 1 || typeof tenantId !== 'string' || !tenantId || data.tenantId !== tenantId ||
      typeof serverOrigin !== 'string' || !serverOrigin || data.serverOrigin !== serverOrigin ||
      !plans.has(data.plan) || !Number.isSafeInteger(data.validUntil)) {
    throw new Error('Die Lizenz gehört nicht zu dieser Firma oder diesem Server.');
  }
  if (data.validUntil <= now) throw new Error('Die Lizenz ist abgelaufen.');
  return Object.freeze({plan: data.plan, validUntil: data.validUntil});
}

export function customerLicensePayload(data) {
  return utf8.encode(JSON.stringify(data));
}

export async function importCustomerLicensePublicKey(value) {
  const bytes = fromBase64Url(value, 43);
  if (bytes.length !== 32) throw new Error('Ungültiger öffentlicher Lizenzschlüssel.');
  return crypto.subtle.importKey('raw', bytes, 'Ed25519', false, ['verify']);
}
import { DEFAULT_PRODUCT_PACKAGES, productPackage } from './product-catalog.js';
import { assignProductEntitlement } from './product-entitlements.js';


// Call only after authorizing the company administrator on the customer server.
export class CustomerLicenseError extends Error {}

export async function activateCustomerLicense(env, license, publicKey, {tenantId, serverOrigin, actorUserId, now = Date.now()}) {
  let verified;
  try {
    verified = await verifyCustomerLicense(license, publicKey, {tenantId, serverOrigin, now});
  } catch (error) {
    throw new CustomerLicenseError(error instanceof SyntaxError || error instanceof TypeError
      ? 'Ungültige Lizenzdatei.'
      : error.message);
  }
  const {plan, validUntil} = verified;
  const product = await productPackage(env, plan);
  if (!product?.active) throw new CustomerLicenseError('Das Lizenzpaket ist nicht verfügbar.');

  return assignProductEntitlement(env, tenantId, {
    planCode: product.code,
    status: 'active',
    userLimit: product.userLimit,
    storageLimitBytes: product.storageLimitBytes,
    features: product.features,
    currentPeriodEndsAt: validUntil,
    cancelAtPeriodEnd: true
  }, actorUserId, {now});
}
