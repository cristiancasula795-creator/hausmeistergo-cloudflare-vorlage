const MAX_ATTEMPTS = 5;

const bytes = value => new TextEncoder().encode(value);
const hex = buffer => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', bytes(value)));
const code = value => String(value || '').trim();

export async function createCheckoutEmailChallenge(input) {
  const setupId = String(input?.setupId || '').trim();
  const verificationCode = code(input?.code);
  const createdAt = Number(input?.createdAt);
  const expiresAt = Number(input?.expiresAt);
  if (!setupId || setupId.length > 200) throw new Error('invalid-email-challenge-setup');
  if (!/^\d{6}$/.test(verificationCode)) throw new Error('invalid-email-challenge-code');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) throw new Error('invalid-email-challenge-time');
  return Object.freeze({ setupId, codeHash: await digest(`${setupId}:${verificationCode}`), attempts: 0, createdAt, expiresAt, usedAt: 0 });
}

export async function verifyCheckoutEmailChallenge(challenge, input) {
  const occurredAt = Number(input?.occurredAt);
  if (!challenge || challenge.usedAt > 0) throw new Error('email-challenge-used');
  if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0 || occurredAt > challenge.expiresAt) throw new Error('email-challenge-expired');
  if (Number(challenge.attempts) >= MAX_ATTEMPTS) throw new Error('email-challenge-locked');
  if (String(input?.setupId || '').trim() !== challenge.setupId) throw new Error('email-challenge-mismatch');
  const candidate = code(input?.code);
  const expected = await digest(`${challenge.setupId}:${candidate}`);
  if (expected !== challenge.codeHash) return Object.freeze({ verified: false, challenge: Object.freeze({ ...challenge, attempts: Number(challenge.attempts) + 1 }) });
  return Object.freeze({ verified: true, challenge: Object.freeze({ ...challenge, usedAt: occurredAt }) });
}
