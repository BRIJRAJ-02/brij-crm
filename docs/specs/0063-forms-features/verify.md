# 0063 verify: Forms features

How `/check verify` proves each criterion on the real app. Screenshots are taken in light and dark, inside the real layout, with a popover or menu open where one exists, on a phone width and a desktop width. The agent that verifies looks at every screenshot itself before a slice lands. Heavy suites run on CI, never on the laptop.

## Shared checks

- **Quality (AC-6301)**: the spec 0058 alignment probe and motion check run on every new screen, popup and visitor view: the layout tiles, step dividers, Jumps row, Flow view, Analytics tab, template gallery, each new question control, the save and resume line, and each ending.
- **Contracts**: unit tests in `packages/contracts/src/forms/` for `pathOf`, `scoreOf`, `recall`, every new answer type in `checkAnswers`, `FILES_ONTO`, and every new publish refusal.
- **Server**: integration tests against a real Postgres in `packages/core/src/forms/` and `apps/api/src/forms/` (never a mocked database).

## Per criterion

| AC | How it is checked |
|---|---|
| AC-6302 | Browser test: the Layout tiles switch the preview; publishing keeps the layout on the version; a visitor on the old version keeps their layout. |
| AC-6303 | Browser test: add, title, drag and remove a step divider; questions merge into the step above; Classic shows the quiet note. |
| AC-6304 | Browser test on the hosted page: "Step 2 of 3", Continue blocked by an empty required answer with the summary, Back keeps answers, focus moves and the place is announced (accessibility tree snapshot). |
| AC-6305 | Browser test: Enter continues, Shift and Enter adds a line in long text, a single choice moves on by itself, reduced motion emulated makes it instant, "2 of 7" is read. |
| AC-6306 | Network log: a Classic form loads no step chunk; a Steps form loads it once; the loading shape matches the layout (screenshot before and after the form arrives). |
| AC-6307 | Contract tests per type; a server test files each type onto each allowed attribute type and refuses the rest; a browser story per control. |
| AC-6308 | Keyboard run of every new control; screen reader names from the accessibility tree; Ranking reordered by arrow keys; Signature completed by typing a name; axe clean. |
| AC-6309 | Hosted page test: `?email=ada@acme.com&plan=unknown&utm_campaign=x` fills email, ignores plan, fills a hidden question; Install shows the Prefill link helper with every key. |
| AC-6310 | Contract tests: 51 questions, two File questions or two Signature questions are refused with one sentence each. Other's text is on the submission and not on the record. |
| AC-6311 | Browser test: the booking page Questions tab (spec 0057) does not list the new types. |
| AC-6312 | Contract and hosted page tests: a step whose questions are all hidden is skipped and not counted. |
| AC-6313 | Hosted page test: a jump to a later step and a jump to an ending; publish refuses a backward jump. |
| AC-6314 | Server test: a forged post with answers to skipped questions is accepted with them dropped; a required question off the path is not demanded. |
| AC-6315 | Hosted page tests: each ending shows its heading, line and button; a routing rule naming an ending shows it. |
| AC-6316 | Server test: points sum to the score, the score files onto the chosen number attribute, a forged score is ignored; a rule `score is more than 7` routes. |
| AC-6317 | Hosted page test: `{{name}}` shows the typed name as text and `<b>` stays literal; publish refuses a recall of a later question. |
| AC-6318 | Server test with Mailpit: one email per accepted submission, hidden answers left out, signature shown as "Signed", reply to the owner; none for spam or held. |
| AC-6319 | End to end on CI: save on Continue, Finish later, the resume link restores answers and step, the email arrives in Mailpit, the partial is gone after submit; a 31 day old partial is removed by the cleanup; nothing appears in Submissions or the CRM. |
| AC-6320 | Server test: a run of beacons gives the expected totals; the rows hold no address or cookie, only the 32 character daily hash. |
| AC-6321 | Browser test with seeded visits: four numbers with the period change, the daily chart, drop off bars in form order, the by source table, range switch, the empty state. |
| AC-6322 | Browser test: question cards show reached and answered chips when analytics exist and nothing when they don't. |
| AC-6323 | Browser test: New form opens the gallery with Blank first and twelve picture tiles; a template makes a draft whose questions file onto the standard attributes. |
| AC-6324 | Unit test: every template parses as a `FormDocument`; an integration test publishes each on a fresh workspace. |
| AC-6325 | Browser test: Show when on a card, Jumps on a divider, points beside each choice; the Flow view draws steps, arrows and endings and each part links back. |
| AC-6326 | Contract tests: each refusal's sentence; the publish dialog shows it. |
| AC-6327 | Browser test once spec 0060 lands: Brand applies accent, logo and font pack on the hosted page; the contrast guard refuses an unreadable pair; the hosted page's Content Security Policy is unchanged. |
| AC-6328 | Screenshot check: the Timefix footer under every layout and in an embed, aligned. |
| AC-6329 | The guard tests list `form_partials` and `form_visits`; a cross workspace read returns nothing. |
| AC-6330 | Server tests: a partial or event without a valid fill ticket, with the honeypot filled, or over the rate limit is refused or dropped; a resume link holds only the token. |
| AC-6331 | `pnpm size` on CI: the Classic form under 223 kB JavaScript and 17 kB CSS; each lazy chunk under its own line. |
| AC-6332 | Review: the two stale lines now match the budget. |

## Before landing a slice

1. Skill pass: `crm-design-system`, `crm-frontend-state`, `crm-data-model-access`, `crm-api-backend`, `interaction-design`, `emil-design-eng`.
2. Reviewers: `design-system-guardian` and `ux-interaction-reviewer` for screens, `security-access-reviewer` for the server and tables, `state-performance-reviewer` for analytics queries and the hosted page budget.
3. Alignment probe, motion check and screenshots in light and dark.
4. Heavy suites on CI through the lane push script.
