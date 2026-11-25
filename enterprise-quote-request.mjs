const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, maximum, required = true) {
  const result = String(value || '').trim();
  if ((required && !result) || result.length > maximum) throw new Error('invalid-enterprise-request-field');
  return result;
}

export function createEnterpriseQuoteRequest(input, trusted) {
  const id = text(trusted?.id, 200);
  const createdAt = Number(trusted?.createdAt);
  const companyName = text(input?.companyName, 160);
  const contactName = text(input?.contactName, 160);
  const email = text(input?.email, 320).toLowerCase();
  const expectedUsers = Number(input?.expectedUsers);
  const note = text(input?.note, 2000, false);
  if (!EMAIL.test(email)) throw new Error('invalid-enterprise-request-email');
  if (!Number.isSafeInteger(expectedUsers) || expectedUsers < 26 || expectedUsers > 10000) throw new Error('invalid-enterprise-request-users');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error('invalid-enterprise-request-time');
  return Object.freeze({ id, planCode: 'enterprise', companyName, contactName, email, expectedUsers, note, status: 'new', createdAt });
}
