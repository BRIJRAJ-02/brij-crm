# Moving the backend to Render (free plan)

Why: Railway had a security incident on 21 October 2026, paused every build and revoked every token, so production's api is stuck at `ef6efa82`. The decision is [spec 0044](../specs/0044-hosting-on-render/index.md). For the test phase it runs on Render's free plan: **$0, no card**. One free service runs the api and the worker together, and live updates are off (a change by someone else shows after a reload).

This page is everything you do, in order. It takes about 45 minutes, and the site is down only for the web redeploy at step 7 (about two minutes). Everyone has to sign in again afterwards.

Before you start: the branch with this `render.yaml` must be on `main` (the coordinator lands it). Render reads the Blueprint from `main`.

## 1. Create the Render account and connect GitHub

1. Go to https://dashboard.render.com and sign up with GitHub, as **BRIJRAJ-02** (not a stealth account). No card is needed.
2. When Render asks which repositories it may read, pick **Only select repositories** and choose `BRIJRAJ-02/brij-crm`.

## 2. Rotate the secrets first

Railway held every secret below, so treat them as seen. Make the new ones now and keep them in your password manager until step 4. Never paste them into a chat, a commit or an issue.

To make a random secret on your Mac:

```bash
openssl rand -hex 32
```

| Rotate | Where | What to do |
|---|---|---|
| Neon owner password | Neon console, project, **Roles**, the owner role, **Reset password** | Copy the new direct connection string (the host without `-pooler`). That is `DATABASE_URL_OWNER`. |
| Neon app, identity and worker logins | Neon console, **SQL Editor**, database `crm` | For each of the three login roles (their names are the user part of today's `DATABASE_URL`, `IDENTITY_DATABASE_URL` and `DATABASE_URL_DIRECT` on Railway), run `alter role <name> with password '<a new openssl secret>';`. Then build the three URLs with the new passwords: `DATABASE_URL` and `IDENTITY_DATABASE_URL` on the `-pooler` host, `DATABASE_URL_DIRECT` on the direct host. Keep `?sslmode=require` as today. |
| Resend API key | https://resend.com/api-keys | Create a new key (sending access, your domain), then delete the old one after step 8. |
| Google sign in client secret | Google Cloud console, APIs and services, **Credentials**, the OAuth client | Add a new secret, then disable the old one after step 8. The client ID stays. |
| Google calendar client secret (only if set) | Same place, the calendar OAuth client | Same as above. |
| reCAPTCHA secret (only if set) | https://www.google.com/recaptcha/admin | Optional; the site key stays. |
| Better Auth secret, edge secret, wake secret, booking link secret, forms salt | Nothing to do | Render makes new random values itself (`generateValue` in `render.yaml`). |

Do **not** rotate these:

- `CALENDAR_TOKEN_KEY`: it seals the calendar tokens already stored. A new key means every member reconnects their calendar. If production has it, copy the same value across. If calendar sync was never turned on, leave it empty.
- `POSTHOG_KEY` and `SENTRY_DSN_SERVER`: these are not secrets (browsers and servers send them openly). Copy them as they are.

Where to read today's values (`APP_URL`, `SIGNUP_ALLOWLIST`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, the PostHog key, the Sentry DSN and so on): the Railway dashboard, each service, **Variables**.

## 3. Apply the Blueprint

1. In Render, **New**, then **Blueprint**.
2. Pick `BRIJRAJ-02/brij-crm`, branch `main`. Render finds `render.yaml` and shows one service, `brij-crm-api`, free, in Singapore.
3. Name the Blueprint `brij-crm`. Render now asks for every value marked "sync: false". Fill them in from the table in step 4. Leave a field empty when the table says so.
4. Click **Apply**.

## 4. The values

| Variable | Value |
|---|---|
| `APP_URL` | `https://brij-crm-phi.vercel.app` |
| `BETTER_AUTH_URL` | `https://brij-crm-phi.vercel.app` |
| `TRUSTED_ORIGINS` | as on Railway, or empty |
| `DATABASE_URL` | the new app login URL (pooler host) |
| `DATABASE_URL_OWNER` | the new owner URL (direct host) |
| `IDENTITY_DATABASE_URL` | the new identity login URL (pooler host) |
| `DATABASE_URL_DIRECT` | the new worker login URL (direct host) |
| `SIGNUP_ALLOWLIST` | as on Railway |
| `RESEND_API_KEY` | the new Resend key |
| `MAIL_FROM` | as on Railway |
| `GOOGLE_CLIENT_ID` | as on Railway |
| `GOOGLE_CLIENT_SECRET` | the new Google secret |
| `WORKER_WAKE_ON_USE` | as on Railway (empty means off) |
| `JOBS_RUNNER` | as on Railway (empty means off) |
| `WORKER_IDLE_SLEEP_SECONDS` | as on Railway, or empty |
| `SENTRY_DSN_SERVER` | as on Railway |
| `MONITORING_TEST_FAULT` | empty |
| `POSTHOG_KEY` | as on Railway |
| `POSTHOG_HOST` | empty |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | as on Railway (the secret rotated), or both empty |
| `FORMS_PUBLIC_ORIGIN` | empty, unless Railway had one |
| `CALENDAR_SYNC`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY`, `CALENDAR_WEBHOOK_ORIGIN` | as on Railway (the secret rotated), or all empty if calendar sync was off |

Made by Render, nothing to type: `EDGE_SECRET`, `BETTER_AUTH_SECRET`, `WORKER_WAKE_SECRET`, `BOOKING_LINK_SECRET`, `FORMS_IP_SALT`. Set in the Blueprint: `PORT`, `WORKER_PORT`, `WORKER_INTERNAL_URL`, `APP_ENV`, `LIVE_UPDATES=off`, `TZ`. There are no Centrifugo variables.

## 5. Watch the first deploy (it runs migrations 0044 to 0051)

1. Open `brij-crm-api`, then **Events** and the running deploy, then **Logs**. You will see the Docker build, then the migration applying 0044 to 0051 on Neon, then the api and the worker starting (the worker says `Relay off`, which is expected), then **Deploy live**.
2. If the migration fails, nothing else starts and users are not affected: Railway's api is still the one serving the site. Copy the error into the chat.
3. Note the service's address at the top of its page, like `https://brij-crm-api.onrender.com`. Open `https://brij-crm-api.onrender.com/api/health`; it shows `{"status":"ok","release":"<a commit>"}`.

## 6. Point Vercel at Render

In Vercel, project `brij-crm`, **Settings**, **Environment Variables**, **Production**:

| Variable | Change |
|---|---|
| `API_ORIGIN_INTERNAL` | set to the service's address, like `https://brij-crm-api.onrender.com` |
| `EDGE_SECRET` | set to the service's `EDGE_SECRET` on Render (open `brij-crm-api`, **Environment**, reveal and copy it) |
| `VITE_REALTIME_URL` | **remove it** (live updates are off; without it the app never tries to connect) |

Keep the old Railway values in your password manager for a week, for a rollback.

## 7. Redeploy the web app and check

1. In GitHub, **Actions**, **Deploy web**, open the latest run on `main` and click **Re-run all jobs**. (Or, in Vercel, **Deployments**, the latest production one, **Redeploy**.)
2. When it is done, open https://brij-crm-phi.vercel.app/api/health. `release` must be the latest commit on `main` that touched the api (the run's "Wait for the API" step prints it).
3. Sign in, with an email code and with Google.
4. Create and edit a record; reload in a second browser and see the change.
5. In GitHub, **Actions**, **Keep alive**, click **Run workflow** once and check it passes. From now on it runs every 10 minutes by itself, so the free service doesn't fall asleep. GitHub sometimes runs it late; then the first visitor after a quiet spell may wait about a minute.

## 8. Stop Railway, keep it a week, then delete it

1. In Railway, for `api`, `worker` and `centrifugo`: open the service, **Deployments**, and on the active deployment choose **Remove**. The service, its settings and its variables stay; only the running copy stops.
2. Now delete the old Resend key and disable the old Google secrets (step 2).
3. Keep the Railway project for one week.

**Rollback** (only if Render misbehaves during that week): in Railway, **Redeploy** the last deployment of each service; set their database URLs to the new Neon passwords (the old ones no longer work); put the old Railway values back in Vercel's variables, including `VITE_REALTIME_URL`; redeploy the web app as in step 7.

4. After a calm week, delete the Railway project (**Settings**, **Danger**, **Delete project**) and tell the coordinator, who then removes `.railway/railway.ts` and Railway's socket from `vercel.json`.

## 9. Previews (pull request environments)

`preview.yml` built a Railway environment per pull request. Railway's tokens are gone, so it now runs only if the GitHub repository variable `PREVIEW_BACKEND` is `railway`, and it is unset, so previews are off. The choices:

| Option | Cost | Work |
|---|---|---|
| **Previews off** (recommended for now) | nothing | nothing. CI still checks every push, and the coordinator tests locally |
| Render preview environments | the paid Pro workspace, plus each preview's services while it runs | a `previews:` block in `render.yaml`, Neon branch wiring, and rewriting `preview.yml` |
| Web only previews on Vercel against production's api | nothing | unsafe: preview code would write to production data. Not recommended |

## Later: the paid layout

When the test phase ends and live updates matter, spec 0044 describes the paid layout: the same service on Starter, plus a worker and a Centrifugo service, about $21 a month. That needs a card and a short runbook of its own.
