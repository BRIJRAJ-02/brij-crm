# 0047. Rationale: how the console reads across workspaces, and where the numbers come from

## The ask

"I need a super admin list to see all the users and analytics around each user's usage. Website analytics. Dashboard analytics. All booking pages consolidated and individual analytics." (the owner, 23 Oct 2026, ask A130). The coordinator's landing notes: the access decision goes in the spec first, a narrow read only path returning counts, an audit row per view, nothing personal beyond what the screen needs, the analytics sources named, no new vendor outside its wrapper.

## Who is a super admin

| | An env allowlist of emails | A flag on the user row | A workspace role |
|---|---|---|---|
| Fails closed | yes, unset is nobody | yes, false by default | no, roles are per workspace |
| Can be granted from the app | no | yes, which is the risk | yes |
| Setup | one variable | a migration plus a way to set it | none |

The allowlist wins: nobody can make themselves an operator through the app, and it needs nothing in the database. It is checked against the session's verified email, so an unverified sign up with the owner's address can't pass. Two factor and a sign in within 12 hours narrow a stolen cookie: the console sees every customer, so it asks more than a workspace does.

## How the console crosses workspaces

Every tenant table forces row level security, and `crm_app` can't bypass it (the api refuses to start as a role that can). Three ways through:

1. **A separate operator login with `bypassrls`.** A second connection string to set, a role that could read everything a query names, and the api's own boot check would have to allow it.
2. **One `withWorkspace()` per workspace.** Correct under the policies, but N transactions per screen, and booking page totals across every workspace become a loop in the api.
3. **Definer functions owned by a narrow role** (chosen). The pattern the repo already uses for the cleanup's workspace list (`crm_sweep`) and the public lookups. `crm_operator` gets select on the exact columns it counts, so even a mistake in a function body can't read a value or a note: Postgres refuses the column. The functions return aggregates and ids only.

`crm_app` can execute them, as it can the other definers; what keeps them to the console is the api (only the operator module calls them, a test walks the sources) and what they return (counts).

## Where the numbers come from

- **App usage**: the tables the product already writes (records, notes, tasks, bookings, submissions, their `created_at` and creator), plus one new fact the database didn't have: which days a person used the app. Session `updated_at` moves only when Better Auth extends a session (once a day), so it can't answer "active in the last 7 days" well. `auth.activity_day` is written from the session check, throttled per process, so it costs at most one upsert per person per 10 minutes.
- **Booking pages**: bookings already exist; views didn't. Counting on the `viewer` read means one count per page load, and that read already knows whether the viewer is a host, so the owner testing their own page doesn't inflate it. The page itself (frozen, 20 Oct) doesn't change.
- **Website**: the marketing site had no analytics at all (its privacy page names Google Analytics and Clarity, which aren't installed; flagged to the marketing chat). A first party beacon to our own api keeps the promise of spec 0010 (nothing personal to third parties) and needs no cookie banner. The visitor id is a daily HMAC, as Plausible does, so a visitor can't be followed across days.
- **PostHog** stays the closed catalog of milestones from the api; the browser still never contacts it. Sentry is unchanged.

## Why per request, not rollups

One person reads the console a few times a day. Every count is an index range (records by `workspace_id, created_at`, bookings by page, views by page and day). At the scale budget (a million records in a workspace) a full live count is about one index only scan per workspace; when that hurts, the daily cleanup can write rollups and the functions read them instead, with the same answers.
