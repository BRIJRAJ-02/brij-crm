# 0044. Rationale: why Render

## The incident

On 21 October 2026 Railway reported a security incident ([status.railway.com/incident/QH8L8B3E](https://status.railway.com/incident/QH8L8B3E)). It paused all builds and invalidated every API token. Our services keep running, but nothing new deploys: production's api has stayed at `ef6efa82` while `main` moved on, and `deploy-web.yml` waits for an api that never updates. The variables Railway held (database logins, auth and mail keys, our own shared secrets) have to be treated as seen, so they are rotated in the move.

## What we need from a host

The three services as they run today, with nothing rewritten: a Docker build from the monorepo, a command before each deploy (migrations), health checks, a private network where the api reaches the worker's port and the worker reaches Centrifugo's port 9000, a public websocket for Centrifugo, deploys from `main` after CI, and a region near Singapore (Neon is in aws ap-southeast-1, and every query crosses that gap).

## Options

| | Render | Fly.io | Self hosted (one VPS) |
|---|---|---|---|
| Region | Singapore | Singapore (`sin`) | any |
| Config as code | `render.yaml` Blueprint | `fly.toml` per app | Compose plus a deploy script |
| Pre deploy migrations | `preDeployCommand` (paid plans) | `release_command` | our own script |
| Private network | yes, one label hosts, any open port | yes, `.internal` over WireGuard | Docker network |
| Deploy after CI | `autoDeployTrigger: checksPass` | a GitHub Action we write and keep | a GitHub Action we write and keep |
| Monthly cost, three small services | $21 (3 x $7) | about $6 to $15 (shared CPU machines, plus bandwidth) | about $5 to $12 |
| What we would own | nothing new | deploy workflow, tokens in GitHub | the server: patches, TLS, restarts, backups of config, monitoring |

**Render** is the closest match to how Railway worked: it builds from GitHub itself, so no deploy token sits in our CI (the thing that just leaked), it has a pre deploy step, private services, deploy after checks pass, and a Blueprint that lives in the repo. It costs the most of the three, but by a few dollars.

**Fly.io** is cheaper and its private network is encrypted, but deploys would run from GitHub Actions with a Fly token in our secrets, three `fly.toml` files, and machine sizing to tune. More moving parts for a one person team.

**Self hosted** is cheapest and most portable, and the worst fit for now: the owner would run a server, its updates and its certificates, while the product is still being built.

## The pick

Render. For the test phase, its free plan (owner's call, 22 October 2026: no card, $0): one free web service with the api and the worker in one container, and live updates off. Render's free plan allows web services only (no private services or background workers, no pre deploy step), which is why the worker runs as a second process beside the api and the migrations run in the launcher.

Why not keep three services on free: the worker and Centrifugo would each need a public web service that sleeps after 15 idle minutes; a sleeping worker misses the api's wake call, Centrifugo's sockets drop when it sleeps, and the 750 free hours a month cover one always on service, not three.

The upgrade path is three Starter (0.5 CPU, 512 MB) services on the free Hobby workspace: $21 a month, plus $0.15 per GB past 5 GB of outbound traffic a month. The Pro workspace ($25 a month) is only needed for full stack preview environments or teammates.

## The health check and Neon

Railway checked `/api/health/ready` only while a deploy started. Render checks the health path every few seconds for as long as the service runs. `/ready` queries Postgres, so on Render it would keep Neon's compute from ever suspending and use up the free Neon plan's compute hours. Render checks `/api/health` instead (no query), and the keepalive workflow asks for the same path. A deploy whose database is unreachable still never goes live: the launcher's migration and the api's boot both connect first.

## What Render does differently

- **Private traffic is plain http.** Railway's `*.railway.internal` traffic was encrypted (WireGuard). Render's docs do not say its private network is encrypted. Traffic stays inside our workspace's private network in one region, and the secrets it carries (the wake secret, Centrifugo's API key) are only useful from inside it. Accepted for now; switching those two calls to https over the public addresses is the fallback if that changes.
- **No health check path on a private service.** Render checks only that the worker's port is open. The worker's `/health` still answers for anyone who calls it, and Sentry's cron check ins (spec 0010) still catch a worker that is up but stuck.
- **No health check on Centrifugo's /health.** Centrifugo serves `/health` on its internal port 9000, and Render checks the public port. Render watches that port 8000 is open instead.
- **Previews.** Railway gave a full stack per pull request. Render's Hobby workspace previews one service at a time; full stack previews need Pro. Previews are off until that is decided.
- **Sleeping.** Paid Render services never sleep, as on Railway. The worker's own sleep (spec 0008) is about Neon's compute and is unchanged.
