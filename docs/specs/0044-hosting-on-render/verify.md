# 0044. Verify: the move to Render

Run after the cutover in [docs/runbooks/render-cutover.md](../../runbooks/render-cutover.md).

| AC | How to check | Result |
|---|---|---|
| AC-1001 | `curl -s https://brij-crm-phi.vercel.app/api/health` shows `release` equal to `git rev-parse origin/main` (or the last commit that changed `apps/api`, `packages` or the lockfile) | |
| AC-1002 | The api's first deploy log in Render shows the pre deploy step applying 0044 to 0051, then `Deploy live` | |
| AC-1003 | Sign in with email and with Google at https://brij-crm-phi.vercel.app; `curl -s https://brij-crm-api.onrender.com/api/rpc/system/status -X POST` without the edge header answers 403 `EDGE_REQUIRED` | |
| AC-1004 | Two browsers on one workspace: a renamed record shows in the other at once | |
| AC-1005 | `grep -nE "value: " render.yaml` lists only `PORT`, `APP_ENV` and `TZ` | |
| AC-1006 | Railway's services are scaled to zero or stopped, the project still exists, a week passes, then it is deleted | |
