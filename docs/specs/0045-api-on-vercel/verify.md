# 0045. Verify: the api on Vercel

Run after the steps in [docs/runbooks/api-on-vercel.md](../../runbooks/api-on-vercel.md).

| AC | How to check | Result |
|---|---|---|
| AC-1101 | `curl -s https://brij-crm-phi.vercel.app/api/health` answers `{"status":"ok","release":"<the deployed commit>"}` | |
| AC-1102 | `curl -s https://brij-crm-phi.vercel.app/api/health/ready` answers `{"status":"ok"}` | |
| AC-1103 | Sign in with an email code at https://brij-crm-phi.vercel.app, open a workspace, create and edit a record | |
| AC-1104 | The Deploy web run shows "The api runs as a Vercel Function", "Migrations applied." and "No server secret in ... client files" | |
| AC-1105 | Run the Jobs workflow by hand (Actions, Jobs, Run workflow): it ends green with `Job run: {"outcome":...}` | |
| AC-1106 | A booking on a public booking page sends its email within a minute | |
| AC-1107 | `curl -s -X POST https://brij-crm-phi.vercel.app/api/internal/jobs/run` answers 401 `UNAUTHENTICATED` | |
| AC-1108 | The function's logs (Vercel, the deployment, Logs) show `API on Vercel` with `jobs: drain` and no value of any secret | |
