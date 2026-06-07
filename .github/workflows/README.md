# CI/CD — Vercel auto-deploy

`deploy.yml` runs the test suite and, if it passes, deploys to Vercel **production**
on every push to `main` (and on manual trigger from the Actions tab).

## One-time setup (~3 min)

You only do this once. After that, every merge to `main` auto-deploys.

### 1. Create a Vercel token
- Go to <https://vercel.com/account/tokens>
- **Create Token** → name it `github-actions` → copy the value

### 2. Get the project + org IDs
Run locally in the `amparo-backend` folder:

```bash
npm i -g vercel
vercel link          # log in, select your scope, create/link the project
cat .vercel/project.json
```

`project.json` contains:
```json
{ "orgId": "team_xxx", "projectId": "prj_xxx" }
```

> `.vercel/` is gitignored — these IDs are not secrets but live only locally.

### 3. Add the GitHub secrets
In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|-------|
| `VERCEL_TOKEN` | the token from step 1 |
| `VERCEL_ORG_ID` | `orgId` from step 2 |
| `VERCEL_PROJECT_ID` | `projectId` from step 2 |

### 4. Add the app env vars in Vercel (once)
The deploy uploads code, but runtime env vars live in the Vercel project.
Add them in **Vercel dashboard → Project → Settings → Environment Variables**
(see `../../DEPLOY.md` for the full list).

## That's it
Push to `main` → tests run → if green, Vercel deploys production automatically.
Watch progress in the repo's **Actions** tab.
