# /check verify 0063 slices 1 and 2 · FAIL

Spec 0063 (forms features), slice 1 (Steps) and slice 2 (One at a time), at `0ead49c4c` on `wip/visual-formsx` (CI run 41168656593 green). Driven in the real app on 31 October 2026: api on 3360, worker on 3361, web on 5360, database `crm_vffin` (migrated fresh, dropped after), one headless Chromium. Held to spec 0058's bar too: alignment probe, motion check, axe in light and dark, keyboard.

**Verdict: must fixes. 6 of 9 criteria met. AC-6302, AC-6305 and AC-6306 are not met, and the phone editor clips its own header.** The core works well: steps, Show when on steps, the path on the page and the server, auto advance, the lazy chunk, the fallback and the publish refusals all behave. What fails is in the edges: a visitor caught mid fill by a publish, reduced motion, the first paint, and 390 px.

Next: run `/debug` (or `/develop`) on the four must fixes, then run this verify again.

## Must fix

1. **A visitor mid fill is refused without a word after the owner publishes again (AC-6302, AC-6314).** I opened `/f/verify-midfill` (Steps, v1), got past step 1, then published v2 with the layout set to Classic. The visitor finished on v1's Steps and pressed Send. The server checked the answers against v2, where the Big teams step's Show when no longer counts, and refused with `422 {"fields":{"seats":"Answer this question."}}`. Seats is on none of the visitor's steps, so `onRefused` finds no step to go back to, and the page shows nothing at all. Send just does nothing. Shot: `midfill-refused-desktop.png`. The cause is `submitForm` in `packages/core/src/forms/public.ts`, which always checks against `form.liveVersionId` and ignores the posted `versionNumber`. You could check against the version the visitor filled while it is recent, or answer a stale version with the stale path (`onStale`) so the page says the form changed. Either one keeps the AC's promise that a visitor mid fill never sees the change.
2. **Reduced motion still fades One at a time (AC-6305, spec 0063 Motion, spec 0058 AC-2).** With reduced motion on, a question reached by pointer runs `question-fade` for 200 ms (`getAnimations()` shows `ws-hosted-form-steps-question-fade 200 running`). Both specs say reduced motion makes it an instant change. The `@media (prefers-reduced-motion: reduce)` rule in `HostedFormSteps.module.css` swaps the rise for a fade. It should set `animation: none` instead. The auto advance pause does drop to none (62 ms with reduced motion, against 441 ms without).
3. **The first paint is always Classic's card, so One at a time jumps (AC-6306).** `main.ts` calls `mountFormLoading(root, mode)` before the form is read, with no layout, so every form first draws the Classic card skeleton. A One at a time form then swaps to the open, cardless layout, and a dark form flashes a light card first. The layout aware shape only shows while the chunk loads, after the read. Shots: `loading-verify-one-desktop.png` against `loaded-verify-one-desktop.png`, `loading-verify-one-dark-desktop.png` against `chunkwait-verify-one-dark-desktop.png`. The page needs the layout (and colour) before the read, for example from the edge or the page's HTML. If that can't be known, the AC needs `/architect` to say what "never jumps" means.
4. **At 390 px the Questions header clips its own buttons (spec 0058 AC-1).** The new **Add a step** button pushes **Add a question** past the edge ("+ Add a questio"), and **More question actions** (⋯) drops out of view entirely. Shots: `ed-phone-top-light.png`, `ed-phone-top-dark.png`, `ed-phone-divider-light.png`. The header needs to wrap, or Add a step can move into the ⋯ menu on narrow widths.

## Should fix

- **The preview can't show a step hidden by its Show when.** When you open a question or the divider of Big teams (shown when Team size is 51 or more), the preview falls back to step 1, because it walks the path with no answers. Opening Step 2 and Step 4 does preview them. Shots: `ed-seats-open-desktop-*.png`. The preview could show the edited step even when its condition is unmet.
- **Step refusals land on the Step title field.** All three refusals mark the title input `aria-invalid`, give it a red border and move focus to it, even when the title is fine (a Show when problem, an empty step). Point the error at the Show when row, or at the divider.
- **The names don't match.** An empty divider is called "New step" in the list, but the refusal calls it "Step 3 has no questions…". Shot: `ed-publish-dialog-desktop-light.png`.
- **A rule on a later question reads "Shows when A removed question is x".** The question still exists, it just comes later. The pink banner and the inline error also say the same thing twice. Shot: `ed-refuse-later-desktop-light.png`.
- **Step numbers in the editor and on the page differ** when a step is conditional. The editor shows "Step 4 · Anything else" while the visitor (and the preview) read "Step 3 of 3". That is right for the visitor, but a quiet "only when …" on the divider would help the editor make sense of it.
- **Refusals over RPC name `field: "name"`** for every step problem (`CONFIG_INVALID`). A client that maps fields would point at the form's name.

## Nits

