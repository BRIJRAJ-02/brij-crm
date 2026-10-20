# Owner steps (kept current from 20 October 2026)

Everything here needs you: an account, a secret, a decision or a push. The builders can't do these. Tick each one off as you go.

## Now

- [ ] **Push each green batch to production.** When a batch is green in CI on `feat/landing-ready`, fast forward `main` to it. The auto mode check refuses production deploys from the agent side.
- [ ] **Answer the spam checker's 8 questions.** Each has a recommended answer, and the defaults are in use until you say otherwise. They are in spec 0023's Follow-up.
  1. No timing goes to Needs review, not Spam.
  2. Too many sends from one email counts as a spam sign, not a block.
  3. The score bands stay (review from 3, spam from 6).
  4. Adopt a maintained list of disposable email domains (a new package).
  5. The resolve action takes a union, so a record pick can be added later.
  6. Its signing keys come from `FORMS_IP_SALT`.
  7. Booking gets the timing check only.
  8. Spam settings go under Settings › Scheduling.
- [ ] **Approve a one line house rule update.** `.claude/skills/crm-design-system/SKILL.md` still says the theme switch sits in the sidebar footer. It moved to Settings › Account › Preferences.
- [ ] **Decide what a purge does to a private task.** When a purged record was a task's only link, the task becomes visible to everyone. Recommended: it stays visible to its creator and assignee only. This came from the notes security review.

## Production settings, with the calendar sync merge

What production does today (Railway variables checked 20 October 2026, names only):
- **Calendar sync stays off** until you set the variables below. `CALENDAR_SYNC` isn't set on Railway, so pushing the sync code is safe: it simply won't run. It turns on when you add `CALENDAR_SYNC=on`, `CALENDAR_WEBHOOK_ORIGIN` and the Google settings.
- **Google sign in stays off**, because `GOOGLE_CLIENT_ID` isn't set. Email sign in works as before.
- **The spam checker needs nothing new.** `FORMS_IP_SALT` is already set in production.

What to set to turn them on:

- [ ] **On Railway, api and worker:** set `CALENDAR_WEBHOOK_ORIGIN=https://brij-crm-phi.vercel.app`, `CALENDAR_SYNC=on`, and the calendar token key.
- [ ] **In Google Cloud:**
  - Turn on the Calendar API.
  - Add the redirect URI `https://brij-crm-phi.vercel.app/api/calendar/google/callback`.
  - Keep the OAuth consent screen's scopes in line with what the app asks for.
- [ ] **For the Google sign in flow:** set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in production, if they aren't already.
- [ ] **Sign up:** it stays invite only. Keep `SIGNUP_ALLOWLIST` current until invites ship (spec 0031).

## Later, when the feature arrives

- [ ] **reCAPTCHA keys:** only if you want the optional captcha on forms.
- [ ] **Marketing site:** check that `https://timefix.ai` is the destination for every "Powered by Timefix" link and its UTM tags.
- [ ] **Microsoft Entra app registration and publisher verification:** for Outlook (spec 0024 milestone 4). You set this aside for now.
- [ ] **Paddle or Lemon Squeezy account:** for billing in release 2. You set this aside for now.
- [ ] **Google's security assessment:** for Gmail sync in release 3.
- [ ] **Legal pages, Sentry alerts and the restore rehearsal sign off:** release 2.

## Optional tidy up

- [ ] **Drop the leftover test role from the local shared Postgres:** `docker exec crm-postgres-1 psql -U postgres -d crm -c "drop role neon_superuser;"`. Tests no longer depend on it.
- [ ] **Look over the design system artifact after its next publish.** It will be republished after this batch.
