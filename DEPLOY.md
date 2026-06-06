# Deploy — Vercel

## One-time setup (~5 min)

1. Go to **vercel.com** → **Add New → Project**
2. Import `falkaniere/amparo-backend` from GitHub (authorize once if needed)
3. **Framework Preset**: Other
4. **Root Directory**: `.` (repo root)
5. **Build & Output Settings**: leave all blank — no build step needed
6. Add the **Environment Variables** listed below
7. Click **Deploy**

### Environment Variables

| Key | Where to find it |
|-----|-----------------|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (secret) |
| `NODE_ENV` | set to `production` |
| `PAGARME_API_KEY` | Pagar.me dashboard |
| `PAGARME_PLATFORM_RECIPIENT_ID` | Pagar.me dashboard |
| `PLATFORM_FEE_PERCENT` | e.g. `15` |
| `EXPO_ACCESS_TOKEN` | expo.dev → Access Tokens |
| `GOOGLE_CLIENT_ID` | Firebase console → Project Settings → Web client ID (see GOOGLE_SIGNIN_SETUP.md) |
| `ADMIN_SECRET` | any long random string |

Do **not** add `PORT` — Vercel manages that.

## Verify

After deploy, open `https://<your-vercel-domain>/health` — you should see:

```json
{ "status": "ok", "service": "amparo-backend", "version": "1.0.0" }
```

## Update the app

Set `EXPO_PUBLIC_API_URL=https://<your-vercel-domain>` in the mobile app's `.env`.

## Local dev

```bash
yarn dev   # still works — runs node directly via nodemon
```

## Notes

- **Rate limiting**: the in-memory store resets on each cold start. For production,
  replace with an Upstash Redis store (`rate-limit-redis`).
- **Pagar.me webhook** (`POST /payments/webhook`): test the raw-body signature
  verification after first deploy. Vercel's serverless runtime re-assembles the body
  correctly in most cases, but verify with a real webhook delivery.
