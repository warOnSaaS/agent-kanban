import crypto from 'node:crypto';

// Authenticated encryption for small secrets that ride inside a signed token or cookie (a person's GitHub
// sign-in during board creation). Only this server can open them.

const key = (secret) => crypto.createHash('sha256').update(`seal:${secret}`).digest();

export function seal(value, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal(text, secret) {
  try {
    const raw = Buffer.from(String(text ?? ''), 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}
