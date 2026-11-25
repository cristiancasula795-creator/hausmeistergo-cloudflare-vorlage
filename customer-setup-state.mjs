const PLAN_CODES = new Set(['pilot', 'starter', 'team', 'business', 'enterprise']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function required(value, maximum = 200) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum) throw new Error('invalid-customer-setup-field');
  return result;
}

export function createPendingCustomerSetup(input) {
  const id = required(input?.id);
  const orderId = required(input?.orderId);
  const companyName = required(input?.companyName, 160);
  const email = required(input?.email, 320).toLowerCase();
  const planCode = required(input?.planCode, 40).toLowerCase();
  const createdAt = Number(input?.createdAt);
  const expiresAt = Number(input?.expiresAt);
  if (!EMAIL.test(email)) throw new Error('invalid-customer-setup-email');
  if (!PLAN_CODES.has(planCode)) throw new Error('unsupported-customer-setup-plan');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error('invalid-customer-setup-time');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) throw new Error('invalid-customer-setup-expiry');
  return Object.freeze({
    id,
    orderId,
    companyName,
    email,
    planCode,
    status: 'pending',
    emailVerifiedAt: 0,
    paymentVerifiedAt: 0,
    provisionedAt: 0,
    createdAt,
    expiresAt
  });
}

function active(setup, occurredAt) {
  if (!setup || setup.status !== 'pending') throw new Error('customer-setup-not-pending');
  if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0) throw new Error('invalid-customer-setup-time');
  if (occurredAt > setup.expiresAt) throw new Error('customer-setup-expired');
}

export function confirmCustomerEmail(setup, input) {
  const occurredAt = Number(input?.occurredAt);
  active(setup, occurredAt);
  if (required(input?.setupId) !== setup.id) throw new Error('customer-setup-mismatch');
  if (required(input?.email, 320).toLowerCase() !== setup.email) throw new Error('customer-setup-mismatch');
  return Object.freeze({ ...setup, emailVerifiedAt: occurredAt });
}

export function confirmCustomerPayment(setup, order, occurredAt) {
  active(setup, occurredAt);
  if (!order || order.id !== setup.orderId || order.planCode !== setup.planCode) throw new Error('customer-setup-mismatch');
  if (order.status !== 'paid') throw new Error('customer-payment-not-verified');
  return Object.freeze({ ...setup, paymentVerifiedAt: occurredAt });
}

export function customerProvisioningAllowed(setup, now) {
  return !!setup
    && setup.status === 'pending'
    && Number(setup.emailVerifiedAt) > 0
    && Number(setup.paymentVerifiedAt) > 0
    && Number(now) <= setup.expiresAt;
}

export function markCustomerProvisioned(setup, input) {
  const occurredAt = Number(input?.occurredAt);
  if (!customerProvisioningAllowed(setup, occurredAt)) throw new Error('customer-provisioning-not-allowed');
  if (required(input?.setupId) !== setup.id || required(input?.orderId) !== setup.orderId) throw new Error('customer-setup-mismatch');
  return Object.freeze({ ...setup, status: 'provisioned', provisionedAt: occurredAt });
}
