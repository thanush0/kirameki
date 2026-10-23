import { backendBaseUrl } from './config.js';
let sessionToken = localStorage.getItem('kirameki_token') || '';
const backend = (backendBaseUrl || '').replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);
let me = null; // { uid, email, name, picture, isAdmin }

/* ---------- DOM helper (never uses innerHTML with data) ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (k === 'class') el.className = val;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), val);
    else if (val !== false && val != null) el.setAttribute(k, val);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

/* ---------- gateway client: the only network surface besides redirects ---------- */
async function api(a, d = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
  let r;
  try { r = await fetch(backend + '/g', { method: 'POST', headers, body: JSON.stringify({ a, d }), cache: 'no-store' }); }
  catch { throw new Error('Network error'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.e || 'Request failed (' + r.status + ')');
  return j.d;
}

function toast(msg, kind = 'ok') {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast ' + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3200);
}
const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');
async function guard(fn) { try { return await fn(); } catch (e) { toast(e.message, 'err'); } }

/* ---------- petals ---------- */
(function petals() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('petals');
  for (let i = 0; i < 22; i++) {
    const p = h('span', { class: 'petal' });
    p.style.left = Math.random() * 100 + 'vw';
    p.style.animationDuration = 9 + Math.random() * 12 + 's';
    p.style.animationDelay = -Math.random() * 20 + 's';
    p.style.setProperty('--sway', (Math.random() * 160 - 80) + 'px');
    p.style.transform = 'scale(' + (0.6 + Math.random() * 0.9) + ')';
    box.append(p);
  }
})();

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'dash') loadDash();
  if (name === 'admin') loadAdmin();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });

/* ---------- local email/password auth; no Firebase SDK ---------- */
function paintAuth() {
  $('btn-signin').classList.toggle('hidden', !!me); $('user-box').classList.toggle('hidden', !me);
  $('tab-dash').classList.toggle('hidden', !me); $('tab-admin').classList.toggle('hidden', !(me && me.isAdmin)); $('badge-admin').classList.toggle('hidden', !(me && me.isAdmin));
  if (me) { $('user-name').textContent=me.name||me.email; $('user-pic').classList.add('hidden'); }
  else { const active=document.querySelector('.tab.active'); if(active&&(active.dataset.tab==='dash'||active.dataset.tab==='admin'))showTab('shorten'); }
  updateQrNote();
}
async function loadSession(){ if(!sessionToken){paintAuth();return;} try{me=await api('me');}catch{sessionToken='';localStorage.removeItem('kirameki_token');me=null;} paintAuth(); }
const authModal = $('auth-modal');
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $('auth-title').textContent = mode === 'register' ? 'Create your account' : 'Welcome back';
  $('auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
  $('auth-switch').textContent = mode === 'register'
    ? 'Already have an account? Sign in'
    : 'New to Kirameki? Create account';
  $('auth-name-wrap').classList.toggle('hidden', mode !== 'register');
  $('auth-confirm-wrap').classList.toggle('hidden', mode !== 'register');
  $('auth-confirm').required = mode === 'register';
  $('auth-name').required = false;
  $('auth-error').textContent = '';
  $('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
}

function openAuth() {
  setAuthMode('login');
  authModal.classList.remove('hidden');
  $('auth-email').focus();
}

function closeAuth() {
  authModal.classList.add('hidden');
  $('auth-form').reset();
  $('auth-error').textContent = '';
}

$('btn-signin').addEventListener('click', openAuth);
$('auth-close').addEventListener('click', closeAuth);
$('auth-switch').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});
authModal.addEventListener('click', e => {
  if (e.target === authModal) closeAuth();
});
$('auth-form').addEventListener('submit', e => {
  e.preventDefault();
  guard(async () => {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const name = $('auth-name').value.trim();
    if (authMode === 'register' && password !== $('auth-confirm').value) {
      $('auth-error').textContent = 'Passwords do not match.';
      return;
    }
    $('auth-submit').disabled = true;
    $('auth-error').textContent = '';
    try {
      const r = await fetch(backend + '/auth/' + (authMode === 'register' ? 'register' : 'login'), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, password, name})
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw new Error(result.e || 'Authentication failed');
      sessionToken = result.token;
      localStorage.setItem('kirameki_token', sessionToken);
      me = result.user;
      closeAuth();
      paintAuth();
      toast(authMode === 'register' ? 'Account created' : 'Signed in');
    } catch (err) {
      $('auth-error').textContent = err.message || 'Authentication failed. Please try again.';
    } finally {
      $('auth-submit').disabled = false;
    }
  });
});
$('btn-signout').addEventListener('click',()=>{sessionToken='';localStorage.removeItem('kirameki_token');me=null;paintAuth();toast('Signed out');});
loadSession();

