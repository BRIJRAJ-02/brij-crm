# 0036 · Sign in and first run

**Status**: Proposed
**Date**: 2026-10-21
**Feature**: Sign in (spec 0005) and the first run, owner request of 21 October 2026 ("I saw a better signup/signin flow. Can we create a better new one")
**Owns**: AC-1191 to AC-1220

## Brief

- **Purpose**: one way in for everyone, new or returning, and a first run that leaves a new person with a named workspace that already looks like theirs.
- **Main task**: Continue with Google, or type an email and the 6 digit code it gets; then say who you are, name the workspace, and connect a calendar if you like.
- **Leaves out**: passwords and a separate sign up page; the passkey and the second step (spec 0033 fills the room left for them); invitations and the "Invite your team" step (spec 0031 slice 2, after it lands); photo upload (file storage, #32); templates and "what will you use it for" questions.

## Summary

Today sign in is a plain card titled "Sign in" with the email field first and Google under Continue, the code is a separate page with small boxes, and the welcome page is one form with three fields. This spec makes the way in one quiet card that serves sign in and sign up alike, with Google first, and turns the first run into a short set of steps in a wide card split in two, as Attio does it: the step on the left, a live sketch of the new workspace on the right that changes as you type.

The server already decides between signing in and signing up (spec 0005): an existing account always gets a code, a new email gets one only while sign up is open to it, and Google makes an account the same way. Nothing about who may sign up changes here.

The references are Attio's onboarding (Mobbin flow 4373fd95, 21 screens: the split card with its "2/5" count and the live workspace sketch) and Linear's (Mobbin flow cbaf58a9: one centred column, "Check your email" and a code). The owner may still send their own reference; if one comes, the visuals adapt and this spec is amended.

## Flow

```
/sign-in ─ Continue with Google ─> Google ─> / ─┬─> first run (no workspace yet)
   │                                            └─> the workspace (or the ?redirect= deep link)
   └─ email ─> code sent ─> /verify (same card) ─ sixth digit ─> / (as above)

/welcome?step=about ─> ?step=workspace ─ Create workspace ─> ?step=calendar&workspace=<slug> ─> /w/<slug>
  (Skip)                (no Skip)                              (Skip for now; left out when calendar sync is off)
```

## Screens

**Sign in or sign up** (`/sign-in`). The Timefix wordmark, then one card 400 px wide at most:
- the title "Sign in or sign up";
- a refusal about the sign in as a whole, when there is one, as a danger callout;
- "Continue with Google", led by Google's own G (only where Google is set up);
- a quiet divider reading "or";
- the Email field ("name@company.com" as its placeholder), with room under it for spec 0033's "Sign in with a passkey";
- "Continue with email", the primary button. Without Google there is no divider and it reads "Continue".

**Check your email** (`/verify`). The same card in the same place: "Enter the code we sent to **ada@acme.com**.", six large single digit boxes, then "Resend code" and "Use a different email", with the resend wait under them.

**First run** (`/welcome`). One card about 920 px wide, split in two from 1024 px up: the step on the left (400 px), a sunken panel on the right holding a sketch of the app (a sidebar with the workspace's initials tile and name, a few skeleton rows, the person's avatar and name at its foot, and a table beside it) that bleeds off the card's edge. The part of the sketch the step is about is ringed. Below 1024 px the sketch hides and the card is the narrow one. Each step has, top to bottom: Back (an icon button, from the second step), "Step 2 of 3", its title and a line under it, its fields, its primary button, Skip where the step has one, and under a hairline "Signed in as ada@acme.com" with Sign out.
- **About you**: your initials in a round avatar that follows what you type, and "Your name".
- **Your workspace**: "Workspace name" and "Web address" after "/w/", checked as you type.
- **Connect your calendar**: "Connect Google Calendar" with Google Calendar's mark, "Connect Outlook" (off, coming soon) with Outlook's, and "Skip for now".

## Decisions

Each one is the coordinator's recommendation, owner to confirm.

1. **One entry screen for sign in and sign up**, titled "Sign in or sign up", with "Continue with Google" first, then a quiet "or" divider, then the email and "Continue with email". The server decides which it is, as today. The title avoids "Timefix", since the tab's title is the page's title followed by the product's name. *Coordinator's recommendation, owner to confirm.*
2. **A plain, kind refusal for an email that may not sign up**, said above the form and never on the field: "There’s no account for this email, and sign up isn’t open yet. Check the address." It reveals only what the allowlist already reveals (spec 0005). *Coordinator's recommendation, owner to confirm.*
3. **The code step on the same card**: the narrow card stays put (fixed from the top of the window, as AuthLayout already holds it), with six large single digit boxes, paste to fill and auto submit (no button), "Resend code" with its countdown and "Use a different email". The library already has CodeInput (one real field under the boxes, `autocomplete="one-time-code"`), so it gains a `size="lg"` variant rather than a new component. *Coordinator's recommendation, owner to confirm.*
4. **A narrower card** for every page before the app that isn't a first run step: 400 px (`size-panel`) instead of 520 px, as a `size="sm"` variant of Card's page placement. One email field and two buttons read sparse at 520 px. *Coordinator's recommendation, owner to confirm.*
5. **First run as Attio does it**: a split card with a live preview of the workspace. Steps: About you (name; the photo is your initials until file storage arrives), Your workspace (name and address, the address checked as you type), Connect your calendar (Google; Outlook shown off until spec 0024 milestone 4; skippable; left out where calendar sync is off). Step progress reads "Step 2 of 3". Back works, keeping what was typed. Every step but Your workspace can be skipped. "Invite your team" joins after members slice 2 lands, before the calendar. *Coordinator's recommendation, owner to confirm.*
6. **Back stops at the workspace**: once Create workspace has made it, the steps before it are done and the next step offers no Back. Going back would mean renaming the workspace, which belongs to workspace settings. *Coordinator's recommendation, owner to confirm.*
7. **A skipped About you still names you**: a member is never nameless, so with no name and no Google name, the first part of the email becomes the name ("ada.lovelace@acme.com" gives "Ada Lovelace"). It can be changed in Settings › Profile (spec 0031 slice 7). *Coordinator's recommendation, owner to confirm.*
8. **Sign out asks first** (owner rule of 21 October 2026, anything that ends something asks in a confirm box): the first run's Sign out opens a plain Modal, "Sign out?", "You’ll need to sign in again on this device.", Cancel (ESC) first and a primary "Sign out" last. Going back a step in sign in ("Use a different email") stays one click. *Owner rule.*
9. **Redirects**: the first sign in lands on first run; later ones open the first workspace, or the `?redirect=` deep link, as today. When members slice 1 lands, the last used workspace (`last_workspace_id`) replaces the first. *Coordinator's recommendation, owner to confirm.*
10. **Layout**: quiet, dense and neutral in the design system's Attio blue direction, light and dark, at 390 and 1280. Keyboard first: focus starts in the first field and Enter submits. Plain words, with no dash punctuation. *Coordinator's recommendation, owner to confirm.*

## Requirements

*The entry*
- **AC-1191**: `/sign-in` shows the Timefix wordmark, then one card titled "Sign in or sign up", at most 400 px wide and 16 px from each edge on a phone. In the card, in order: "Continue with Google" with Google's own G (only where Google is set up), a divider reading "or", the Email field, and "Continue with email". Without Google there is neither the button nor the divider, and the submit reads "Continue".
- **AC-1192**: Focus starts in the Email field and Enter in it sends the code. Tab goes in page order: Continue with Google, Email, Continue with email.
- **AC-1193**: The server decides between sign in and sign up exactly as spec 0005 says: an existing account always gets a code; a new email the allowlist admits gets a code, and an account once the code checks; a new email it doesn't admit is refused before any email goes out with "There’s no account for this email, and sign up isn’t open yet. Check the address." No other answer differs by whether an account exists.
- **AC-1194**: A refusal about the sign in as a whole (sign up closed, too many codes with the real wait, a refused or cancelled Google sign in, a session that ended) shows at the top of the card as a danger callout, announced. Only an address that isn't one marks the Email field.
- **AC-1195**: Under the Email field the card holds a slot for spec 0033's "Sign in with a passkey" (SignInForm's `afterEmail`), empty until that spec fills it.

