# Kirameki — Render-only deployment (SQLite, no Firebase)

This build has **no Firebase SDK, Firebase Admin SDK, Firestore, or Cloud Functions dependency**. Render serves both the static frontend and Node.js API from one web service. User accounts use local email/password authentication; QR generation and link management use SQLite.

## Important data-loss warning

The Blueprint sets `SQLITE_PATH=/tmp/kirameki.sqlite` so the service runs on Render Free without a paid persistent disk. **SQLite data in `/tmp` is ephemeral**: users, passwords, links, click records, and audit logs can disappear when the instance restarts, redeploys, sleeps, or is replaced. Render Free web services do not provide a persistent disk. Do not use this setup for important production data. Back up the SQLite file manually only for temporary testing; the file may not exist after a restart.

## Deploy with Blueprint
1. Extract this project and push the **contents** of the `kirameki-main` folder to a GitHub repository. Ensure `render.yaml` is at the repository root. Use a private repository if you prefer.
2. Open https://dashboard.render.com/ and choose **New → Blueprint**.
3. Select the repository and deploy the `kirameki` service. The Blueprint uses Render's free plan and generates session/encryption secrets.
4. When asked for `BASE_URL`, enter the actual service URL Render assigns, e.g. `https://kirameki-xxxx.onrender.com` (use your real URL, not the example).
5. Set `ADMIN_EMAILS` to the email address that should have the admin role. Use a comma-separated list for multiple admins.
6. Wait for the service to finish deploying, then test `https://YOUR-RENDER-HOST/healthz`. It should return JSON with `"ok":true`, `"database":"sqlite"`, and `"firebase":false`.
7. Open the Render URL. Use **Sign in / Create account** to register. The UI prompts for email and password. Passwords are hashed with bcrypt; session tokens are signed by `SESSION_SECRET`.

## Environment variables
- `BASE_URL`: exact public Render URL, including `https://` and no trailing slash. Required for generated short URLs.
- `SESSION_SECRET`: long random secret; Blueprint generates one.
- `ENCRYPTION_SECRET`: long random secret used to encrypt link destinations; Blueprint generates one. **Changing this invalidates the ability to decrypt existing link destinations.**
- `IP_HASH_SALT`: random salt used to hash IPs for abuse protection.
- `ADMIN_EMAILS`: email(s) to grant admin access.
- `ALLOW_REGISTRATION`: `true` enables new account registration; `false` disables it.
- `SQLITE_PATH`: default `/tmp/kirameki.sqlite` on Render Free. Local development can use `./kirameki.sqlite`.

## Local run (Node.js 22)
```bash
npm install
cp .env.example .env
# Edit .env; make BASE_URL=http://localhost:10000
npm start
```
Open http://localhost:10000 and test `http://localhost:10000/healthz`.

## Useful tests
```bash
npm test
curl -i https://YOUR-RENDER-HOST/healthz
curl -i -X POST https://YOUR-RENDER-HOST/g \
  -H 'Content-Type: application/json' \
  -d '{"a":"qr.static","d":{"text":"https://example.com"}}'
```

## Notes and limitations
- No Firebase is used by this project. The old Firebase Hosting deployment is separate and is not needed for this Render-only setup.
- Authentication is local email/password; it is not Google sign-in. Registration is enabled by default. Set `ADMIN_EMAILS` before the admin account first signs in/registers.
- Free Render services can sleep while idle. First request after idle may be slow.
- SQLite in `/tmp` is deliberately ephemeral. For durable data you would need a persistent disk or an external database; neither is part of this SQLite-only, no-paid-storage configuration.
- This is a migration of the existing UI and core features, not a guarantee that every original Firebase-admin operation behaves identically. Admin user disabling and core link/QR management are implemented locally.
