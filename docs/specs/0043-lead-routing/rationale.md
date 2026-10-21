# 0043. Lead routing: rationale

## The ask

21 October 2026, owner: smart round robin "by lead qualification and meeting type, trained, one format"; and the forms revision's Show when and routing (spec 0023, 0023-types-and-logic.md) were still unbuilt. The owner handed design calls to the coordinator, who decided the shape in [index.md](index.md)'s summary.

## Decisions and the options turned down

1. **One format, rules per surface.** Chosen: every form and every team page holds its own ordered rules in one shared shape. Runner up: spec 0037's single workspace routing setup in front of one team link. Per surface rules ship now on screens that already exist (a form's Settings, a page's editor), and the shape is the one 0037 uses, so a workspace setup can later hold the same rules.
2. **The fallback is the surface's own setting.** A form falls back to its **After someone sends it**, a team page to its whole rotation. Runner up: a separate Otherwise route. Keeping one place for "what happens normally" avoids two settings that can disagree.
3. **Forms read answers; pages read record fields.** A form's route is what the visitor sees next, so it depends only on what the visitor typed. Record fields (company size, country, industry) choose hosts on the team page, at the booking, under the rotation's lock. Runner up: record facts on forms too, which would let the visitor's next step reveal whether the CRM knows their email (the same leak spec 0037's review closed with host rules).
4. **Meeting type is the booking page.** Each booking page already is one meeting type (its length, location, questions). A rule that sends a lead to the 15 minute page has set the meeting type. Runner up: a meeting type list inside routing, which duplicates pages.
5. **Qualified is a tag on the decision.** It is stored with the decision and counted in the report. Runner up: writing it onto the person as an attribute, which needs a field the workspace may not have; a follow up can file it.
6. **"Trained" is a report, not a model.** Timefix built and then deleted lead scoring nobody configured, and kept a rule that the booking path stays deterministic (spec 0037, Two lessons). A per rule report of matched, booked and no show lets admins tune rules with evidence. Runner up: 0037's smart ranking, kept for later.
7. **Form rules live in the version document; page rules on the page.** A form's rules name its questions, which are versioned, so the rules publish with them, like After someone sends it. A page has no versions, so its rules save with the page. Decisions get their own table, with forced row level security, because the report reads them by surface and window.
8. **Show when hides and drops.** A hidden question is never required and its answer is not stored, on the page and on the server, through one pure function both run. Runner up: keep hidden answers, which stores what the visitor was told didn't matter.
9. **No show is marked by people.** Calendars don't say who attended. A host or booking admin marks it from the booking's menu, undoable and audited. Runner up: infer from the meeting link, which few providers report.

## Risks

- Round 7's hand off token now carries a decision id; an older token without one still books from the whole rotation.
- A rule naming hosts who later leave the rotation narrows to nobody; the booking then falls back to the whole rotation, and publish or save says so next time.
