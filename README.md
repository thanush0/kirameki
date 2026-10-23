# Kirameki — short links + static/dynamic QR (Firebase)

Animated, sakura-themed site on Firebase Hosting + Cloud Functions + Firestore + Google sign-in.

| Feature | Who |
|---|---|
| Shorten a link (`/s/<code>`) | anyone (rate limited); custom alias needs sign-in |
| Static QR (content baked in, no tracking) | anyone |
| Dynamic QR (`/q/<code>`, editable + click stats) | Google-signed-in users, saved to their account |
| Admin console: every link, QR, user, click and audit log | emails listed in `ADMIN_EMAILS` |

## Security design

- **One opaque gateway.** The browser only talks to `POST /g` (plus redirects at `/s/*`, `/q/*`). Non-POST requests, unknown actions and denied admin calls all return a bare 404, so nothing is discoverable by probing. There is no REST surface to enumerate.
- **Firestore is closed to clients.** `firestore.rules` is deny-all; data is only reachable through the gateway with the Admin SDK.
- **Auth.** Firebase ID tokens are verified server-side with revocation checking. Admin status is decided only on the server (`email_verified` and the email is in the `ADMIN_EMAILS` secret). It is never a client flag.
- **Encryption at rest.** Every destination URL is encrypted with AES-256-GCM (key in Secret Manager), bound to its record id as AAD so ciphertext can't be moved between records. Tampering fails decryption. Firebase also encrypts Firestore at rest on top of this.
- **Privacy.** IPs are never stored raw. They are HMAC-hashed with a secret salt.
- **Abuse controls.** Firestore-backed rate limits per IP or user per action; only http(s) URLs; blocks credentials in URLs, localhost, private/link-local IPs, IPv6 literals, and links back to this site; alias reserved-word list; 8 KB body cap; Origin check on the gateway.
- **Browser hardening.** Strict CSP (no inline script or style), HSTS preload, frame-ancestors none, COOP, nosniff, Permissions-Policy. The UI renders data with `textContent` only, never `innerHTML`.
- **Auditing.** Creates, edits, deletes, signups, admin actions and denied admin attempts are written to the `audit` collection.

## Deploy

Prereqs: Node 22, `npm i -g firebase-tools`, a Firebase project on the **Blaze** plan (Functions + Secret Manager require it).

```bash
firebase login
# 1. point to your project
#    edit .firebaserc  → your project id
# 2. Console → Authentication → Sign-in method → enable Google
# 3. Console → Firestore → create database (production mode, region asia-south1 or nearest)
# 4. Console → Project settings → add a Web app, paste the SDK config into public/config.js
# 5. secrets
openssl rand -base64 32 | firebase functions:secrets:set ENCRYPTION_KEY   # KEEP A BACKUP: losing it makes stored URLs unreadable
openssl rand -base64 32 | firebase functions:secrets:set IP_HASH_SALT
echo "you@gmail.com,other-admin@gmail.com" | firebase functions:secrets:set ADMIN_EMAILS
# 6. functions/.env  (non-secret)
echo "BASE_URL=https://YOUR-PROJECT-ID.web.app" > functions/.env     # use your custom domain once attached
# 7. ship
cd functions && npm install && npm test && cd ..
firebase deploy
```

After the first deploy, add the site domain (and your custom domain, if any) under Authentication → Settings → Authorized domains.

## Hardening you should add before real traffic

1. **App Check** (reCAPTCHA Enterprise) on the gateway to block scripted abuse.
2. **Safe Browsing / URL reputation check** in `createLink` so the shortener cannot be used to hide phishing links.
3. **Cloud Armor or Firebase budget alerts** against denial-of-wallet floods on `/s/*`.
4. **TTL policy** on `ratelimits.exp` is declared in `firestore.indexes.json`. Confirm it is enabled in the console.
5. Rotate `ENCRYPTION_KEY` only with a re-encrypt migration (ciphertexts are versioned `v1.`).

## Local checks

```bash
cd functions && npm test      # crypto + URL validation unit tests
```

## Layout

```
firebase.json  firestore.rules  firestore.indexes.json  .firebaserc
functions/index.js        gateway + redirect functions
functions/lib/            crypto + validation
public/                   index.html, style.css, app.js, config.js
```
