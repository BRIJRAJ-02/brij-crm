# 0058 rationale: Visual and short

## Context

An audit of the link page, booking links and forms (31 Oct 2026, branch `wip/team-day`) found the same problem three times. Setup screens explain with paragraphs, and the explaining popups are the longest: the rotation group popup has over 200 words and a 20 row table, the form publish popup is two steps with long sentences about matching and uniqueness, and the sync, time off, import and retarget popups each carry several hints. First run takes about six Continue clicks and ends on a Done step that shows only the link page address. Creating a booking page or a form drops you into an editor with no "here is your link" moment. The link page's kind picker and its presets are plain word lists. Empty states are text only, and the link page with no handle sends you to Profile.

The owner asked for screens that are visually good, aligned, easy to understand, world class, less texty, and with basic smooth interactions. The owner also said to decide the details by industry standard and start work, so the choices below were made without interviewing.

Constraints in force: `/b/:key` behaviour and all addresses are frozen (look and feel is allowed, 24 Oct), no new origins in the Content Security Policy, delete and remove actions confirm in a Modal (21 Oct), the design system rules (tokens only, library components first), lane branches never edit specs, and heavy suites run on CI.

## Options considered

### Option 1: Copy trim only

Shorten strings in place and leave layouts alone.

**Pros**:
- Smallest change, almost no risk.
- No new components.

**Cons**:
- Does not add the success moment, the visual pickers or the empty state illustrations.
- Alignment and motion stay uneven.
- The owner asked for visual, not only shorter.

### Option 2: Visual rewrite of the touched surfaces on shared library pieces, in parallel lanes

Add the few missing library variants first, then rework each surface (booking, forms, link page plus first run, visitor pages) in its own lane. Make alignment and motion explicit, checkable rules.

**Pros**:
- Delivers the visible improvement the owner described.
- Reuses one set of tiles, empty states and a Ready panel, so later phases cost less.
- Lanes own separate files, so they run in parallel without conflicts.

**Cons**:
- More work and more screenshot churn than Option 1.
- One new library module needs review.

### Option 3: Full redesign with themes, brand kit and new blocks at once

Do Phase 1 to 3 together.

**Pros**:
- One coherent result.

**Cons**:
- Too large to verify well. Several parts need owner calls (public by default, custom colours, brand on frozen pages).
- Conflicts with "ship less, ship quality".

## Rationale

Option 2 fits the ask and the constraints. The owner's words are about how things look and read, so a copy trim alone would miss the point, and a full redesign would run into decisions that are the owner's to make and into the frozen public behaviour. Splitting by surface gives each lane its own files, and putting the shared pieces first (Lane 0) avoids four lanes inventing four tile grids. The design system rule says reuse, then variant, then new, so most work is variants of `TileGrid`, `EmptyState` and `Modal`. Only `ReadyPanel` is new, because nothing today shows a link with Copy, Share, QR and a preview together.

Alignment and motion are written as rules with a probe, not as taste. That is what makes "everything aligned" something the verify step can fail. The motion set is deliberately small and taken from the tokens we already have, because smooth here means calm, short and interruptible, not clever.

Choices made without asking, by industry standard:
- Delete and remove confirms stay Modals, shortened (the owner's 21 Oct rule beats the common undo toast pattern).
- Auto matching on publish is shown as an editable table of chips, so a one click publish never hides what will happen.
- The inline handle field replaces the Profile dead end, because a user should never leave a flow to finish it.
- First run keeps all its steps, because removing Calendar and Invite conflicts with the 22 Oct onboarding decision. Only the Done step changes.
- The link page stays Private by default and the visitor controls on `/b/:key` stay as they are, because both change behaviour or privacy and need the owner.

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md` house rules and the `crm-design-system` skill
- Spec 0051 (link page), 0056 (link page per workspace), 0057 (booking page questions)
- `apps/web/src/features/booking/README.md`, `features/forms/README.md`, `features/link-page/README.md`, `public/booking/README.md`
- The 31 Oct 2026 audits of popups, flows, link page, booking and forms (this session)

**Practices & standards**:
- WCAG 2.2 AA for focus, contrast and target size
- Progressive disclosure for advanced settings
- Motion that animates only transform and opacity, with a reduced motion path
- Empty states with one primary action