- Back is a ghost button, so its arrow sits about 10 px inside the content's left edge in both layouts.
- At 390 px the three Layout tiles wrap two over one.
- **Add a step** always adds at the end, even with a question open, so it is always followed by a drag.
- These were already there and are not from this slice: axe `target-size` on drag grips (question rows fail it too), and the probe's 1 px `<input>` padding (Classic shows it as well).

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC-6302 Layout tiles, versioned | ⚠️ not applied | The tiles switch the preview (Classic, Steps, One at a time; `ed-steps-nostep-desktop-*.png`, `ed-one-preview-desktop-*.png`), and the layout publishes on the version (`/api/public/forms/verify-midfill` showed v2 Classic after publish). The mid fill guarantee fails (must fix 1). Note for `/architect`: the tiles live on the Form tab, not under Settings as the AC words it. |
| AC-6303 Step dividers | ✅ met | Add a step, title it, keyboard drag ("moved to position 3 of 8" announced), remove: "Removed Step 2 · Your company. Its questions joined the step above." with Undo, and focus moved to the next row. Classic shows "Shows with Steps" on each divider. `e6`, `e7`, `ed-dragged-steps-*`, `ed-removed-step-*`, `ed-classic-with-steps-*`. Pointer drag was not exercised. |
| AC-6304 Steps on the hosted page | ✅ met | "Step 1 of 3" progress line, an empty Continue gives field errors and the "2 answers need a look" summary with links, Enter continues, Back keeps "Grace Hopper", focus lands on the step's first question, and the live region says "Step 2 of 3". The last step shows the form's button text (Send). |
| AC-6305 One at a time | ⚠️ not applied | Enter continues, an empty required stays put with its error, Shift and Enter gave `"Line one\nLine two"`, Enter on the long answer sent, Back keeps the pick, arrow keys move without advancing, progress reads "2 of 6". A pointer pick advances after about 450 ms (62 ms with reduced motion). The last choice question never sent by itself (0 posts after 3 s, with and without reduced motion). Fails on the reduced motion fade (must fix 2). |
| AC-6306 Lazy chunk, loading shape | ⚠️ not applied | Classic requested no `HostedFormSteps` module, while Steps and One at a time loaded it. Fails on the first paint (must fix 3). |
| AC-6312 Show when on steps | ✅ met | Big teams hidden gives "Step 2 of 3". Picking "51 or more" gives "Step 2 of 4", and seats shows as step 3. Switching back to "1 to 10" gives "Step 2 of 3" again. |
| AC-6314 `pathOf` on page and server | ✅ met | The page posted no `seats` after the step was skipped. A forged `seats: "999"` with "1 to 10" was accepted, and the stored answers were `name, email, size` only. A forged "51 or more" without seats was refused (`seats: Answer this question.`). Required seats in the skipped step was never demanded. Version skew is under AC-6302. |
| AC-6331 Budget | ✅ met | CI 41168656593 `check`: hosted form JS 188.42 kB of 223 kB, CSS 15.27 kB of 17 kB, "Form step layouts, lazy" 3.8 kB of 10 kB. `.size-limit.js` throws if the chunk stops being lazy. |
| AC-6332 Stale lines | ✅ met | The `apps/web/src/features/forms/README.md` line 25 and the `apps/web/src/public/main.ts` header now name React, the 223 kB and 17 kB budget and the lazy chunk. No "no React, 12 kB" is left. |

**Publish refusals** (AC-6312, through `stepsProblem`): all three refuse over RPC and in the editor, one sentence each.
- Empty step: "Step 2, “Empty one”, has no questions. Move a question under it, or remove the step."
- Later question: "Step 2 reads “Anything else?”, which comes after it. Change its Show when."
- Email step: "“Work email” is how a submission becomes a person, so its step always shows. Remove the Show when on Step 2."

**Fallback**: with `HostedFormSteps.tsx` aborted, `/f/verify-steps` drew Classic. It still followed the path (Big teams hidden) and the submission went through. Shots: `fallback-steps-*.png`.

**Spec 0058 bar**: axe was clean on every hosted screen (Steps, One at a time, Classic, errors, thanks, fallback, light and dark looks, 1440 and 390). The editor's only axe finding is the drag grip `target-size` noted above. The alignment probe passed on every hosted step. Motion uses tokens (`--duration-move`, `--ease-out`), transform and opacity only, and only on a pointer move. A move by key shows at once. The one motion miss is must fix 2. Copy stays short.

## Shots

All shots are in `/private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/2259bda6-8fc1-4ef4-a83d-b6fba62f0413/scratchpad/vffin/shots/`. The editor shots come in `-light`/`-dark` pairs (app theme). The hosted form follows its own look, so its dark shots are the `*-dark` forms (`verify-steps-dark`, `verify-one-dark`, `verify-classic-dark`).

- Editor: `ed-classic-desktop-*`, `ed-steps-nostep-desktop-*`, `ed-steps-list-desktop-*`, `ed-divider-open-desktop-*`, `ed-seats-open-desktop-*`, `ed-step4-open-desktop-*`, `ed-added-step-desktop-*`, `ed-two-steps-desktop-*`, `ed-classic-with-steps-desktop-*`, `ed-one-preview-desktop-*`, `ed-dragged-steps-desktop-*`, `ed-removed-step-desktop-*`, `ed-publish-dialog-desktop-*`, `ed-refuse-{later,email,empty}-desktop-*`, `ed-phone-top-*`, `ed-phone-divider-*`
- Steps: `steps-{1,1-errors,2,3-big,last,thanks}-desktop-*`, `h-{1,1-errors,2,3-big,last,thanks}-steps-phone-*`, `h-*-steps-dark-{desktop,phone}-*`
- One at a time: `verify-one-{q1,q1-error,q2,q3,last,thanks}-{desktop,phone}.png`, `verify-one-*-desktop-rm.png` (reduced motion), `verify-one-dark-*-{desktop,phone}.png`, `verify-lastchoice-*`
- Classic: `verify-classic-{desktop,phone}.png`, `verify-classic-dark-{desktop,phone}.png`
- Loading and fallback: `loading-verify-*-desktop.png`, `loaded-verify-*-desktop.png`, `chunkwait-verify-*-desktop.png`, `fallback-steps-*`, `fallback-steps-after-*`, `midfill-refused-desktop.png`

## Not ticked

`docs/specs/0063-forms-features/verify.md` is not ticked. Lane branches never edit `docs/specs/`, and the verdict is FAIL anyway.
