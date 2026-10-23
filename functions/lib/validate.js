'use strict';

const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const RESERVED = new Set(['g', 's', 'q', 'api', 'admin', 'login', 'static', 'assets', 'index', 'favicon']);

function badHost(host) {
  const h = host.toLowerCase();
  if (h.startsWith('[')) return true; // no IPv6 literals
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (!h.includes('.')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

// Returns a normalised http(s) URL or throws Error with a user-safe message.
function normalizeUrl(input, selfHosts = []) {
  if (typeof input !== 'string') throw new Error('URL is required');
  let s = input.trim();
  if (!s || s.length > 2048) throw new Error('URL is empty or too long');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links are allowed');
  if (u.username || u.password) throw new Error('Links with embedded credentials are not allowed');
  if (badHost(u.hostname)) throw new Error('That host is not allowed');
  if (selfHosts.includes(u.hostname.toLowerCase())) throw new Error('Cannot shorten a link to this site');
  return u.href;
}

function validAlias(a) {
  if (!CODE_RE.test(a) || RESERVED.has(a.toLowerCase())) throw new Error('Alias must be 3-32 letters, numbers, - or _');
  return a;
}

function parseStyle(b) {
  const fg = b && b.fg ? String(b.fg) : '#1a1033';
  const bg = b && b.bg ? String(b.bg) : '#ffffff';
  const ecc = b && b.ecc ? String(b.ecc) : 'M';
  if (!HEX_RE.test(fg) || !HEX_RE.test(bg)) throw new Error('Colors must be #rrggbb');
  if (!['L', 'M', 'Q', 'H'].includes(ecc)) throw new Error('Bad error-correction level');
  return { fg, bg, ecc };
}

function cleanLabel(l) {
  return typeof l === 'string' ? l.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
}

module.exports = { CODE_RE, normalizeUrl, validAlias, parseStyle, cleanLabel };
