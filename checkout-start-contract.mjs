import { createServerQuotedPaymentOrder } from './sales-order-quote.mjs';
import { createPendingCustomerSetup } from './customer-setup-state.mjs';

const FORBIDDEN_FIELDS = ['password', 'cardNumber', 'cardCvc', 'iban', 'bankAccount', 'paymentToken'];

function required(value, maximum) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum) throw new Error('invalid-checkout-field');
  return result;
}

export function buildPendingCheckout(input, packageDefinition, trusted) {
  for (const field of FORBIDDEN_FIELDS) if (input?.[field] !== undefined) throw new Error('sensitive-checkout-field-rejected');
  const companyName = required(input?.companyName, 160);
  const email = required(input?.email, 320).toLowerCase();
  const planCode = required(input?.planCode, 40).toLowerCase();
  const createdAt = Number(trusted?.createdAt);
  const expiresAt = Number(trusted?.expiresAt);
  const order = createServerQuotedPaymentOrder({
    id: required(trusted?.orderId, 200),
    tenantId: required(trusted?.reservedTenantId, 200),
    planCode,
    createdAt
  }, packageDefinition);
  const setup = createPendingCustomerSetup({
    id: required(trusted?.setupId, 200),
    orderId: order.id,
    companyName,
    email,
    planCode: order.planCode,
    createdAt,
    expiresAt
  });
  return Object.freeze({ order, setup });
}
