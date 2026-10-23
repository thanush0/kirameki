# Kirameki — free-tier backend deployment (Render + Firebase)

This migration keeps the existing Firebase Hosting frontend and its visual design. It moves the HTTP backend to a Render free web service so Firebase Cloud Functions/Secret Manager and the Blaze upgrade are not needed. Free service limits apply; Render free services can sleep and cold-start. Firestore/Auth still use Firebase quotas and are not unlimited.

## 1. Important before you start
- Do not upgrade Firebase to Blaze if you do not want a billing account.
- Do not upload a service-account JSON file into the website's `public/` directory or commit it to Git.
- The service account has powerful project access. Keep its JSON only in Render's private environment variables. If you are uncomfortable creating a service account, stop before step 3.
- `BASE_URL` must be your Render service URL (not the Firebase Hosting URL), because `/s/<code>` and `/q/<code>` redirects are served by the backend.
- Replace the placeholder backend URL in `public/config.js` after Render creates your service.

## 2. Deploy the backend to Render
1. Create a private GitHub repository and upload this project folder's contents. Do not commit any private key, `.env`, or service-account JSON. `functions/.env` is excluded below; remove it before pushing if it contains anything sensitive.
2. In Render, choose **New + → Web Service**, connect the repository, and set:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
3. Add environment variables in Render → Environment:
   - `FIREBASE_PROJECT_ID` = `kirameki-dbc34`
   - `FRONTEND_ORIGIN` = `https://kirameki-dbc34.web.app`
   - `BASE_URL` = the exact Render URL Render assigns, e.g. `https://kirameki-backend-xxxx.onrender.com`
   - `ENCRYPTION_KEY` = a random 32-byte base64 key. Generate locally with `openssl rand -base64 32`.
   - `IP_HASH_SALT` = a different random value. Generate with `openssl rand -hex 32`.
   - `ADMIN_EMAILS` = comma-separated verified Google email addresses allowed to administer the app. Use an empty value if you do not want an admin account.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the entire service-account JSON on one line (see step 3).
4. Wait for Render to finish deploying. Visit `https://YOUR-RENDER-HOST/healthz`; expected response: `{"ok":true,"service":"kirameki-backend"}`.

## 3. Give the backend Firebase access
1. Open Google Cloud Console for project `kirameki-dbc34` → IAM & Admin → Service Accounts.
2. Create a dedicated service account, for example `kirameki-backend`, and grant only the permissions required for Firestore and Firebase Authentication. Follow Firebase Admin SDK guidance for the appropriate roles; avoid Owner/Editor if narrower roles are available.
3. Create a JSON key and copy its full contents directly into Render's `FIREBASE_SERVICE_ACCOUNT_JSON` secret variable. Never put it in source control, this ZIP, or the public website. Delete/revoke the key if it leaks.
4. Ensure Firestore exists and Google sign-in is enabled in Firebase Authentication. Add `kirameki-dbc34.web.app` to Authentication → Settings → Authorized domains.

**Free-tier caveat:** Google Cloud service account access to Firestore/Auth does not itself require Cloud Functions. Firestore operations remain subject to the project's free quotas and current Google Cloud policies. Do not enable billing for any API if you want to avoid paid usage.

## 4. Point the website to Render
1. Edit `public/config.js` and change `backendBaseUrl` from the placeholder to the exact Render URL, for example:
   `export const backendBaseUrl = 'https://kirameki-backend-xxxx.onrender.com';`
2. Commit/push that change. Firebase Hosting deploy command from the project root:
   `firebase deploy --only hosting`
3. The website will call the Render backend for `/g`. Generated short links and dynamic QR URLs will use the Render hostname because `BASE_URL` points there.

## 5. Verify
Run these from your terminal, replacing the host:

```bash
curl -i https://YOUR-RENDER-HOST/healthz
curl -i -X POST https://YOUR-RENDER-HOST/g \
  -H 'Origin: https://kirameki-dbc34.web.app' \
  -H 'Content-Type: application/json' \
  --data '{"a":"qr.static","d":{"text":"https://example.com"}}'
```
The second request should return JSON with `ok: true` and an SVG string in `d.svg`. If it returns a server error, inspect Render → Logs and verify environment variables and Firebase credentials. Do not test `/g` with GET; the gateway intentionally rejects it.

## 6. Free-hosting limitations
- Render free web services may sleep when idle and take time to wake.
- The backend hostname is separate from `kirameki-dbc34.web.app`; generated short links and QR redirects will use the Render hostname.
- This package does not make Firebase Functions free; it removes the Functions dependency from the deployed flow. Firebase Hosting and Firestore remain separate services.
- Avoid deploying `functions/` as Cloud Functions; deploy only Hosting with `firebase deploy --only hosting`.
