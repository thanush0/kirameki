'use strict';
// Render-compatible shim for Firebase Functions parameter APIs.
const onRequest = (_options, handler) => handler;
const defineSecret = (name) => ({ value: () => process.env[name] || '' });
const defineString = (name) => ({ value: () => process.env[name] || '' });
const admin = require('firebase-admin');
const QRCode = require('qrcode');
const { encrypt, decrypt, hmac, randomCode } = require('./lib/crypto');
const v = require('./lib/validate');

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) : null;
if (!serviceAccount) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const REGION = 'asia-south1';
const ENC_KEY = defineSecret('ENCRYPTION_KEY'); // 32 random bytes, base64
const HASH_SALT = defineSecret('IP_HASH_SALT'); // random string
const ADMIN_EMAILS = defineSecret('ADMIN_EMAILS'); // comma-separated Google emails
const BASE_URL = defineString('BASE_URL'); // e.g. https://your-project.web.app

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
const base = () => BASE_URL.value().replace(/\/+$/, '');
const selfHosts = () => [new URL(base()).hostname.toLowerCase(), ...(process.env.FRONTEND_ORIGIN ? [new URL(process.env.FRONTEND_ORIGIN).hostname.toLowerCase()] : [])];

function clientIp(req) {
  const xff = req.get('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : req.ip) || '0.0.0.0';
}

async function rateLimit(key, limit, windowSec) {
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const ref = db.collection('ratelimits').doc(`${key}:${slot}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const c = s.exists ? s.data().c : 0;
    if (c >= limit) throw new HttpError(429, 'Too many requests, slow down');
    t.set(ref, { c: c + 1, exp: Timestamp.fromMillis((slot + 2) * windowSec * 1000) });
  });
}

function audit(ctx, action, target, meta) {
  return db.collection('audit').add({
    ts: FieldValue.serverTimestamp(),
    actor: ctx.user ? ctx.user.uid : null,
    email: ctx.user ? ctx.user.email : null,
    action,
    target: target || null,
    meta: meta || null,
    ipHash: ctx.ipHash,
  }).catch((e) => console.error('audit failed', e.message));
}

async function authenticate(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  let tok;
  try { tok = await admin.auth().verifyIdToken(h.slice(7), true); }
  catch { throw new HttpError(401, 'Unauthorized'); }
  const email = (tok.email || '').toLowerCase();
  const admins = ADMIN_EMAILS.value().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    uid: tok.uid, email, name: tok.name || '', picture: tok.picture || '',
    isAdmin: tok.email_verified === true && admins.includes(email),
  };
}

function toItem(doc, withOwner) {
  const d = doc.data();
  let url = null;
  try { url = decrypt(d.destEnc, ENC_KEY.value(), doc.id); } catch { url = null; }
  return {
    code: doc.id, type: d.type, label: d.label || '', url, active: !!d.active,
    clicks: d.clicks || 0, createdAt: ms(d.createdAt), updatedAt: ms(d.updatedAt),
    shortUrl: `${base()}/${d.type === 'qr' ? 'q' : 's'}/${doc.id}`, style: d.style || null,
    ...(withOwner ? { ownerUid: d.ownerUid || null } : {}),
  };
}

function renderQr(text, { fg, bg, ecc }) {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: ecc, margin: 2, color: { dark: fg, light: bg } });
}

async function createLink(ctx, { url, alias, type, label, style }) {
  const dest = v.normalizeUrl(url, selfHosts());
  const attempts = alias ? 1 : 6;
  for (let i = 0; i < attempts; i++) {
    const code = alias || randomCode(7);
    try {
      await db.collection('links').doc(code).create({
        type, ownerUid: ctx.user ? ctx.user.uid : null,
        destEnc: encrypt(dest, ENC_KEY.value(), code),
        label, active: true, clicks: 0, style: style || null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        createIpHash: ctx.ipHash,
      });
      await audit(ctx, `${type}.create`, code);
      return { code, type, shortUrl: `${base()}/${type === 'qr' ? 'q' : 's'}/${code}` };
    } catch (e) {
      if (e.code === 6) { if (alias) throw new HttpError(409, 'Alias already taken'); continue; }
      throw e;
    }
  }
  throw new HttpError(503, 'Could not allocate a code, try again');
}

async function ownedLink(ctx, code) {
  if (typeof code !== 'string' || !v.CODE_RE.test(code)) throw bad('Bad code');
  const snap = await db.collection('links').doc(code).get();
  if (!snap.exists) throw new HttpError(404, 'Not found');
  const d = snap.data();
  if (d.ownerUid !== ctx.user.uid && !ctx.user.isAdmin) throw new HttpError(404, 'Not found');
  return snap;
}

const clickView = (d, id, admin) => ({
  id, code: d.code, ts: ms(d.ts), country: d.country || null, ref: d.ref || null, ua: d.ua || null,
  ...(admin ? { ipHash: d.ipHash } : {}),
});

// auth: none | user | admin    rl: [limit, windowSec] for anonymous; signed-in users get 3x
const actions = {
  me: {
    auth: 'user', rl: [60, 60],
    async fn(ctx) {
      const u = ctx.user;
      const ref = db.collection('users').doc(u.uid);
      const s = await ref.get();
      await ref.set({
        email: u.email, name: u.name, picture: u.picture, lastLogin: FieldValue.serverTimestamp(),
        ...(s.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      if (!s.exists) await audit(ctx, 'user.signup', u.uid);
      return { uid: u.uid, email: u.email, name: u.name, picture: u.picture, isAdmin: u.isAdmin };
    },
  },

  shorten: {
    auth: 'none', rl: [15, 60],
    async fn(ctx, b) {
      let alias;
      if (b.alias) {
        if (!ctx.user) throw new HttpError(401, 'Sign in to use a custom alias');
        try { alias = v.validAlias(String(b.alias)); } catch (e) { throw bad(e.message); }
      }
      try { return await createLink(ctx, { url: b.url, alias, type: 'link', label: v.cleanLabel(b.label) }); }
      catch (e) { throw e instanceof HttpError ? e : bad(e.message); }
    },
  },

  'qr.static': {
    auth: 'none', rl: [30, 60],
    async fn(ctx, b) {
      if (typeof b.text !== 'string' || !b.text || b.text.length > 1000) throw bad('Content is empty or over 1000 characters');
      let style; try { style = v.parseStyle(b); } catch (e) { throw bad(e.message); }
      return { svg: await renderQr(b.text, style) };
    },
  },

  'qr.dynamic.create': {
    auth: 'user', rl: [10, 60],
    async fn(ctx, b) {
      let style; try { style = v.parseStyle(b); } catch (e) { throw bad(e.message); }
      let out;
      try { out = await createLink(ctx, { url: b.url, type: 'qr', label: v.cleanLabel(b.label), style }); }
      catch (e) { throw e instanceof HttpError ? e : bad(e.message); }
      return { ...out, svg: await renderQr(out.shortUrl, style) };
    },
  },

  'qr.render': {
    auth: 'user', rl: [60, 60],
    async fn(ctx, b) {
      const snap = await ownedLink(ctx, b.code);
      const it = toItem(snap, false);
      return { svg: await renderQr(it.shortUrl, it.style ? it.style : v.parseStyle({})), shortUrl: it.shortUrl };
    },
  },

  'link.list': {
    auth: 'user', rl: [60, 60],
    async fn(ctx) {
      const q = await db.collection('links').where('ownerUid', '==', ctx.user.uid).orderBy('createdAt', 'desc').limit(100).get();
      return { items: q.docs.map((d) => toItem(d, false)) };
    },
  },

  'link.update': {
    auth: 'user', rl: [30, 60],
    async fn(ctx, b) {
      const snap = await ownedLink(ctx, b.code);
      const patch = { updatedAt: FieldValue.serverTimestamp() };
      if (b.url !== undefined) {
        try { patch.destEnc = encrypt(v.normalizeUrl(b.url, selfHosts()), ENC_KEY.value(), snap.id); }
        catch (e) { throw bad(e.message); }
      }
      if (b.active !== undefined) patch.active = b.active === true;
      if (b.label !== undefined) patch.label = v.cleanLabel(b.label);
      await snap.ref.update(patch);
      await audit(ctx, 'link.update', snap.id, { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') });
      return toItem(await snap.ref.get(), false);
    },
  },

  'link.delete': {
    auth: 'user', rl: [30, 60],
    async fn(ctx, b) {
      const snap = await ownedLink(ctx, b.code);
      await snap.ref.delete();
      await audit(ctx, 'link.delete', snap.id);
      return { deleted: snap.id };
    },
  },

  'link.stats': {
    auth: 'user', rl: [60, 60],
    async fn(ctx, b) {
      const snap = await ownedLink(ctx, b.code);
      const q = await db.collection('clicks').where('code', '==', snap.id).orderBy('ts', 'desc').limit(100).get();
      return { clicks: q.docs.map((d) => clickView(d.data(), d.id, ctx.user.isAdmin)) };
    },
  },

  'admin.overview': {
    auth: 'admin', rl: [60, 60],
    async fn() {
      const count = async (q) => (await q.count().get()).data().count;
      const since = Timestamp.fromMillis(Date.now() - 86400000);
      const [links, qrs, users, clicks, clicks24, active] = await Promise.all([
        count(db.collection('links').where('type', '==', 'link')),
        count(db.collection('links').where('type', '==', 'qr')),
        count(db.collection('users')),
        count(db.collection('clicks')),
        count(db.collection('clicks').where('ts', '>=', since)),
        count(db.collection('links').where('active', '==', true)),
      ]);
      return { links, qrs, users, clicks, clicks24, active };
    },
  },

  'admin.links': {
    auth: 'admin', rl: [60, 60],
    async fn(ctx, b) {
      let q = db.collection('links').orderBy('createdAt', 'desc');
      if (Number.isFinite(b.cursor)) q = q.startAfter(Timestamp.fromMillis(b.cursor));
      const snaps = (await q.limit(50).get()).docs;
      const uids = [...new Set(snaps.map((s) => s.data().ownerUid).filter(Boolean))];
      const owners = {};
      if (uids.length) {
        (await db.getAll(...uids.map((u) => db.collection('users').doc(u)))).forEach((s) => { if (s.exists) owners[s.id] = s.data().email; });
      }
      const items = snaps.map((s) => ({ ...toItem(s, true), ownerEmail: owners[s.data().ownerUid] || null }));
      return { items, next: items.length === 50 ? items[items.length - 1].createdAt : null };
    },
  },

  'admin.users': {
    auth: 'admin', rl: [60, 60],
    async fn() {
      const q = await db.collection('users').orderBy('createdAt', 'desc').limit(100).get();
      return { items: q.docs.map((d) => ({ uid: d.id, email: d.data().email, name: d.data().name, createdAt: ms(d.data().createdAt), lastLogin: ms(d.data().lastLogin) })) };
    },
  },

  'admin.clicks': {
    auth: 'admin', rl: [60, 60],
    async fn(ctx, b) {
      let q = db.collection('clicks');
      if (b.code) { if (!v.CODE_RE.test(String(b.code))) throw bad('Bad code'); q = q.where('code', '==', b.code); }
      const r = await q.orderBy('ts', 'desc').limit(100).get();
      return { items: r.docs.map((d) => clickView(d.data(), d.id, true)) };
    },
  },

  'admin.logs': {
    auth: 'admin', rl: [60, 60],
    async fn() {
      const r = await db.collection('audit').orderBy('ts', 'desc').limit(100).get();
      return { items: r.docs.map((d) => ({ id: d.id, ...d.data(), ts: ms(d.data().ts) })) };
    },
  },

  'admin.setUserDisabled': {
    auth: 'admin', rl: [20, 60],
    async fn(ctx, b) {
      if (typeof b.uid !== 'string' || b.uid.length > 128) throw bad('Bad uid');
      if (b.uid === ctx.user.uid) throw bad('You cannot disable yourself');
      await admin.auth().updateUser(b.uid, { disabled: b.disabled === true });
      if (b.disabled === true) await admin.auth().revokeRefreshTokens(b.uid);
      await audit(ctx, 'admin.user.disable', b.uid, { disabled: b.disabled === true });
      return { uid: b.uid, disabled: b.disabled === true };
    },
  },
};

// ---------------------------------------------------------------------------
// Single opaque gateway. Hosting rewrites POST /g here; every other method or
// unknown action answers with a bare 404 so nothing is discoverable by probing.
// ---------------------------------------------------------------------------
exports.gateway = onRequest(
  { region: REGION, secrets: [ENC_KEY, HASH_SALT, ADMIN_EMAILS], maxInstances: 20, cors: false, memory: '256MiB' },
  async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const notFound = () => res.status(404).type('text/plain').send('Not found');
    try {
      if (req.method !== 'POST') return notFound();
      if (!(req.get('content-type') || '').startsWith('application/json')) return notFound();
      const origin = req.get('origin');
      if (origin && origin !== (process.env.FRONTEND_ORIGIN || new URL(base()).origin)) return res.status(403).json({ ok: false, e: 'Forbidden' });
      const body = req.body || {};
      if (JSON.stringify(body).length > 8192) throw new HttpError(413, 'Request too large');
      const spec = typeof body.a === 'string' && Object.prototype.hasOwnProperty.call(actions, body.a) ? actions[body.a] : null;
      if (!spec) return notFound();

      const ip = clientIp(req);
      const ctx = { ipHash: hmac(HASH_SALT.value(), ip), user: null };
      ctx.user = await authenticate(req);

      if (spec.auth !== 'none' && !ctx.user) throw new HttpError(401, 'Sign in required');
      if (spec.auth === 'admin' && !ctx.user.isAdmin) {
        await audit(ctx, 'admin.denied', body.a);
        return notFound();
      }
      const [lim, win] = spec.rl;
      await rateLimit(`${body.a}:${ctx.user ? ctx.user.uid : ctx.ipHash}`, ctx.user ? lim * 3 : lim, win);

      const data = body.d && typeof body.d === 'object' && !Array.isArray(body.d) ? body.d : {};
      const out = await spec.fn(ctx, data);
      return res.json({ ok: true, d: out });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ ok: false, e: e.message });
      console.error('gateway error', e);
      return res.status(500).json({ ok: false, e: 'Server error' });
    }
  }
);

// ---------------------------------------------------------------------------
// Redirector for /s/<code> (short links) and /q/<code> (dynamic QR codes).
// ---------------------------------------------------------------------------
exports.go = onRequest(
  { region: REGION, secrets: [ENC_KEY, HASH_SALT], maxInstances: 50, cors: false, memory: '256MiB' },
  async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' });
    const notFound = () => res.status(404).type('text/plain').send('Link not found');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
      const code = req.path.split('/').filter(Boolean).pop() || '';
      if (!v.CODE_RE.test(code)) return notFound();
      const snap = await db.collection('links').doc(code).get();
      if (!snap.exists) return notFound();
      const d = snap.data();
      if (!d.active) return notFound();
      const url = decrypt(d.destEnc, ENC_KEY.value(), code);
      if (!/^https?:\/\//i.test(url)) return notFound();

      if (req.method === 'GET') {
        let refHost = null;
        try { refHost = req.get('referer') ? new URL(req.get('referer')).hostname.slice(0, 100) : null; } catch { /* ignore */ }
        await Promise.allSettled([
          snap.ref.update({ clicks: FieldValue.increment(1) }),
          db.collection('clicks').add({
            code, ts: FieldValue.serverTimestamp(),
            ipHash: hmac(HASH_SALT.value(), clientIp(req)),
            ua: (req.get('user-agent') || '').slice(0, 160),
            ref: refHost,
            country: req.get('x-appengine-country') || null,
          }),
        ]);
      }
      return res.redirect(302, url);
    } catch (e) {
      console.error('redirect error', e.message);
      return res.status(500).type('text/plain').send('Error');
    }
  }
);
