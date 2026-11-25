const PLAN_CODES = new Set(['pilot', 'starter', 'team', 'business', 'enterprise']);
const CURRENCIES = /^[A-Z]{3}$/;

function required(value, maximum = 200) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum) throw new Error('invalid-order-field');
  return result;
}

export function createPendingPaymentOrder(input) {
  const id = required(input?.id);
  const tenantId = required(input?.tenantId);
  const planCode = required(input?.planCode, 40).toLowerCase();
  const amountCents = Number(input?.amountCents);
  const currency = required(input?.currency, 3).toUpperCase();
  const createdAt = Number(input?.createdAt);
  if (!PLAN_CODES.has(planCode)) throw new Error('unsupported-order-plan');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('invalid-order-amount');
  if (!CURRENCIES.test(currency)) throw new Error('invalid-order-currency');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error('invalid-order-time');
  return Object.freeze({ id, tenantId, planCode, amountCents, currency, status: 'awaiting_payment', createdAt, paidAt: 0, refundedAt: 0 });
}

function sameOrder(order, event) {
  return event.orderId === order.id
    && event.tenantId === order.tenantId
    && event.planCode === order.planCode
    && event.amountCents === order.amountCents
    && event.currency === order.currency;
}

export function applyVerifiedPaymentEvent(order, event, processedEventKeys = new Set()) {
  if (!order || !event || !event.idempotencyKey) throw new Error('invalid-payment-order-event');
  if (processedEventKeys.has(event.idempotencyKey)) return { order, duplicate: true, dataDeletionAllowed: false };
  if (!sameOrder(order, event)) throw new Error('payment-order-mismatch');

  let next;
  if (event.eventType === 'payment_succeeded') {
    if (!['awaiting_payment', 'payment_failed'].includes(order.status)) throw new Error('invalid-payment-transition');
    next = { ...order, status: 'paid', paidAt: event.occurredAt };
  } else if (event.eventType === 'payment_failed') {
    if (order.status !== 'awaiting_payment') throw new Error('invalid-payment-transition');
    next = { ...order, status: 'payment_failed' };
  } else if (event.eventType === 'payment_refunded') {
    if (order.status !== 'paid') throw new Error('invalid-payment-transition');
    next = { ...order, status: 'refunded', refundedAt: event.occurredAt };
  } else {
    throw new Error('unsupported-payment-event');
  }

  processedEventKeys.add(event.idempotencyKey);
  return { order: Object.freeze(next), duplicate: false, dataDeletionAllowed: false };
}

export function packageActivationAllowed(order) {
  return order?.status === 'paid';
}

