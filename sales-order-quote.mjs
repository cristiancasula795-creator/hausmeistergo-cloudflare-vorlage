import { createPendingPaymentOrder } from './payment-order-state.mjs';

const PUBLIC_PLANS = new Set(['pilot', 'starter', 'team', 'business', 'enterprise']);

function required(value, maximum = 200) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum) throw new Error('invalid-sales-order-field');
  return result;
}

export function serverSalesQuote(packageDefinition) {
  const planCode = required(packageDefinition?.code, 40).toLowerCase();
  if (!PUBLIC_PLANS.has(planCode)) throw new Error('unsupported-sales-plan');
  if (packageDefinition?.active !== true) throw new Error('inactive-sales-plan');
  if (planCode === 'enterprise' || packageDefinition?.monthlyPriceCents === null) throw new Error('individual-quote-required');
  const amountCents = Number(packageDefinition?.monthlyPriceCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('invalid-server-price');
  return Object.freeze({ planCode, amountCents, currency: 'EUR', billingInterval: 'month' });
}

export function createServerQuotedPaymentOrder(input, packageDefinition) {
  const quote = serverSalesQuote(packageDefinition);
  const requestedPlan = required(input?.planCode, 40).toLowerCase();
  if (requestedPlan !== quote.planCode) throw new Error('sales-plan-mismatch');
  return createPendingPaymentOrder({
    id: required(input?.id),
    tenantId: required(input?.tenantId),
    planCode: quote.planCode,
    amountCents: quote.amountCents,
    currency: quote.currency,
    createdAt: Number(input?.createdAt)
  });
}
