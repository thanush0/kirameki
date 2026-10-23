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

/* ---------- Google OAuth authentication ---------- */
function paintAuth() {
  $('btn-signin').classList.toggle('hidden', !!me);
  $('user-box').classList.toggle('hidden', !me);
  $('tab-dash').classList.toggle('hidden', !me);
  $('tab-admin').classList.toggle('hidden', !(me && me.isAdmin));
  $('badge-admin').classList.toggle('hidden', !(me && me.isAdmin));

  if (me) {
    $('user-name').textContent = me.name || me.email;
    $('user-pic').classList.add('hidden');
  } else {
    const active = document.querySelector('.tab.active');
    if (active && (active.dataset.tab === 'dash' ||
                   active.dataset.tab === 'admin')) {
      showTab('shorten');
    }
  }
  updateQrNote();
}

async function loadSession() {
  if (!sessionToken) {
    me = null;
    paintAuth();
    return;
  }

  try {
    me = await api('me');
  } catch {
    sessionToken = '';
    localStorage.removeItem('kirameki_token');
    me = null;
  }

  paintAuth();
}

const authModal = $('auth-modal');

function openAuth() {
  authModal.classList.remove('hidden');
}

function closeAuth() {
  authModal.classList.add('hidden');
}

$('btn-signin').addEventListener('click', openAuth);
$('auth-close').addEventListener('click', closeAuth);

authModal.addEventListener('click', (e) => {
  if (e.target === authModal) closeAuth();
});

$('btn-signout').addEventListener('click', () => {
  sessionToken = '';
  localStorage.removeItem('kirameki_token');
  me = null;
  paintAuth();
  toast('Signed out');
});

/* Google OAuth returns the session token in the URL fragment. */
const googleParams = new URLSearchParams(location.hash.slice(1));
const googleToken = googleParams.get('google_token');

if (googleToken) {
  sessionToken = googleToken;
  localStorage.setItem('kirameki_token', sessionToken);
  history.replaceState(null, '', location.pathname + location.search);
}

loadSession().then(() => {
  if (googleToken && me) toast('Signed in with Google');
});

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
let activeDynamicQrCode = '';
let qrRefreshTimer = null;

function stopDynamicQrRefresh() {
  if (qrRefreshTimer) clearInterval(qrRefreshTimer);
  qrRefreshTimer = null;
}

function getQrCode(out) {
  if (out.code) return String(out.code);
  try {
    const path = new URL(out.shortUrl, location.origin).pathname;
    return path.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
}

function startDynamicQrRefresh(code) {
  stopDynamicQrRefresh();
  activeDynamicQrCode = code;
  if (!code) return;

  qrRefreshTimer = setInterval(async () => {
    if (qrMode !== 'dynamic' ||
        activeDynamicQrCode !== code ||
        $('qr-img').classList.contains('hidden')) {
      return;
    }

    try {
      const result = await api('qr.render', { code });
      // Update only the QR image; do not reload or reset the page.
      if (qrMode === 'dynamic' && activeDynamicQrCode === code) {
        showQr(result.svg);
      }
    } catch (err) {
      console.warn('Dynamic QR refresh failed:', err.message);
    }
  }, 15000);
}

function openQrFullscreen(svg) {
  if (!svg) return;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');

  if (!tab) {
    URL.revokeObjectURL(url);
    toast('Allow pop-ups to open the full-screen QR', 'err');
    return;
  }

  // Keep the Blob URL alive while the new tab loads.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function updateQrNote() {
  $('qr-note').textContent = qrMode === 'dynamic'
    ? (me ? 'Dynamic: the QR encodes a short link. Change the destination any time from My Library.' : 'Sign in with Google to create dynamic QR codes.')
    : 'Static: content is baked into the QR. No account needed, no tracking.';
}
$('qr-mode').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  qrMode = b.dataset.mode;
  if (qrMode !== 'dynamic') stopDynamicQrRefresh();
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
      if (!me) { toast('Sign in with Google first', 'err'); return; }
      out = await api('qr.dynamic.create', { url: $('qr-text').value, label: $('qr-label').value, ...style });
      const s = $('qr-short'); s.href = out.shortUrl; s.textContent = out.shortUrl; s.classList.remove('hidden');
    } else {
      stopDynamicQrRefresh();
      activeDynamicQrCode = '';
      out = await api('qr.static', { text: $('qr-text').value, ...style });
      $('qr-short').classList.add('hidden');
    }
    showQr(out.svg);
    if (qrMode === 'dynamic') startDynamicQrRefresh(getQrCode(out));
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
$('qr-fullscreen').addEventListener('click', () => {
  openQrFullscreen(qrSvg);
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
    const fullscreen = h('button', {
      class: 'btn ghost small',
      onclick: () => openQrFullscreen(svg)
    }, 'Open Full Screen QR');
    openModal(h('h2', {}, it.label || 'Dynamic QR'),
      h('img', { class: 'qr-big', alt: 'QR code', src: svgUri(svg), width: 260, height: 260 }),
      h('p', { class: 'muted' }, it.shortUrl), fullscreen);
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
