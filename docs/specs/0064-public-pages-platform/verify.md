# 0064 verify: Public pages platform

How `/check verify` proves each criterion. Unit and integration tests run against a real Postgres (never a mocked database). Vercel's API and DNS are faked behind their wrapper and resolver in tests; one manual check per production uses a real test domain once the owner has set the settings. Screenshots in light and dark inside the real layout, as spec 0058 sets, and heavy suites on CI.

## Per criterion

| AC | How it is checked |
|---|---|
| AC-6401 | Unit tests of the host rules: uppercase, punycode, ports, paths, IPs and each of our own hosts. Browser test of the one line refusal. |
| AC-6402 | Integration test with a fake Vercel client: the records shown equal what it returned, the TXT name and token are correct, and a `_vercel` record appears when asked. Browser test: every value has a working Copy. |
| AC-6403 | Browser test of the four states and their icons. Check now is refused inside 10 seconds. Job tests: 15 minute and daily rescheduling. |
| AC-6404 | Job test: no TXT means no Vercel add call. Middleware and shell tests: waiting, removed and unknown hosts answer the same not found shell. |
| AC-6405 | Integration test: adding an apex also adds `www` with a 308 redirect; a subdomain adds nothing else. |
| AC-6406 | Middleware tests: `/`, `/<slug>`, `/b/`, `/f/`, `/embed/`, `/api/public/` and built files on a custom host; app paths answer not found. The middleware still imports only `@vercel/functions`. |
| AC-6407 | `handle-meta` tests: canonical, `og:url` and card on the custom origin; the `timefix.com` address answers 200 with that canonical. Browser test: Share, QR and Ready panel show the custom domain. Email test: links stay on `timefix.com`. |
| AC-6408 | Browser test: remove confirms in a Modal and the Vercel remove is called. Job test: 7 days pending becomes failed. Integration test: a second claim of a live host is `CONFLICT`. |
| AC-6409 | Env tests: the api and web boot with the settings unset and the card is hidden. Lint: no Vercel API call outside the wrapper. |
| AC-6413 | Integration tests: 5 pages allowed, a 6th refused; handle rules of 0056 unchanged. |
| AC-6414 | Browser test: switcher tiles, New link page with handle and name, Ready panel after create. |
| AC-6415 | Browser test: Home shows the primary and "2 more pages"; Make primary moves it. |
| AC-6416 | Browser test: delete asks first; the handle stays reserved; the only page cannot be deleted. |
| AC-6417 | Migration test on seeded data: pages, items, order, views and presses read the same before and after. |
| AC-6419 | Browser test of the screen and the event chips; integration test of the 10 endpoint limit and the `webhooks.manage` refusal. |
| AC-6420 | Integration test: the secret is returned only on create and rotate; during the 24 hours after rotation both `v1` values are sent and each verifies. |
| AC-6421 | Unit test: a known body, time and secret give the expected header; a receiver sample in the test verifies it. |
| AC-6422 | Integration test: a booking that rolls back queues nothing; one that commits queues one delivery per subscribed endpoint, once. |
| AC-6423 | Job tests with a fake clock: the backoff steps, gave up after the last, no redirect followed, the endpoint turned off after 3 days with the email and notice. |
| AC-6424 | Unit tests of the address rules (each private range in IPv4 and IPv6, metadata, IP literals, http, other ports) and a rebinding test where the second lookup turns private. |
| AC-6425 | Browser test: the log lists deliveries with status, time and excerpt; Resend and Send test event show inline results. |
| AC-6426 | Contract tests: each payload schema, no field outside the list, 64 KB cap. |
| AC-6431 | Browser tests: valid IDs save, bad ones show the hint; workspace settings need an admin. |
| AC-6432 | Playwright test with network capture: no Google or Meta request before Allow; Decline keeps it that way across reloads; Cookie settings reopens the bar. |
| AC-6433 | Playwright test after Allow: page view, link press, booking and form events seen with the right names; consent mode default denied then granted. |
| AC-6434 | `csp.test.ts`: public paths list exactly the pixel origins; app paths list none. |
| AC-6437 | Browser tests with emulated browser languages: Spanish picks Spanish, an unsupported language picks English, a fixed setting wins. |
| AC-6438 | Catalogue test: every key has English; screenshots of a booking page in Hindi and German; `lang` set. |
| AC-6439 | Email tests: a booking made in French sends French visitor emails; the host's email stays in the host's language. |
| AC-6440 | Bundle test: only the chosen catalogue loads; `pnpm size` passes on CI. |
| AC-6442 | Spec 0058's alignment probe and motion check run on every new screen; reviewer passes. |
| AC-6443 | Browser tests: the footer is present on a custom domain and on every public page. |

## Guard tests

- Every new tenant table forces row level security and has a policy.
- A cross workspace read of endpoints, deliveries and tracking returns nothing.

## Before landing a lane

1. The lane's skill pass (`crm-api-backend`, `crm-data-model-access`, `crm-design-system`, `security-and-hardening`).
2. `security-access-reviewer` for every lane, `state-performance-reviewer` for P1, P2 and P3, then `design-system-guardian` and `ux-interaction-reviewer` for screens.
3. Alignment probe, motion check and screenshots in light and dark.
4. Heavy suites on CI; migrations keep their placeholder numbers until the final merge.