/* ---------- shorten ---------- */
let lastShort = '';
$('form-shorten').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const out = await api('shorten', { url: $('in-url').value, alias: $('in-alias').value || undefined });
    lastShort = out.shortUrl;
    const a = $('out-short-link'); a.href = out.shortUrl; a.textContent = out.shortUrl;
    $('out-shorten').classList.remove('hidden');
    $('out-short-qr').src = svgUri((await api('qr.static', { text: out.shortUrl })).svg);
    toast('Short link ready ✦');
  });
});
$('btn-copy').addEventListener('click', () => guard(async () => { await navigator.clipboard.writeText(lastShort); toast('Copied'); }));

/* ---------- QR studio ---------- */
let qrMode = 'static', qrSvg = '';
function updateQrNote() {
  $('qr-note').textContent = qrMode === 'dynamic'
    ? (me ? 'Dynamic: the QR encodes a short link. Change the destination any time from My Library.' : 'Create an account to create dynamic QR codes.')
    : 'Static: content is baked into the QR. No account needed, no tracking.';
}
$('qr-mode').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  qrMode = b.dataset.mode;
  document.querySelectorAll('#qr-mode .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('qr-label-wrap').classList.toggle('hidden', qrMode !== 'dynamic');
  updateQrNote();
});
$('form-qr').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const style = { fg: $('qr-fg').value, bg: $('qr-bg').value, ecc: $('qr-ecc').value };
    let out;
    if (qrMode === 'dynamic') {
      if (!me) { toast('Sign in with your email and password first', 'err'); return; }
      out = await api('qr.dynamic.create', { url: $('qr-text').value, label: $('qr-label').value, ...style });
      const s = $('qr-short'); s.href = out.shortUrl; s.textContent = out.shortUrl; s.classList.remove('hidden');
    } else {
      out = await api('qr.static', { text: $('qr-text').value, ...style });
      $('qr-short').classList.add('hidden');
    }
    showQr(out.svg);
    toast(qrMode === 'dynamic' ? 'Dynamic QR saved to your library ✦' : 'QR generated ✦');
  });
});
function showQr(svg) {
  qrSvg = svg;
  $('qr-img').src = svgUri(svg);
  $('qr-img').classList.remove('hidden'); $('qr-empty').classList.add('hidden'); $('qr-actions').classList.remove('hidden');
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('qr-dl-svg').addEventListener('click', () => download(new Blob([qrSvg], { type: 'image/svg+xml' }), 'qr.svg'));
$('qr-dl-png').addEventListener('click', () => {
  const img = new Image();
  img.onload = () => {
    const c = h('canvas', { width: 1024, height: 1024 });
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, 1024, 1024);
    c.toBlob((b) => download(b, 'qr.png'));
  };
  img.src = svgUri(qrSvg);
});

/* ---------- modal ---------- */
const modal = $('modal');
function openModal(...nodes) { const b = $('modal-body'); b.replaceChildren(...nodes); modal.classList.remove('hidden'); }
$('modal-close').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.add('hidden'); });

