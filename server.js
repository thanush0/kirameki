'use strict';
const express = require('express');
const { gateway, go } = require('./functions/index');
const app = express();
const frontend = process.env.FRONTEND_ORIGIN || '';
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin && frontend && origin === frontend) {
    res.set('Access-Control-Allow-Origin', frontend);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, GET, HEAD, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(origin && frontend && origin !== frontend ? 403 : 204).end();
  next();
});
app.use(express.json({ limit: '8kb', type: 'application/json' }));
app.post('/g', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && frontend && origin !== frontend) return res.status(403).json({ ok: false, e: 'Forbidden' });
  return gateway(req, res, next);
});
app.all(['/s/:code', '/q/:code'], (req, res, next) => go(req, res, next));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'kirameki-backend' }));
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`Kirameki backend listening on ${port}`));
