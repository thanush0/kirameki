'use strict';
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function keyFrom(b64) {
  const k = Buffer.from(String(b64 || '').trim(), 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 random bytes, base64 encoded');
  return k;
}

// AES-256-GCM. `aad` (the record id) binds a ciphertext to its record so it
// cannot be copied onto another document.
function encrypt(plain, keyB64, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

function decrypt(token, keyB64, aad) {
  if (typeof token !== 'string' || !token.startsWith('v1.')) throw new Error('bad ciphertext');
  const raw = Buffer.from(token.slice(3), 'base64url');
  if (raw.length < 29) throw new Error('bad ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(keyB64), raw.subarray(0, 12));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

function hmac(salt, value) {
  return crypto.createHmac('sha256', String(salt)).update(String(value)).digest('hex').slice(0, 32);
}

// Unbiased base62 via rejection sampling.
function randomCode(len = 7) {
  let out = '';
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b < 248 && out.length < len) out += ALPHABET[b % 62];
    }
  }
  return out;
}

module.exports = { encrypt, decrypt, hmac, randomCode };
