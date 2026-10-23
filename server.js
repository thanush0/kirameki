'use strict';
const express = require('express');
const { gateway, go } = require('./functions/index');
const app = express();
const frontend = (process.env.FRONTEND_ORIGIN || '').replace(/\/+$/, '');
const backendOrigin = (process.env.BASE_URL || '').replace(/\/+$/, '');
const allowedOrigins = new Set([frontend, backendOrigin].filter(Boolean).map((value) => { try { return new URL(value).origin; } catch { return ''; } }).filter(Boolean));
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'self' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://*.googleapis.com; frame-src https://accounts.google.com https://*.firebaseapp.com https://*.web.app; img-src 'self' data: https://*.googleusercontent.com; style-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, GET, HEAD, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(origin && !allowedOrigins.has(origin) ? 403 : 204).end();
  next();
});
app.use(express.json({ limit: '8kb', type: 'application/json' }));
app.post('/g', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ ok: false, e: 'Forbidden' });
  return gateway(req, res, next);
});
app.all(['/s/:code', '/q/:code'], (req, res, next) => go(req, res, next));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'kirameki-backend' }));

// Serve the complete frontend from the same free Render service. This makes
// the Render deployment work immediately without a separate frontend host.
const path = require('node:path');
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { etag: true, maxAge: '1h', index: 'index.html', dotfiles: 'deny' }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/g') || req.path.startsWith('/s/') || req.path.startsWith('/q/')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  return res.sendFile(path.join(publicDir, 'index.html'));
});
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`Kirameki backend listening on ${port}`));
