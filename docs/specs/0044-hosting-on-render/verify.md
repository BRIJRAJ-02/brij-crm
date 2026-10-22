# 0044. Verify: the move to Render

Run after the cutover in [docs/runbooks/render-cutover.md](../../runbooks/render-cutover.md).

| AC | How to check | Result |
|---|---|---|
| AC-1001 | `curl -s https://brij-crm-phi.vercel.app/api/health` shows `release` equal to `git rev-parse origin/main` (or the last commit that changed `apps/api`, `packages` or the lockfile) | |
| AC-1002 | The first deploy's log in Render shows the migration applying 0044 to 0051, then the api and the worker starting, then `Deploy live` | |
| AC-1003 | Sign in with email and with Google at https://brij-crm-phi.vercel.app; a POST to `https://brij-crm-api.onrender.com/api/rpc/system/status` without the edge header answers 403 `EDGE_REQUIRED` | |
| AC-1004 | The log shows `Relay off` once and no restarts; the web app works with no live updates notice in the console | |
| AC-1005 | `grep -nE "value: " render.yaml` lists only `PORT`, `WORKER_PORT`, `WORKER_INTERNAL_URL`, `APP_ENV`, `LIVE_UPDATES` and `TZ` | |
| AC-1007 | `launch.test.ts` passes in CI | |
| AC-1006 | Railway's services are scaled to zero or stopped, the project still exists, a week passes, then it is deleted | |
