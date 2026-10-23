# 0047. Verify: the operator console

Run after `OPERATOR_EMAILS` (the owner's address) and `SITE_ORIGINS` are set on the app's api, and `VITE_SITE_HIT_URL` on the marketing site's build.

| AC | How to check | Result |
|---|---|---|
| AC-1617, AC-1619 | Signed in as the owner, the account menu shows "Super admin"; signed in as anyone else it doesn't | |
| AC-1618 | As a person not on the list, `POST /api/rpc/operator/overview` answers 404 `NOT_FOUND`; the owner without two factor sees the plain "turn on two factor" state | |
| AC-1620 | After opening each page, `auth.operator_event` holds one row per read with the procedure and request id | |
| AC-1621, AC-1622 | `pnpm --filter @crm/db test guards operator`: the definer list, hardening and the refused column read pass | |
| AC-1624 | Using the app adds today's row in `auth.activity_day` for the person, once | |
| AC-1625 | Opening a booking page in a private window adds a view; opening it signed in as its host doesn't; the editor preview doesn't | |
| AC-1627 | Loading two marketing pages adds two `auth.site_visit` rows with the same visitor and no query string; `curl` with a bot user agent adds none | |
| AC-1629 to AC-1632 | Each page shows its figures and bars for 7, 30 and 90 days | |
| AC-1633 | Screenshots at 1280 and 390, light and dark, of each page, its loading and its empty state | |
