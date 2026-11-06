# tools/partner-sample

## Overview

A sample partner hub (spec 0070, slices 2 to 4): the smallest outside product that connects a Timefix workspace through the OAuth connect, adds and removes its people, and shows Timefix's link page screens in a frame, used by `apps/web/e2e/partner-connect.flow.ts`. Test tooling only: private, never shipped, never deployed. Tagged `server`.

## Key files

| File        | Owns                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts` | The hub's page on `PORT` (5390): Integrate Timefix (a fresh PKCE verifier and state per connect), the callback (state checked, the code swapped at `/api/partner/v1/token` with HTTP Basic and the verifier, the connection read back with its token), and Check connection. Reads `TIMEFIX_URL`, `PARTNER_CLIENT_ID`, `PARTNER_CLIENT_SECRET` |
| `server.ts` (slice 4) | `GET /embed?externalId=&screen=&theme=`: a launch, and Timefix in an iframe sized by the frame's `timefix:height` messages (capped at the window); `timefix:relaunch` asks `POST /launch` for a fresh address, in the frame or a tab opened before the await. It listens on every local address: open it on `127.0.0.1` and the frame is on another site from the app's `localhost`, as a real hub's is |
| `setup.ts`  | A throwaway database (`crm_test_partner_sample`, the checkout's own copy, through `prepareTestDatabase`) with every migration, the sample registered as a partner (redirect `http://localhost:<port>/callback`, frame origins `http://localhost:<port>` and `http://127.0.0.1:<port>`), and the logins and keys written as JSON (`--out`). `--drop` drops it again                                                    |

## Running it

```bash
docker compose up -d postgres mailpit
node tools/partner-sample/setup.ts --out=<scratch>/partner.json
# the api on 3290 against that database (APP_ENV=local, APP_URL=http://localhost:5290, its four database URLs from
# the JSON, MAILPIT_URL=http://localhost:8025), and the web app on 5290 with API_DEV_ORIGIN=http://localhost:3290
TIMEFIX_URL=http://localhost:5290 PARTNER_CLIENT_ID=… PARTNER_CLIENT_SECRET=… node tools/partner-sample/server.ts
FLOW_BASE_URL=http://localhost:5290 pnpm --filter @crm/web exec playwright test partner-connect --project=1280
node tools/partner-sample/setup.ts --drop --out=<scratch>/partner.json
```

## Gotchas

- The redirect address must equal the registered one character for character; `server.ts` sends `http://localhost:<PORT>/callback`, so start it on the port `setup.ts` registered.
- It keeps its pending connects and its one connection in memory: a restart forgets them, as a real hub's database would not.
