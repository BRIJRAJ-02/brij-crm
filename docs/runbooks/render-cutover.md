# Moving the api, worker and Centrifugo to Render

Why: Railway had a security incident on 21 October 2026, paused every build and revoked every token, so production's api is stuck at `ef6efa82`. The decision is [spec 0044](../specs/0044-hosting-on-render/index.md). This page is everything you do, in order. It takes about an hour, and the site is down only for the web redeploy at step 7 (about two minutes). Everyone has to sign in again afterwards.

Before you start: the branch with `render.yaml` must be on `main` (the coordinator lands it). Render reads the Blueprint from `main`.

Cost: three Starter services at $7 a month each, so **$21 a month** on the free Hobby workspace, plus $0.15 per GB after 5 GB of outbound traffic a month.

## 1. Create the Render account and connect GitHub

1. Go to https://dashboard.render.com and sign up with GitHub, as **BRIJRAJ-02** (not a stealth account).
2. When Render asks which repositories it may read, pick **Only select repositories** and choose `BRIJRAJ-02/brij-crm`.
3. Add a card under Billing. Starter services are paid, and the pre deploy step (migrations) needs a paid plan.

## 2. Rotate the secrets first

Railway held every secret below, so treat them as seen. Make the new ones now and keep them in your password manager until step 4. Never paste them into a chat, a commit or an issue.

To make a random secret on your Mac:

```bash
openssl rand -hex 32
```