*The code*
- **AC-1196**: "Continue with email" moves to `/verify` in the same card (same width, same place, the wordmark unmoved): "Check your email", "Enter the code we sent to **{email}**.", then six single digit boxes at least 40 px tall, with focus in them.
- **AC-1197**: Typing or pasting fills the boxes: a pasted code with spaces or a dash fills all six, and so does the phone's code suggestion (`autocomplete="one-time-code"`). The sixth digit sends the code with no press. Backspace removes the last digit.
- **AC-1198**: A wrong code says "That code isn’t right. Try again, or send a new one." under the boxes (just "Try again." while no new code can be sent), clears them and keeps focus there. An expired code ("That code has expired. Send a new one.") and a code tried 5 times ("Too many wrong tries for this code. Send a new one.") turn the boxes off until a new code is sent. 15 tries in an hour or 40 in a day for one email say "Too many sign in tries for this email. Try again in {wait}." (spec 0005's limits, unchanged.)
- **AC-1199**: "Resend code" waits 60 seconds after each send, saying "You can resend the code in 42 seconds." under it (whole minutes past a minute). A refused resend says why under it and never says a new code was sent; a sent one clears the boxes, moves focus to them and announces "New code sent".
- **AC-1200**: "Use a different email" goes back to `/sign-in` with the address in the field, in one click.

*Google and where you land*
- **AC-1201**: "Continue with Google" says "Opening Google" while the browser leaves, and is itself again after the browser's back button. A new Google account lands on first run with Google's name in "Your name"; a returning one opens their workspace; a deep link survives the round trip.
- **AC-1202**: After the first sign in (no workspace yet) the person lands on first run. Later sign ins open the first workspace, or the `?redirect=` deep link, as today (the last used workspace once members slice 1 lands).

*First run*
- **AC-1203**: First run is one card split in two from 1024 px up: the step on the left, 400 px wide, and the live preview on the right. Below 1024 px the preview is hidden and the card is the narrow one. The preview is decoration, hidden from assistive technology.
- **AC-1204**: Each step shows "Step N of M" above its title. The steps are About you, Your workspace and Connect your calendar. Where calendar sync is off (`CALENDAR_SYNC` isn't `on`), Connect your calendar is left out and M is 2.
- **AC-1205**: About you: "Your name" (Google's name, or empty), focused, beside a round avatar with your initials that follows what you type; the preview shows the same avatar and name at its sidebar's foot, ringed. Continue moves on (with nothing typed it says "Enter your name, or skip this step."); Skip moves on without a name.
- **AC-1206**: Your workspace: "Workspace name" follows your name as "Ada’s workspace" until edited, and "Web address" after "/w/" follows the workspace name until edited (lowercase, spaces as dashes). The preview's sidebar head shows the workspace's initials tile and name as you type, ringed.
- **AC-1207**: The web address is checked 300 ms after the last key: "Checking…" while it asks, then "That address is free." or, on the field, "That address is taken. Try another." An address that breaks the rule says how to fix it without asking. Create workspace still has the last word (`SLUG_TAKEN` on the field), and sends the same workspace id on every try.
- **AC-1208**: Connect your calendar: "Connect Google Calendar" (Google Calendar's mark) leaves for Google and comes back to this step saying what happened: connected ("Google Calendar is connected.", with Continue), declined, a permission unticked, the limit reached, or a failure, each in plain words with Connect again. "Connect Outlook" (Outlook's mark) is off, with "Outlook is coming soon." under it. "Skip for now" finishes.
- **AC-1209**: Back (an icon button named "Back", from the second step on) returns to the previous step with what was typed kept, and so does the browser's back button. Once the workspace exists, the steps before it count as done and the calendar step has no Back.
- **AC-1210**: What was typed survives a reload of the tab (this tab's sessionStorage, for the signed in person only), including the minted workspace id, so a retry after a lost answer never makes two workspaces. Finishing, or making the workspace, clears it.
- **AC-1211**: A skipped About you with no name, and no name from Google, names you from your email: its part before the @, split at dots, dashes and underscores, each word capitalised ("ada.lovelace" gives "Ada Lovelace").
- **AC-1212**: Each step works by keyboard alone: focus starts in its first field (on the calendar step, its first enabled button), Enter submits, and Back, Skip and Sign out are reachable by Tab.
- **AC-1213**: Under a hairline the card says "Signed in as {email}" with Sign out. Sign out first asks in a plain Modal: "Sign out?", "You’ll need to sign in again on this device.", Cancel (ESC) first, a primary "Sign out" last. Cancel changes nothing; Sign out signs out once and lands on `/sign-in`.
- **AC-1214**: Finishing (Continue after connecting, or Skip for now; or Create workspace when the calendar step is left out) opens the workspace's People page with focus on its title.

*Server*
- **AC-1215**: `workspaces.slugAvailable({ slug })` answers `{ available }` to a signed in person with a verified email: false when any workspace has ever used the address (the directory, which never frees one), true otherwise; an address that breaks the rule is refused `INPUT_INVALID`. Each person gets 60 checks a minute, then `RATE_LIMITED` with `Retry-After`. It is on the bootstrap list and reads nothing but the directory.
- **AC-1216**: `system.status` answers `calendarSync`: true where calendar sync is set up (`CALENDAR_SYNC=on`).
- **AC-1217**: Connecting a calendar takes `then=welcome` (the only value it knows), carried inside the signed state; the callback then sends the member to `/welcome?step=calendar&workspace=<slug>&calendar=<result>`, and to Settings › Calendar as today otherwise. Nothing else in the round trip changes.

*Everywhere*
- **AC-1218**: Tokens only and library components only; light and dark; 390 and 1280 wide; field edges are `field-border` (#eaeaea in light); nothing shrinks when pressed; no dash punctuation in any copy. axe finds no WCAG A or AA violation on any of these screens in either theme.
- **AC-1219**: First load JavaScript grows by at most 3 kB gzipped (budget 250 kB).
- **AC-1220**: Room is kept for what comes next: spec 0033's second step gets `/sign-in/two-factor` in the same narrow card with the same code boxes (`safeRedirect` already refuses every `/sign-in/…` path), and after members slice 2 the invite landing at `/invite/:token` takes this card (the inviter and the workspace named, the email locked to the invitation) and first run gains "Invite your team".

## Library changes

Each follows the design system's rule 5 (reuse, then a variant, then a new component), and each README says why.

- **Card**: `size="sm"` for the page placement (`size-panel`, 400 px). `aside` for the page placement: a panel beside the card's content, from `bp-page-compact` up, hidden from assistive technology (first run's preview). `eyebrow`: a line above the title (first run's Back and step count).
- **CodeInput**: `size="lg"`, boxes that share the row and stand `size-input` plus `space-16` tall, split three and three.
- **Separator**: `label`, a word between two hairlines ("or").
- **Steps**: `variant="count"`, "Step 2 of 3" as one quiet line.
- **SignInForm**: Google first, the divider, the email, "Continue with email"; the notice above them; `afterEmail` for the passkey.
- **VerifyEmail**: "Resend code", "Use a different email", the code size, the new copy.
- **AuthLayout**: the narrow card by default; `preview` (the split card), `eyebrow`.
- **WorkspacePreview** (new module): the sketch of the app first run shows. Nothing in the library draws a miniature of the app: the real Sidebar brings links, a landmark, a menu and its own data, and quieting it into skeleton rows would add a preview mode to the most used module in the app. So it is a new, decorative module drawn from Avatar, Skeleton and Icon.

## Build plan

**Milestone 1: the entry, the code and Google**
1. Library: Card `size="sm"`, Separator `label`, CodeInput `size="lg"`, SignInForm's new order and `afterEmail`, VerifyEmail's copy; stories and READMEs for each state.
2. App: SignInScreen and VerifyScreen on them; copy in `strings.ts`; unit tests.
3. Flows: `sign-in.flow.ts`, `google.flow.ts` and the helpers other flows share, through the fake Google and Mailpit.

**Milestone 2: first run**
4. Server: `workspaces.slugAvailable` with its limit and tests; `system.status` `calendarSync`; the calendar connect `then=welcome`. Data layer: `workspaces.slugAvailable`.
5. Library: Card `aside` and `eyebrow`, Steps `count`, AuthLayout `preview`, WorkspacePreview with a story per state.
6. App: `/welcome?step=` with About you, Your workspace and Connect your calendar; Back; the draft in sessionStorage; Sign out's confirm; unit tests and the flow.

**Milestone 3: polish and every state**
7. Pending and failed states in the split card, the slug check's offline and limited answers, long names in the preview, reduced motion, 390 and 1280 in both themes, axe on every screen.
8. Reviews: security on the server changes, design system and UX on the screens.

## Consequences

- Every library screenshot of SignInForm, VerifyEmail, AuthLayout and CodeInput changes; the baselines are made again in the pinned Linux image when this lands.
- Flows that sign in through the old labels ("Continue", "Your name", "Create workspace" on one page) move to the new ones in one place (`e2e/people.ts` and `sign-in.flow.ts` helpers).
- One more bootstrap procedure (`workspaces.slugAvailable`) to keep on the door test's list, and one more value in the calendar connect state.
- A merge with members slice 1 has to carry its "create another workspace" mode (`/welcome?another=1`) onto the Your workspace step alone.

## Follow-up

- "Invite your team" and the invite landing (after spec 0031 slice 2).
- "Sign in with a passkey" and the second step page (spec 0033).
- A photo in About you once file storage lands (#32), and Google's picture once the profile carries it.
- A workspace name suggested from a work email's domain ("acme.com" gives "Acme").
