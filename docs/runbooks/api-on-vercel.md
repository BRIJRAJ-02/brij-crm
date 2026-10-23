# Run the api on Vercel

This puts production's api inside the Vercel project `brij-crm`, beside the web app, so production runs again while Railway is down. No new service, no card. The decision and its trade offs: [spec 0045](../specs/0045-api-on-vercel/index.md). In short: live updates are off, and a job due later (a calendar poll, a retry) can wait up to about an hour when nobody is using the app; jobs a request queues run within seconds.

Do the steps in order. Never paste a secret into a chat, a commit or an issue.

## 1. Before you start

- The Vercel CLI logged in to your own account (`vercel --global-config ~/.vercel-personal whoami`), and the GitHub CLI logged in as BRIJRAJ-02 (`gh auth status`).
- A terminal in the repo root (it is linked to `brij-crm`).
- In Vercel, Settings, Environment Variables: leave **Sensitive** off for the variables below. A Sensitive variable comes down empty to the deploy, so the deploy can't tell where the api runs and can't check the browser files for it.

## 2. Keep the values, or make new ones

The owner's call for now (22 Oct): keep everything the same. With `railway login` done, step 3's script copies every value from Railway's api and worker services, keeps Vercel's own `EDGE_SECRET`, and makes only `JOBS_RUN_SECRET` new, so sessions and guests' booking links keep working. Skip to step 3.

To rotate instead (`--rotate`), treat every secret Railway held as seen, as in [render-cutover.md](render-cutover.md) step 2:

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

With Railway logged in it runs in keep mode by default: it copies every value from Railway (production), asks with hidden typing only for a required value Railway lacks, and otherwise needs no input. If Railway isn't logged in it says "Run `railway login` first" (or pass `--rotate` to type the new values from step 2 and make fresh shared secrets). It never prints a value, keeps Railway's values only in a private temporary folder it removes on exit, and ends with the list of names it set. The table below is what it sets in rotate mode; in keep mode every value is Railway's, `EDGE_SECRET` stays Vercel's, and only `JOBS_RUN_SECRET` is new.

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
| `DATABASE_URL_OWNER` | the owner URL, direct host (Railway's in keep mode). The deploy applies migrations with it |
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

## Timefix: the 15 minute timer (23 Oct)

Timefix's project (`timefix-app`, team `stealthprojects`) is on Vercel Pro, so Vercel Cron runs its job queue every 15 minutes: each calendar's poll then runs on time when nobody uses the app, under Google's push ([spec 0045](../specs/0045-api-on-vercel/index.md), On Vercel Cron). brij-crm, on Hobby, keeps the hourly Jobs workflow.

1. Once, set the cron's secret, which nobody needs to see. From a folder linked to `timefix-app` (`vercel link --project timefix-app --scope stealthprojects`):

   ```bash
   openssl rand -hex 32 | vercel --global-config ~/.vercel-timefix --scope stealthprojects env add CRON_SECRET production
   ```

   Production variables are Sensitive by default, which is right here: no deploy step reads it back.
2. The deploy adds `"crons": [{ "path": "/api/internal/jobs/run", "schedule": "*/15 * * * *" }]` to Timefix's copy of `apps/web/vercel.json`, as it sets Timefix's region; the repository's copy never has it.
3. Check: Vercel, `timefix-app`, Settings, Cron Jobs lists it; its logs show `jobs.drain` with `"by":"cron"` every 15 minutes. Without `CRON_SECRET` the call answers 404 and runs nothing.

## Going back to Railway (or Render)

1. Bring the api, worker and Centrifugo up there, with `EDGE_SECRET` equal to Vercel's Production one (and the other new secrets, so sign ins and booking links carry over).
2. In Vercel Production, set `API_ORIGIN_INTERNAL` to the api's address and `VITE_REALTIME_URL` to Centrifugo's socket.
3. Redeploy the web app (push, or re run Deploy web). The deploy then waits for that api instead of migrating, and the Jobs workflow finds nothing to do.

## Rollback

In Vercel, Deployments, pick the last good production deployment, **Promote**. Migrations only add, so older code runs on the migrated database.
