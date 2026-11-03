# car/0063-forms — CI repair notes

Three jobs were red (`check`, `core`, `tests`) on run 41529755910. All of it was
assembly: five lanes added services, procedures and an email, and none of them
reached the central registries.

## 1. `packages/core/src/access/table.test.ts` (3 tests)

Real list of unlisted exports (from the run, not from the summary): `createFormFromTemplate`,
`listFormTemplates`, `formTemplate`, `offeredFormTemplates`, `templateDocument`.
The partials and beacon services (`savePartial`, `resumePartial`, `sendResumeLink`,
`countFormEvent`) were already in the table with `publicForm: true`, and so was
`formAnalytics`; the summary's list was wider than the real one.

- `createFormFromTemplate` -> `ACCESS_TABLE` as `{ permission: 'forms.manage' }`.
  It creates a form, so it sits with every other form write.
- `listFormTemplates`, `formTemplate`, `offeredFormTemplates`, `templateDocument`
  -> `NO_SCOPE`. They take no scope at all: the catalog is code, the same on every
  workspace, and they read no database. `NO_SCOPE` is how every other code-only
  read is declared.
- `formAnalytics` needed a `DATA_CASES` case (the second registry the walk keeps,
  one case per `{ data: ... }` entry): `refused('NOT_FOUND', ...)`, matching
  `getForm`, because the service answers through the same `canSeeForm` check.

## 2. `apps/api/src/writes.test.ts`

Three new contract procedures were classified as neither read nor write:
`forms.analytics`, `forms.templates`, `forms.createFromTemplate`.

- `forms.analytics`, `forms.templates` -> `READS`. Analytics is four grouped counts
  over `form_visits`; the gallery is the code catalog and touches no table.
- `forms.createFromTemplate` -> `WRITES`, with a case, and no `WRITES_MADE` entry
  (one write). Like `forms.create` it stores no outbox row of its own.

## 3. `apps/api/src/jobs/email-mailpit.test.ts`

NOT a registry gap. `form_resume` was wired into `QUEUED_EMAIL_KINDS`, `EMAIL_PARAMS`
and `CATALOG` correctly. The email could never be sent, for two separate reasons,
both new in this lane (neither is on `car/visual`, which has no `form_resume`):

1. `FormResumeEmail.resumeUrl` was a full `z.url()`, and the catalog sample used
   `https://example.com/...`. Every email link goes through `onAppOrigin`, which
   refuses any address that is not on the app's own origin ("An email link must be
   an address on the app origin."), so the render threw for every render of the
   sample. Fixed by making the param `resumePath: AppPath`, with the template
   joining it to the app origin through `context.link` — which is what every other
   queued email in `CATALOG` already does, and the only shape a static sample can
   have. The guard in `links.ts` is untouched.
2. `sendResumeLink` keyed the email with `day: '2026-11-03'`. `emailKey`'s `Id`
   accepts a uuid, 1-16 digits, or one of four words — so the key threw a ZodError
   and the whole service failed. Nothing tests `sendResumeLink` anywhere, so this
   was invisible. Fixed by passing the UTC day as `YYYYMMDD`.

`publicOrigin` is now dead input to `sendResumeLink`, so it was dropped from the
service and from its one caller in `apps/api/src/forms/progress.ts`. `FORMS_PUBLIC_ORIGIN`
is unset in production (runbook: "empty, unless Railway had one") and the app serves
`/f/:key`, so the link lands in the same place as before.

## 4. `SLUG_TAKEN` and `connect ECONNREFUSED 127.0.0.1:1`

Neither is a failure. `127.0.0.1:1` is the deliberate unreachable address in
`apps/api/src/testing.ts`, `apps/api/test/traced-api.ts` and the realtime tests,
used by tests that prove a dead endpoint is handled. `SLUG_TAKEN` is the refusal
`rpc.test.ts`, `monitoring/events.test.ts` and `modules/relationships.test.ts`
assert on. Both are log noise from passing tests.

## 5. The `check` job also failed on formatting (not in the summary)

`pnpm check` runs the Prettier check, and six files on the branch were unformatted
before I touched anything: `apps/api/src/forms/progress.ts`,
`packages/contracts/src/forms/partials.ts`, `packages/contracts/src/forms/public.ts`,
`packages/core/src/forms/progress.test.ts`, `packages/core/src/forms/visits.ts` and
`packages/core/src/jobs/kinds/maintenance-daily.ts`. All six are this car's lane
work (`maintenance-daily.ts` is the visit retention sweep, `oldFormVisits`). Every
diff is wrapping or a blank line: written with `prettier --write`, nothing else.
