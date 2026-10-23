'use strict';
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const api = require('./sqlite-backend');
const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"}); next();});
app.use(express.json({limit:'16kb'}));
app.get('/healthz',(_req,res)=>res.json({ok:true,service:'kirameki',database:'sqlite',firebase:false}));

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL ||
  'https://kirameki-3ewe.onrender.com/auth/google/callback';

function oauthClient() {
  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google OAuth environment variables are not configured');
  }
  return new OAuth2Client(googleClientId, googleClientSecret, googleCallbackUrl);
}
function cookieValue(req, key) {
  const parts = String(req.headers.cookie || '').split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i >= 0 && part.slice(0, i).trim() === key) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return '';
}
function clearOAuthState(res) {
  res.setHeader('Set-Cookie',
    'kirameki_oauth_state=; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

app.get('/auth/google', (req, res) => {
  try {
    const client = oauthClient();
    const state = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie',
      'kirameki_oauth_state=' + encodeURIComponent(state) +
      '; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
    res.redirect(client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      response_type: 'code',
      prompt: 'select_account'
    }));
  } catch (e) {
    console.error('Google OAuth start failed:', e.message);
    res.status(503).type('text/plain').send('Google sign-in is not configured. Check the Render environment settings.');
  }
});

app.get('/auth/google/callback', async (req, res) => {
  clearOAuthState(res);
  try {
    const sentState = String(req.query.state || '');
    const savedState = cookieValue(req, 'kirameki_oauth_state');
    const a = Buffer.from(sentState);
    const b = Buffer.from(savedState);
    if (!sentState || !savedState || a.length !== b.length ||
        !crypto.timingSafeEqual(a, b)) {
      return res.status(400).type('text/plain').send('Google sign-in state validation failed. Please try again.');
    }
    if (req.query.error) {
      return res.status(401).type('text/plain').send('Google sign-in was cancelled or denied. You can return to Kirameki and try again.');
    }
    const code = String(req.query.code || '');
    if (!code || code.length > 4096) {
      return res.status(400).type('text/plain').send('Missing or invalid Google authorization code.');
    }
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new Error('Google did not return an ID token');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId
    });
    const profile = ticket.getPayload();
    if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
      throw new Error('Google account email is not verified');
    }
    const result = api.googleSignIn(req, {
      email: profile.email,
      name: profile.name || profile.email.split('@')[0]
    });
    // Fragment is not sent to the server in the subsequent browser request.
    res.redirect(303, '/#google_token=' + encodeURIComponent(result.token));
  } catch (e) {
    console.error('Google OAuth callback failed:', e.message);
    res.status(401).type('text/plain').send('Google sign-in failed. Return to Kirameki and try again. If this persists, check the Render logs and OAuth redirect URI.');
  }
});

app.post(['/auth/register', '/auth/login'], (_req, res) =>
  res.status(410).json({ ok: false, error: 'Use Google Sign-In' })
); app.post('/auth/logout',(_req,res)=>res.json({ok:true}));
app.post('/g',api.gateway);
app.all(['/s/:code','/q/:code'],api.redirect);
app.use(express.static(path.join(__dirname,'public'),{etag:true,maxAge:'1h',index:'index.html',dotfiles:'deny'}));
app.get('*',(req,res)=>{if(req.path.startsWith('/g')||req.path.startsWith('/s/')||req.path.startsWith('/q/')||req.path.startsWith('/auth/'))return res.status(404).type('text/plain').send('Not found');res.sendFile(path.join(__dirname,'public','index.html'));});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({ok:false,e:'Internal server error'});});
const port=Number(process.env.PORT||10000); app.listen(port,'0.0.0.0',()=>console.log(`Kirameki listening on ${port}; SQLite file: ${process.env.SQLITE_PATH||'/tmp/kirameki.sqlite'}`));
