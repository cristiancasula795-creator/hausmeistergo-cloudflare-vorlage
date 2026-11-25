const PUBLIC_ORDER = ['pilot', 'starter', 'team', 'business', 'enterprise'];
const PUBLIC_CODES = new Set(PUBLIC_ORDER);

export function publicSalesCatalog(packages) {
  const source = Array.isArray(packages) ? packages : [];
  const byCode = new Map(source.filter(item => item?.active === true && PUBLIC_CODES.has(String(item.code || '').toLowerCase())).map(item => [String(item.code).toLowerCase(), item]));
  return PUBLIC_ORDER.flatMap(code => {
    const item = byCode.get(code);
    if (!item) return [];
    const price = item.monthlyPriceCents === null ? null : Number(item.monthlyPriceCents);
    if (price !== null && (!Number.isSafeInteger(price) || price <= 0)) return [];
    return [Object.freeze({
      code,
      name: String(item.displayName || '').trim(),
      monthlyPriceCents: price,
      currency: 'EUR',
      billingInterval: 'month',
      userLimit: Number(item.userLimit),
      storageLimitBytes: Number(item.storageLimitBytes),
      features: Object.freeze([...(Array.isArray(item.features) ? item.features : [])].map(value => String(value)).sort()),
      checkoutAllowed: code !== 'enterprise' && price !== null,
      action: code === 'enterprise' || price === null ? 'request_quote' : 'start_checkout'
    })];
  });
}
