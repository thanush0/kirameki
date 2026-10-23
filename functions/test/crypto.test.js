'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const { encrypt, decrypt, randomCode, hmac } = require('../lib/crypto');
const v = require('../lib/validate');

const key = crypto.randomBytes(32).toString('base64');

// round trip
const t = encrypt('https://example.com/a?b=1', key, 'abc1234');
assert.strictEqual(decrypt(t, key, 'abc1234'), 'https://example.com/a?b=1');
// aad binding
assert.throws(() => decrypt(t, key, 'other'));
// tamper
const raw = Buffer.from(t.slice(3), 'base64url'); raw[raw.length - 1] ^= 1;
assert.throws(() => decrypt('v1.' + raw.toString('base64url'), key, 'abc1234'));
// wrong key
assert.throws(() => decrypt(t, crypto.randomBytes(32).toString('base64'), 'abc1234'));
// short key rejected
assert.throws(() => encrypt('x', Buffer.alloc(8).toString('base64'), 'a'));
// codes
const c = randomCode(7); assert.match(c, /^[0-9A-Za-z]{7}$/);
assert.strictEqual(new Set(Array.from({ length: 500 }, () => randomCode(7))).size, 500);
assert.strictEqual(hmac('s', 'ip'), hmac('s', 'ip'));
assert.notStrictEqual(hmac('s', 'ip'), hmac('s2', 'ip'));

// URL validation
assert.strictEqual(v.normalizeUrl('example.com/x'), 'https://example.com/x');
for (const badUrl of ['javascript:alert(1)', 'ftp://example.com', 'http://localhost/x', 'http://127.0.0.1', 'http://10.0.0.5',
  'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'https://user:pw@example.com', 'http://intranet', 'data:text/html,hi', '']) {
  assert.throws(() => v.normalizeUrl(badUrl), undefined, badUrl);
}
assert.throws(() => v.normalizeUrl('https://my.site.web.app/s/x', ['my.site.web.app']));
assert.throws(() => v.normalizeUrl('https://example.com/' + 'a'.repeat(2100)));
// alias / style
assert.strictEqual(v.validAlias('my-link_1'), 'my-link_1');
assert.throws(() => v.validAlias('admin'));
assert.throws(() => v.validAlias('a b'));
assert.throws(() => v.parseStyle({ fg: 'red' }));
assert.deepStrictEqual(v.parseStyle({}), { fg: '#1a1033', bg: '#ffffff', ecc: 'M' });

console.log('all backend unit tests passed');