/* ---------- library ---------- */
async function loadDash() {
  const box = $('dash-list'); box.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  await guard(async () => {
    const { items } = await api('link.list');
    box.replaceChildren(...(items.length ? items.map(itemCard) : [h('p', { class: 'muted' }, 'Nothing here yet. Create a short link or a dynamic QR.')]));
  });
}
function itemCard(it) {
  const acts = h('div', { class: 'acts' },
    it.type === 'qr' ? h('button', { class: 'btn ghost small', onclick: () => viewQr(it) }, 'QR') : null,
    h('button', { class: 'btn ghost small', onclick: () => editItem(it) }, 'Edit'),
    h('button', { class: 'btn ghost small', onclick: () => viewStats(it) }, 'Stats'),
    h('button', { class: 'btn ghost small', onclick: () => guard(async () => { await api('link.update', { code: it.code, active: !it.active }); loadDash(); }) }, it.active ? 'Pause' : 'Resume'),
    h('button', { class: 'btn danger small', onclick: () => confirm('Delete this permanently?') && guard(async () => { await api('link.delete', { code: it.code }); loadDash(); }) }, 'Delete'));
  return h('div', { class: 'card item' },
    h('div', {},
      h('h3', {}, h('span', { class: 'tag ' + it.type }, it.type === 'qr' ? 'dynamic qr' : 'link'), !it.active ? h('span', { class: 'tag off' }, 'paused') : null, it.label || it.shortUrl),
      h('div', { class: 'dest' }, it.shortUrl, ' → ', it.url || '(unreadable)'),
      h('div', { class: 'dest' }, it.clicks, ' clicks · created ', fmt(it.createdAt))),
    acts);
}
function viewQr(it) {
  guard(async () => {
    const { svg } = await api('qr.render', { code: it.code });
    const dl = h('button', { class: 'btn ghost small', onclick: () => download(new Blob([svg], { type: 'image/svg+xml' }), it.code + '.svg') }, 'Download SVG');
    openModal(h('h2', {}, it.label || 'Dynamic QR'), h('img', { class: 'qr-big', alt: 'QR code', src: svgUri(svg), width: 260, height: 260 }), h('p', { class: 'muted' }, it.shortUrl), dl);
  });
}
function editItem(it) {
  const url = h('input', { type: 'text', value: it.url || '', maxlength: 2048 });
  const label = h('input', { type: 'text', value: it.label, maxlength: 80 });
  openModal(h('h2', {}, 'Edit ', it.code),
    h('label', {}, 'Destination URL', url), h('p'), h('label', {}, 'Label', label), h('p'),
    h('button', { class: 'btn glow', onclick: () => guard(async () => { await api('link.update', { code: it.code, url: url.value, label: label.value }); modal.classList.add('hidden'); toast('Updated ✦'); loadDash(); }) }, 'Save'));
}
function viewStats(it) {
  guard(async () => {
    const { clicks } = await api('link.stats', { code: it.code });
    openModal(h('h2', {}, 'Recent clicks · ', it.clicks, ' total'), table(['When', 'Country', 'Referrer', 'Device'], clicks.map((c) => [fmt(c.ts), c.country || '—', c.ref || 'direct', c.ua || '—'])));
  });
}

/* ---------- admin ---------- */
function table(head, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'No data yet.');
  return h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}
let adminTab = 'links';
$('admin-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  adminTab = b.dataset.a;
  document.querySelectorAll('#admin-tabs .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  loadAdminBody();
});
async function loadAdmin() {
  await guard(async () => {
    const s = await api('admin.overview');
    const defs = [['links', 'Short links'], ['qrs', 'Dynamic QR'], ['active', 'Active'], ['users', 'Users'], ['clicks', 'Total clicks'], ['clicks24', 'Clicks 24h']];
    $('admin-stats').replaceChildren(...defs.map(([k, l]) => h('div', { class: 'card stat' }, h('b', {}, s[k]), h('span', {}, l))));
  });
  loadAdminBody();
}
async function loadAdminBody() {
  const body = $('admin-body'); body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  await guard(async () => {
    if (adminTab === 'links') {
      const { items } = await api('admin.links');
      body.replaceChildren(table(['Code', 'Type', 'Owner', 'Destination', 'Clicks', 'Active', 'Created', ''],
        items.map((i) => [i.code, i.type, i.ownerEmail || 'anonymous', i.url || '—', i.clicks, i.active ? 'yes' : 'no', fmt(i.createdAt),
          h('span', {},
            h('button', { class: 'btn ghost small', onclick: () => guard(async () => { await api('link.update', { code: i.code, active: !i.active }); loadAdminBody(); }) }, i.active ? 'Disable' : 'Enable'), ' ',
            h('button', { class: 'btn danger small', onclick: () => confirm('Delete ' + i.code + '?') && guard(async () => { await api('link.delete', { code: i.code }); loadAdminBody(); }) }, 'Delete'))]
        )));
    } else if (adminTab === 'users') {
      const { items } = await api('admin.users');
      body.replaceChildren(table(['Email', 'Name', 'Joined', 'Last login', ''], items.map((u) => [u.email, u.name, fmt(u.createdAt), fmt(u.lastLogin),
        h('button', { class: 'btn danger small', onclick: () => confirm('Disable ' + u.email + '?') && guard(async () => { await api('admin.setUserDisabled', { uid: u.uid, disabled: true }); toast('User disabled'); }) }, 'Disable')])));
    } else if (adminTab === 'clicks') {
      const { items } = await api('admin.clicks');
      body.replaceChildren(table(['When', 'Code', 'Country', 'Referrer', 'Device', 'IP hash'], items.map((c) => [fmt(c.ts), c.code, c.country || '—', c.ref || 'direct', c.ua || '—', c.ipHash])));
    } else {
      const { items } = await api('admin.logs');
      body.replaceChildren(table(['When', 'Actor', 'Action', 'Target', 'IP hash'], items.map((l) => [fmt(l.ts), l.email || 'anonymous', l.action, l.target || '—', l.ipHash])));
    }
  });
}

updateQrNote();
