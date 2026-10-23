# 0047. Operator console, slice 1: super admin analytics

**Date**: 2026-10-23
**Status**: Accepted (the owner delegates product and UX calls, 21 Oct 2026; access decisions follow the coordinator's landing notes)

## Summary

The owner asked for "a super admin list to see all the users and analytics around each user's usage", with website analytics, dashboard analytics, and booking pages both consolidated and one by one (ask A130). This is the first slice of scope #39, the operator console, and it is read only: no support access to a workspace, no plan changes and no suspensions yet.

The console lives in Settings, in a Super admin group only super admins see (every setting lives under Settings, 20 Oct 2026). It has four pages: **Overview** (the app's dashboard analytics), **Users** (every account and its usage, then one person's page), **Booking pages** (every page together, then one page) and **Website** (the marketing site's visits). Each page reads one period: the last 7, 30 or 90 days.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the owner, I want every account in one list with when it signed up, when it was last active and how much it uses the product, so I can see who gets going and who drops off.
- As the owner, I want one person's page with their workspaces and what they did in each, so I can understand one customer before I write to them.
- As the owner, I want the app's daily numbers (sign ups, active people, records, bookings), so I can see whether the product grows.
- As the owner, I want every booking page's views, visitors and bookings, together and one page at a time, so I can see which pages convert.
- As the owner, I want the marketing site's visitors, pages, sources and countries, without a third party tracker.
- As a customer, I want nothing I wrote (records, notes, answers, my guests' details) shown to the operator, and nothing personal about my visitors kept.

**Acceptance criteria** (numbered after spec 0043's last, AC-1616):

*Who is a super admin*
- **AC-1617**: `OPERATOR_EMAILS` (the api's environment, a comma separated list of emails, optional) names the super admins. Unset or empty, nobody is one. Only a signed in session whose user's email is on the list and verified counts; workspace roles never do.
- **AC-1618**: Every `operator.*` procedure answers `NOT_FOUND` to anyone else, signed in or not (signed out answers `UNAUTHENTICATED` first, like every session procedure). A listed person without two factor on is refused `TWO_FACTOR_REQUIRED`; a listed person whose session last proved itself more than 12 hours ago is refused `SIGN_IN_AGAIN`.
- **AC-1619**: `me.get` answers `isOperator: true` for a listed, verified person (false otherwise). It decides only whether the account menu shows "Super admin"; access is decided again by every `operator.*` call.
- **AC-1620**: Every `operator.*` call writes one row to `auth.operator_event` (the operator's user id, the procedure, its target id when it has one, the period, the request id, the time) before it reads anything. If the row can't be written, the call fails and reads nothing.

*What leaves the database*
- **AC-1621**: Tenant data reaches the console only through six security definer functions owned by `crm_operator`, a role that can't log in, holds column grants on the few columns it counts, and bypasses row level security only inside them. They answer counts, ids, workspace names and slugs, member roles and booking page titles, kinds and states. They never read a value, note body, task text, form answer, booking visitor, email or any other content column (the grants make it impossible, and a test proves it).
- **AC-1622**: The guard tests list the six new definers with their owner and hardening (fixed `search_path`, standard SQL bodies), and prove `crm_operator` can't read a column it wasn't granted.
- **AC-1623**: The users list and a person's page show the account's name, email, sign in methods, two factor, sign up time, last active time and active days. They never show addresses, user agents, session tokens or security event details.

*Usage the console counts*
- **AC-1624**: A signed in person's use is kept per day in `auth.activity_day` (user, UTC day, first and last time seen): written from `requireSession` at most once per person every 10 minutes per api process, never awaited by the request, and a failure is logged and dropped. Background token renewals don't count.
- **AC-1625**: A booking page view is counted when its page loads for someone who isn't one of its hosts (the `viewer` read, which the page makes once per load). It is kept in `booking_page_views` (tenant, forced row level security, the standard policy), one row per page, UTC day and visitor, with a view count. The editor's preview never counts.
- **AC-1626**: A visitor is an HMAC of the day, the address and the user agent under a key derived from the server's secret, cut to 32 hex characters. The address and the user agent themselves are never stored. The same browser on the next day is a new visitor, on purpose.
- **AC-1627**: The marketing site sends one beacon per page shown (first load and each in site navigation) to `POST /api/public/site/hit`: the path (no query), the referrer's host when it is another site, and `utm_source` when present. The api keeps it in `auth.site_visit` with the site's host, the country from the edge, the device class (mobile, tablet or desktop from the user agent) and the visitor (AC-1626). Known bots and automation are dropped, 60 hits a minute per address are kept, and a hit from an origin not on `SITE_ORIGINS` is refused `FORBIDDEN_ORIGIN`. The built site posts to the app's own api (`VITE_SITE_HIT_URL` overrides the address; the dev server and a browser under automation send nothing), allowed by its CSP's `connect-src`. No cookie, no local storage and no third party.
- **AC-1628**: Visits, activity days and operator events older than a year go with the identity sweep; booking page views older than a year go with the daily cleanup.

*The screens*
- **AC-1629**: **Overview**: people (total, new in the period), active people (today, 7 days, 30 days), workspaces (total, new), records, bookings and form submissions made in the period, each with the period before it as its comparison; and the daily bars of sign ups, active people, records and bookings.
- **AC-1630**: **Users**: one row per account, newest first, 50 a page with "Show more", searchable by name or email: the person, sign up date, last active, active days in the period, workspaces, records made, bookings hosted and booking pages. A row opens the person's page: their facts, daily active bars, and each workspace they're in with their role and what they made there in the period.
- **AC-1631**: **Booking pages**: the period's views, visitors, bookings and conversion (bookings per visitor) for all pages together, their daily bars, and a table of every page (title, workspace, owner, kind, state, views, visitors, bookings, cancelled, conversion), most viewed first. A row opens the page's own daily bars and figures.
- **AC-1632**: **Website**: visitors, page views and views per visitor, with daily bars, and the top pages, referrers, sources, countries and devices.
- **AC-1633**: Each page has loading, empty and failed states, a period switch kept in the address (`?period=30d`), full width, keyboard reachable, and reads in light and dark at 1280 and 390 wide. A refusal of two factor or of an old sign in says what to do, in plain words, with a link to Account › Sign in and devices.

## Decision

**Chosen option**: an allowlist in the environment, definer functions over the tenant tables, and our own counting in Postgres (Option 1 in the rationale). No new vendor.

- **Who**: `OPERATOR_EMAILS`, checked against the session's verified email, plus two factor and a sign in within 12 hours. Failing closed: unset means nobody.
- **How the console crosses workspaces**: six definers owned by `crm_operator` (`bypassrls`, `nologin`, `noinherit`, column grants only), callable by `crm_app`, called only from the operator module (a test fails if anything else calls them).
- **Global data** (activity days, site visits, operator events) lives in schema `auth`, which the identity login already owns as the app's global store.
- **Where analytics come from**: the api writes every number itself. Website analytics come from the marketing site's own beacon to our api, app analytics from the session check and the tables the product already writes, booking analytics from the page's viewer read and the bookings table. PostHog and Sentry are unchanged; nothing new is sent to either.
- **Cost**: every figure is computed per request from indexed reads. One operator, a few reads a day: fine today. Rollups move to a job when the load harness says so (#41).

## Feature design

**Data model** (migration `0092_operator_console`):

| Object | Schema | Key | Notes |
|---|---|---|---|
| `activity_day` | `auth` | (`user_id`, `day`) | `first_at`, `last_at`; on delete of the user, cascade. Index (`day`). |
| `site_visit` | `auth` | `id` (uuidv7) | `at`, `site`, `path` (1 to 200), `referrer` (host, ≤ 120), `source` (≤ 60), `country` (2 letters), `device` (`mobile`, `tablet`, `desktop`), `visitor` (32 hex). Index (`at`). |
| `operator_event` | `auth` | `id` (uuidv7) | `at`, `user_id` (no foreign key: the log outlives the account), `action`, `target`, `period`, `request_id`. Index (`at`). |
| `booking_page_views` | `public` | (`workspace_id`, `page_id`, `day`, `visitor`) | `views`, `first_at`, `last_at`; foreign key to the page, on delete cascade. Forced row level security, the standard policy. |
| role `crm_operator` | | | `nologin bypassrls noinherit`; select on listed columns of `workspaces`, `members`, `records`, `notes`, `tasks`, `booking_pages`, `bookings`, `booking_page_views`, `forms`, `form_submissions`. |

**Definers** (all `stable`, `security definer`, `search_path = pg_catalog, pg_temp`, standard SQL bodies, owned by `crm_operator`, execute granted to `crm_app` only):

| Function | Answers |
|---|---|
| `crm_operator_workspaces(ids uuid[], since timestamptz)` | Per workspace: name, slug, created and deleted times, active members, live records, and records, bookings and submissions made since `since`. |
| `crm_operator_members(users uuid[], since timestamptz)` | Per member row of those users: workspace, role, state, and records, notes and tasks made, bookings hosted since `since`, live booking pages owned. |
| `crm_operator_totals(since timestamptz, until timestamptz)` | Workspaces made, records, bookings and submissions made in the range, and live workspaces. |
| `crm_operator_daily(since timestamptz, until timestamptz)` | Per UTC day: workspaces, records, bookings and submissions made. |
| `crm_operator_pages(since timestamptz, until timestamptz, page uuid)` | Per booking page not deleted (one page when `page` is set): workspace, title, kind, state, owner's user id, views, visitors, bookings, cancelled. |
| `crm_operator_page_days(since timestamptz, until timestamptz, page uuid)` | Per UTC day, for one page or (null) all: views, visitors, bookings, cancelled. |

**API surface**:

| Procedure / route | Input | Output | Auth |
|---|---|---|---|
| `operator.overview` | `period` | `OperatorOverview` | operator (AC-1617 to AC-1620) |
| `operator.users` | `period`, `q?`, `after?` | `OperatorUserPage` | operator |
| `operator.user` | `userId`, `period` | `OperatorUserDetail` | operator |
| `operator.pages` | `period` | `OperatorPages` | operator |
| `operator.page` | `pageId`, `period` | `OperatorPageDetail` | operator |
| `operator.site` | `period` | `OperatorSite` | operator |
| `me.get` (exists) | | adds `isOperator` | session |
| `POST /api/public/site/hit` | `{ path, referrer?, source? }` as text | 204 | public, `SITE_ORIGINS`, 60 a minute per address |

**Environment**: `OPERATOR_EMAILS` and `SITE_ORIGINS` (api, optional), `VITE_SITE_HIT_URL` (marketing site build, optional, an override).

**Screens**: under `/w/$slug/settings/admin`: Overview, `users`, `users/$userId`, `booking-pages`, `booking-pages/$pageId` and `website`, each `?period=7d|30d|90d` (30d by default). The workspace in the address only places the pages in the app's frame; access never depends on it.

**Implementation skills**: house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`, `crm-design-system`; `drizzle`, `zod`, `vitest`, `security-and-hardening`, `dataviz`.

## Later slices (not this one)

Support access with the owner's grant, plan changes and suspension (#39's rest), recent errors per workspace (Sentry's `workspace_id` tag), and an operator log screen.
