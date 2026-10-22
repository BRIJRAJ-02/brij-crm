# Run the api on Vercel

This puts production's api inside the Vercel project `brij-crm`, beside the web app, so production runs again while Railway is down. No new service, no card. The decision and its trade offs: [spec 0045](../specs/0045-api-on-vercel/index.md). In short: live updates are off, and a background job can wait up to about 10 minutes when nobody is using the app.

Do the steps in order. Never paste a secret into a chat, a commit or an issue.

## 1. Before you start

- The Vercel CLI logged in to your own account (`vercel --global-config ~/.vercel-personal whoami`), and the GitHub CLI logged in as BRIJRAJ-02 (`gh auth status`).
- A terminal in the repo root (it is linked to `brij-crm`).
- In Vercel, Settings, Environment Variables: leave **Sensitive** off for the variables below. A Sensitive variable comes down empty to the deploy, so the deploy can't tell where the api runs and can't check the browser files for it.

## 2. Make the new secrets (Railway held the old ones)

Treat every secret Railway held as seen, as in [render-cutover.md](render-cutover.md) step 2:

| Make | Where |
|---|---|
| New passwords for the app, identity and worker logins, and the owner | Neon console, as in render-cutover.md step 2. Build four URLs: `DATABASE_URL` and `IDENTITY_DATABASE_URL` on the `-pooler` host, `DATABASE_URL_DIRECT` and `DATABASE_URL_OWNER` on the direct host (no `-pooler`) |
| A new Resend key | https://resend.com/api-keys |
| A new Google sign in client secret (and the calendar one, if calendar sync is on) | Google Cloud console, Credentials |

Keep them in your password manager for step 3. The script makes the other secrets itself.

## 3. Put the variables in place

Run, from the repo root:

```bash
bash /private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/686e1a66-aabc-4dfa-a43f-c1550cbabba8/scratchpad/vercel-api-setup.sh
```

It asks for the values from step 2 with hidden typing, makes fresh random ones for the rest, copies the plain settings from Railway if its CLI still works (else it asks), and never prints a value. It does all of the following; to do it by hand instead, use the table.

### Vercel, Production environment

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `NODE_ENV` | `production` |
| `APP_URL`, `BETTER_AUTH_URL` | `https://brij-crm-phi.vercel.app` |
| `DATABASE_URL` | the app login, `-pooler` host (new password) |
| `IDENTITY_DATABASE_URL` | the identity login, `-pooler` host (new password) |
| `DATABASE_URL_DIRECT` | the worker login, direct host (new password). The jobs run on it |
| `RESEND_API_KEY` | the new Resend key |
| `MAIL_FROM` | as on Railway |
| `BETTER_AUTH_SECRET` | new: `openssl rand -hex 32` (everyone signs in again once) |
| `EDGE_SECRET` | new: `openssl rand -hex 32` (the middleware and the api read the same one) |
| `WORKER_WAKE_SECRET`, `BOOKING_LINK_SECRET` | new: `openssl rand -hex 32` each (guests' old booking manage links stop working) |
| `FORMS_IP_SALT` | new: `openssl rand -hex 32` |
| `JOBS_RUN_SECRET` | new: `openssl rand -hex 32`, the same value as the GitHub secret below |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | as on Railway, the secret new; or both unset |
| `SIGNUP_ALLOWLIST`, `TRUSTED_ORIGINS`, `POSTHOG_KEY`, `SENTRY_DSN_SERVER` | as on Railway, or unset |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | as on Railway (the secret new), or both unset |
| `CALENDAR_SYNC`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY` | as on Railway (the client secret new, the token key the same), or all unset |
| `CALENDAR_WEBHOOK_ORIGIN` | `https://brij-crm-phi.vercel.app` when calendar sync is on (Google's notices now reach the api here) |

Remove from Production: `API_ORIGIN_INTERNAL` (so `/api` goes to the function), `VITE_REALTIME_URL` (no live updates), `CENTRIFUGO_TOKEN_SECRET` and `WORKER_INTERNAL_URL` if they are there.

Never give a server variable a `VITE_` name: Vite puts every `VITE_` variable into the browser's files. The deploy checks the built files for every server value and stops if one is there.

### GitHub, repository secrets (BRIJRAJ-02/brij-crm, Settings, Secrets and variables, Actions)

| Secret | Value |
|---|---|
| `DATABASE_URL_OWNER` | the owner URL, direct host (new password). The deploy applies migrations with it |
| `JOBS_RUN_SECRET` | the same value as Vercel's `JOBS_RUN_SECRET` |

## 4. Recommended: protect old deployment addresses

Vercel, Settings, Deployment Protection: **Standard Protection**. Then only `brij-crm-phi.vercel.app` is public, and old deployments' own addresses (which run old code with today's secrets) ask for a Vercel login.

## 5. Deploy

Push to `main` (or, in GitHub, Actions, Deploy web, the last run, **Re-run all jobs**). The Deploy web run should say "The api runs as a Vercel Function", apply the migrations, check the client files, and deploy.

## 6. Check

```bash
curl -s https://brij-crm-phi.vercel.app/api/health
curl -s https://brij-crm-phi.vercel.app/api/health/ready
```

The first shows `"status":"ok"` and the deployed commit as `release`; the second `"status":"ok"`. Then sign in at https://brij-crm-phi.vercel.app and edit a record. In GitHub, Actions, **Jobs**, Run workflow: it should end green with `Job run: {"outcome":...}`. The rest is in [verify.md](../specs/0045-api-on-vercel/verify.md).

If `/api/health` answers `API_UNAVAILABLE`, open the deployment's Logs in Vercel: the line "Refusing to start, the environment is invalid" names each variable that is missing or wrong, never its value.

## Going back to Railway (or Render)

1. Bring the api, worker and Centrifugo up there, with `EDGE_SECRET` equal to Vercel's Production one (and the other new secrets, so sign ins and booking links carry over).
2. In Vercel Production, set `API_ORIGIN_INTERNAL` to the api's address and `VITE_REALTIME_URL` to Centrifugo's socket.
3. Redeploy the web app (push, or re run Deploy web). The deploy then waits for that api instead of migrating, and the Jobs workflow finds nothing to do.

## Rollback

In Vercel, Deployments, pick the last good production deployment, **Promote**. Migrations only add, so older code runs on the migrated database.
