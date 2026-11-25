const HOUR = 60 * 60 * 1000;
const REPEAT_WINDOW = 60 * 1000;

export function checkoutRequestAllowed(recent, now) {
  const time = Number(now);
  if (!Number.isSafeInteger(time) || time <= 0) throw new Error('invalid-checkout-request-time');
  const rows = Array.isArray(recent) ? recent : [];
  const emailLastHour = rows.filter(row => row.emailMatch === true && Number(row.createdAt) > time - HOUR).length;
  const ipLastHour = rows.filter(row => row.ipMatch === true && Number(row.createdAt) > time - HOUR).length;
  const exactRecent = rows.some(row => row.emailMatch === true && row.companyMatch === true && Number(row.createdAt) > time - REPEAT_WINDOW);
  return Object.freeze({
    allowed: emailLastHour < 3 && ipLastHour < 10 && !exactRecent,
    emailLimited: emailLastHour >= 3,
    ipLimited: ipLastHour >= 10,
    repeatedTooSoon: exactRecent
  });
}