| Rotate | Where | What to do |
|---|---|---|
| Neon owner password | Neon console, project, **Roles**, the owner role, **Reset password** | Copy the new direct connection string (the host without `-pooler`). That is `DATABASE_URL_OWNER`. |
| Neon app, identity and worker logins | Neon console, **SQL Editor**, database `crm` | For each of the three login roles (their names are the user part of today's `DATABASE_URL`, `IDENTITY_DATABASE_URL` and `DATABASE_URL_DIRECT`), run `alter role <name> with password '<a new openssl secret>';`. Then build the three URLs with the new passwords: `DATABASE_URL` and `IDENTITY_DATABASE_URL` on the `-pooler` host, `DATABASE_URL_DIRECT` on the direct host. Keep `?sslmode=require` as today. |
| Resend API key | https://resend.com/api-keys | Create a new key (sending access, your domain), then delete the old one after step 8. |
| Google sign in client secret | Google Cloud console, APIs and services, **Credentials**, the OAuth client | Add a new secret, then disable the old one after step 8. The client ID stays. |
| Google calendar client secret (only if set) | Same place, the calendar OAuth client | Same as above. |
| reCAPTCHA secret (only if set) | https://www.google.com/recaptcha/admin | Optional; the site key stays. |
| Better Auth secret, edge secret, wake secret, booking link secret, forms salt, Centrifugo keys and admin login | Nothing to do | Render makes new random values itself (`generateValue` in `render.yaml`). |

Do **not** rotate these:

- `CALENDAR_TOKEN_KEY`: it seals the calendar tokens already stored. A new key means every member reconnects their calendar. If production has it, copy the same value across. If calendar sync was never turned on, leave it empty.
- `POSTHOG_KEY` and `SENTRY_DSN_SERVER`: these are not secrets (browsers and servers send them openly). Copy them as they are.

Where to read today's values (`APP_URL`, `SIGNUP_ALLOWLIST`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, the PostHog key, the Sentry DSN and so on): the Railway dashboard, each service, **Variables**.

## 3. Apply the Blueprint

1. In Render, **New**, then **Blueprint**.
2. Pick `BRIJRAJ-02/brij-crm`, branch `main`. Render finds `render.yaml` and shows three services: `brij-crm-api`, `brij-crm-worker` and `brij-crm-centrifugo`, all in Singapore.
3. Name the Blueprint `brij-crm`. Render now asks for every value marked "sync: false". Fill them in from the table in step 4. Leave a field empty when the table says so.
4. Click **Apply**.

## 4. The values, per service

### brij-crm-api

| Variable | Value |
|---|---|
| `APP_URL` | `https://brij-crm-phi.vercel.app` |
| `BETTER_AUTH_URL` | `https://brij-crm-phi.vercel.app` |
| `TRUSTED_ORIGINS` | as on Railway, or empty |
| `DATABASE_URL` | the new app login URL (pooler host) |
| `DATABASE_URL_OWNER` | the new owner URL (direct host) |
| `IDENTITY_DATABASE_URL` | the new identity login URL (pooler host) |
| `SIGNUP_ALLOWLIST` | as on Railway |
| `RESEND_API_KEY` | the new Resend key |
| `MAIL_FROM` | as on Railway |
| `GOOGLE_CLIENT_ID` | as on Railway |
| `GOOGLE_CLIENT_SECRET` | the new Google secret |
| `WORKER_WAKE_ON_USE` | as on Railway (empty means off) |
| `SENTRY_DSN_SERVER` | as on Railway |
| `MONITORING_TEST_FAULT` | empty |
| `POSTHOG_KEY` | as on Railway |
| `POSTHOG_HOST` | empty |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | as on Railway (the secret rotated), or both empty |
| `FORMS_PUBLIC_ORIGIN` | empty, unless Railway had one |
| `CALENDAR_SYNC`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY`, `CALENDAR_WEBHOOK_ORIGIN` | as on Railway (the secret rotated), or all empty if calendar sync was off |

Made by Render, nothing to type: `EDGE_SECRET`, `BETTER_AUTH_SECRET`, `BOOKING_LINK_SECRET`, `FORMS_IP_SALT`. Wired by the Blueprint: `WORKER_INTERNAL_URL`, `WORKER_WAKE_SECRET`, `CENTRIFUGO_TOKEN_SECRET`.

### brij-crm-worker

| Variable | Value |
|---|---|
| `DATABASE_URL_DIRECT` | the new worker login URL (direct host) |
| `CENTRIFUGO_API_URL` | leave empty for now; step 5 fills it |
| `JOBS_RUNNER` | as on Railway (empty means off) |
| `WORKER_IDLE_SLEEP_SECONDS` | as on Railway, or empty |

Everything else on the worker comes from the api or Centrifugo through the Blueprint: `DATABASE_URL`, `APP_URL`, `BOOKING_LINK_SECRET`, `RESEND_API_KEY`, `MAIL_FROM` (so booking emails send), `SENTRY_DSN_SERVER`, the calendar settings and `CENTRIFUGO_API_KEY`. Render makes `WORKER_WAKE_SECRET`.

### brij-crm-centrifugo

| Variable | Value |
|---|---|
| `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` | `https://brij-crm-phi.vercel.app` |

Render makes the API key, the token secret and the admin password and secret.

## 5. Watch the first deploy (it runs migrations 0044 to 0051)

1. Open `brij-crm-api`, then **Events** and the running deploy, then **Logs**. You will see the Docker build, then the pre deploy step `node packages/db/scripts/migrate.ts` applying migrations 0044 to 0051 on Neon, then the start command, then the health check on `/api/health/ready` passing and **Deploy live**. If the pre deploy step fails, nothing changes for users: Railway's api is still the one serving the site. Copy the error into the chat.
2. Open `brij-crm-centrifugo`, then **Connect**, then **Internal**. It shows an address like `brij-crm-centrifugo-ab12:8000`. Take the host part and use port **9000**: for example `http://brij-crm-centrifugo-ab12:9000`.
3. Open `brij-crm-worker`, then **Environment**, set `CENTRIFUGO_API_URL` to that address, and **Save, rebuild and deploy**. Its first deploy failed without it, which is expected. Check its logs end with the worker listening and the relay on.
4. Still on the worker, open **Environment** and check `DATABASE_URL`, `APP_URL` and `RESEND_API_KEY` show values (they come from the api). If one is empty, paste the api's value by hand.
5. Note the two public addresses on each service's page: the api's (like `https://brij-crm-api.onrender.com`) and Centrifugo's (like `https://brij-crm-centrifugo.onrender.com`).
6. Check the api answers: open `https://brij-crm-api.onrender.com/api/health/ready`. It shows `{"status":"ok"}`.

If Centrifugo's address is **not** exactly `brij-crm-centrifugo.onrender.com`, tell the coordinator before step 6: `apps/web/vercel.json` lists that exact address, and the web build refuses any other one.

## 6. Point Vercel at Render

In Vercel, project `brij-crm`, **Settings**, **Environment Variables**, **Production**:

| Variable | New value |
|---|---|
| `API_ORIGIN_INTERNAL` | the api's address, like `https://brij-crm-api.onrender.com` |
| `EDGE_SECRET` | the api's `EDGE_SECRET` on Render (open `brij-crm-api`, **Environment**, reveal and copy it) |
| `VITE_REALTIME_URL` | `wss://brij-crm-centrifugo.onrender.com/connection/websocket` |

Save each one. Keep the old Railway values in your password manager for a week, for a rollback.

## 7. Redeploy the web app and check

1. In GitHub, **Actions**, **Deploy web**, open the latest run on `main` and click **Re-run all jobs**. (Or, in Vercel, **Deployments**, the latest production one, **Redeploy**.)
2. When it is done, open https://brij-crm-phi.vercel.app/api/health. `release` must be the latest commit on `main` that touched the api (the run's "Wait for the API" step prints it).
3. Sign in, with an email code and with Google.
4. Open the same workspace in two browsers. Rename a record in one; it changes in the other at once.
5. Send yourself a test booking if booking pages are on; the email arrives.

## 8. Stop Railway, keep it a week, then delete it

1. In Railway, for `api`, `worker` and `centrifugo`: open the service, **Deployments**, and on the active deployment choose **Remove**. The service, its settings and its variables stay; only the running copy stops.
2. Now delete the old Resend key and disable the old Google secrets (step 2).
3. Keep the Railway project for one week.

**Rollback** (only if Render misbehaves during that week): in Railway, **Redeploy** the last deployment of each service; set their database URLs to the new Neon passwords (the old ones no longer work); put the old Railway values back in Vercel's three variables; redeploy the web app as in step 7.

4. After a calm week, delete the Railway project (**Settings**, **Danger**, **Delete project**) and tell the coordinator, who then removes `.railway/railway.ts` and Railway's socket from `vercel.json`.

## 9. Previews (pull request environments)

`preview.yml` built a Railway environment per pull request. Railway's tokens are gone, so it now runs only if the GitHub repository variable `PREVIEW_BACKEND` is `railway`, and it is unset, so previews are off. The choices:

| Option | Cost | Work |
|---|---|---|
| **Previews off** (recommended for now) | nothing | nothing. CI still checks every push, and the coordinator tests locally |
| Render preview environments | the Pro workspace, $25 a month, plus each preview's services while it runs | a `previews:` block in `render.yaml`, Neon branch wiring, and rewriting `preview.yml` |
| Web only previews on Vercel against production's api | nothing | unsafe: preview code would write to production data. Not recommended |

Recommendation: keep previews off until there are teammates who review pull requests, then move to Render preview environments.
