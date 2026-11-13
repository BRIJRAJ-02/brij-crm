# Review, feat/port-2, 2026-11-12

**Reviewed by**: Opus 5.5 in a fresh context (the commit trailers say the author also ran on Opus 5.5, so this is an unanchored read, not a cross model one)
**Scope**: 78 files, `f81623f0c..HEAD` on `feat/port-2` (spec 0073, batches 1 to 3, stacked on phase 0)
**Verdict**: Blocked

## Summary

The branch adds SearchField, NumberField, TimeSelect, Modal `isDirty`, PresenceGroup, RemoteCursor `pointer`, TextSwap `soft`, Reveal `drop`, ShareSheet (on ReadyPanel), AIAssist on `@crm/ui/ai`, Tag `tone="ai"`, a raw HTML lint rule, and tighter size budgets. The work is careful: AIAssist's abort and retire logic holds up, text only rendering is real, `shareableUrl` is a tight gate, and the presence cap is proven by a story that fails without it. The blocker is NumberField's parser, which silently turns 1,234 into 1.234 in German, Spanish, Portuguese and similar browser languages. Two majors follow: native digit languages can't edit the field, and SearchField's duplicate guard goes stale in controlled use.

What I ran (load stayed under 7): `@crm/ui` typecheck (clean); unit tests for `ai.test.ts`, AIAssist, ShareSheet, NumberField, TimeSelect, `qr-file`, `index.test.ts` (38 pass); Chromium stories for AIAssist, SearchField, NumberField, Modal's three dirty stories, PresenceGroup and ShareSheet (all pass); the AC-7317 cases in `packages/config/eslint.test.ts` (4 pass). Not run: the web build, `build.test.ts`, `pnpm size`, `ui:artifact --check`, Firefox, WebKit, visual.

## Blockers

### 🔴 NumberField reads its own German output a thousand times too small, `packages/ui/src/molecules/NumberField/number.ts:37`

**Problem**: the "plain point" shortcut accepts `^-?\d+\.\d+$` as a decimal whenever the language's decimal mark is a comma and the text has no comma. In `de-DE`, `es-ES`, `pt-BR`, `id`, `tr`, `nl` and others, `formatNumber(1234)` writes `1.234` (one group mark, no decimals), and `parseNumber('1.234', 'de-DE')` gives `1.234`. I ran it: `de-DE 1234 → "1.234" → 1.234`, `es-ES 12345 → "12.345" → 12.345`, `pt-BR 1500 → "1.500" → 1.5`.

**Why it matters**: the locale is `navigator.languages[0]` (`apps/web/src/main.tsx:338`). A German browser shows a stored 1234 as `1.234`; the person clicks in, types a digit and deletes it (so `draft` is set), then tabs away, and `settle` commits 1.234. A German person typing `1.500` for fifteen hundred gets 1.5. No error, no revert: a silent change by a factor of a thousand to a count, a price or a capacity. It is latent only because no screen uses NumberField yet. The round trip test (`number.test.ts:40`) uses currency in `fr-FR`, which always has a comma, so it never sees this.

**Suggested fix**: only take the point shortcut when the point can't be a group mark in that language (the group mark isn't `.`), or when the digits after the point aren't exactly three. Add a round trip test over plain `number` mode for integers of 1,000 and up in `de-DE`, `es-ES` and `pt-BR`.

## Major

### 🟠 Native digit languages can't edit a NumberField, `packages/ui/src/molecules/NumberField/number.ts:41-46`

**Problem**: `formatNumber` writes the language's own digits (`bn-IN` `১,২৩৪.৫`, `mr-IN` `१,२३४.५`, `ar-EG` `١٬٢٣٤٫٥`, `fa`, `ne`), but `parseNumber` only accepts `\d` (Latin digits) and Western marks (`ar-EG`'s `٬` and `٫` too). Checked: `parseNumber(formatNumber(1234.5,'ar-EG'),'ar-EG')` is `invalid`.

**Why it matters**: Bengali and Marathi are Indian browser languages, which matters for Timefix. Any edit to the shown value (adding a digit, deleting one) parses as invalid, so the field throws the edit away and goes back to the last value. Only clearing the box and typing Latin digits works.

**Suggested fix**: map the language's digits (from `formatToParts` of 0 to 9) and its group and decimal marks to Latin before parsing, or format with `numberingSystem: 'latn'`. Add one native digit language to the round trip test.

### 🟠 SearchField's "never twice" guard goes stale in controlled use, `packages/ui/src/molecules/SearchField/SearchField.tsx:92` and `:101`

**Problem**: `sent` remembers the last query given to `onSearch` and only changes inside `sendNow`. When a controlled parent resets `value` itself (a Clear filters button, a route change that keeps the component), `sent` keeps the old query.

**Why it matters**: the person searched `acme`, the screen's own reset set the box and its filter to empty, and the person types `acme` again. After the pause `sendNow('acme')` sees `acme === sent.current` and sends nothing, so the list stays unfiltered while the box says `acme`. Silent wrong results on the part the scalability gate (AC-7322) depends on. Confidence high on the mechanism; how often it bites depends on screens resetting search from outside.

**Suggested fix**: when the controlled `value` changes to something the field didn't type, set `sent` to it (compare against the last value the field itself reported), or drop the guard for the debounced path and keep it only for Enter right after a pause.

## Minor

### 🟡 Currency mode commits more decimals than it shows, `packages/ui/src/molecules/NumberField/NumberField.tsx:110`

**Problem**: `settle` commits `clampNumber(parsed.value)` unrounded; the display rounds to two decimals. Typing `12.345` in `currency` stores 12.345 and shows `12.35`. The same holds for `maximumFractionDigits`.
**Why it matters**: a money value with three decimals reaches the record, and what the person sees isn't what is saved.
**Suggested fix**: round to the mode's maximum fraction digits on commit.

### 🟡 The discard confirm's state can outlive the close it answers, `packages/ui/src/molecules/Modal/Modal.tsx:235`, `:459`
**Problem**: three cases. (1) If `isDirty` turns false while the confirm is open (an autosave lands, a reset), the confirm unmounts but `isAskingToDiscard` stays true; the next time `isDirty` turns true the confirm pops up with nobody asking. (2) If the parent closes the main Modal itself while the confirm is open, the confirm stays on screen over nothing. (3) Inside an uncontrolled ModalTrigger, a Save that ends with `slot="close"` or the context's `close()` in the same handler that clears the form still sees the old `isDirty === true` and asks to discard what was just saved.
**Why it matters**: an unprompted "Discard your unsaved changes?" is confusing, and (3) is the natural way to write Save in trigger mode. The README (`Modal/README.md:57`) also says it "needs `isOpen` and `onOpenChange`", which no longer matches the code or the `DirtyInTrigger` story.
**Suggested fix**: reset `isAskingToDiscard` when `isDirty` stops being true or the Modal closes; document (and story) how Save closes a guarded trigger Modal, or expose a close that skips the guard; fix the README line.

### 🟡 A retired stream cancels the new stream's frame, `packages/ui/src/modules/AIAssist/AIAssist.tsx:244-247`
**Problem**: `follow`'s `finally` cancels `run.current.frame`, which is shared. Ask A (streamed), Stop, ask B (streamed). When A's iterable (which may ignore the signal) yields one more piece, A returns and its `finally` cancels B's pending frame and zeroes it. B's pending words wait for B's next piece.
**Why it matters**: if B's model pauses, the newest words of B stay hidden for that pause. Not data loss, since the end of B flushes.
**Suggested fix**: keep the frame handle in `follow`'s own scope and only touch `run.current.frame` while `run.current.id === id`.

### 🟡 The answer stops following once a step adds more than about two lines, `packages/ui/src/modules/AIAssist/AIAssist.tsx:307-313`
**Problem**: "near the end" is measured in an effect after the new words are in the DOM, so the distance already includes them. `wordsPerStep` shows `words / 60` per step for a long answer (50 words a step for 3,000 words), which is several lines, more than `FOLLOW_SLACK_PX` (48).
**Why it matters**: a long answer handed over whole fills the panel and then grows out of view while the reader watches the last line sit at the bottom.
**Suggested fix**: track "following" from scroll events (or read the distance in a layout effect before the update) instead of measuring after the growth.

### 🟡 The raw HTML rule has easy bypasses, `packages/config/eslint.js:227-240`
**Problem**: the selectors match `x.innerHTML =`, `x.outerHTML =`, `x.insertAdjacentHTML(` and the JSX attribute only. Not matched: `el['innerHTML'] = html` (a computed literal has `property.value`, not `property.name`), `Object.assign(el, { innerHTML })`, `Reflect.set(el, 'innerHTML', …)`, `el.setHTMLUnsafe(…)`, `range.createContextualFragment(…)`, `document.write(…)`, `<iframe srcDoc={…}>`, `{...{ dangerouslySetInnerHTML }}` spread, and `createElement(tag, { dangerouslySetInnerHTML })`.
**Why it matters**: lint is a guard against accidents, not attackers, so this is minor, but the computed form and `Object.assign` are the ones an accident takes. AC-7317 reads as if the rule closes the door.
**Suggested fix**: add `MemberExpression[computed=true][property.value=/^(innerHTML|outerHTML)$/]`, `Property[key.name=/^(innerHTML|outerHTML|dangerouslySetInnerHTML)$/]`, calls to `setHTMLUnsafe`, `createContextualFragment`, `write`, `writeln`, and `JSXAttribute[name.name='srcDoc']`, each with a case in the config test.

### 🟡 Checks that would pass with the code removed
- `AIAssist.stories.tsx:272-293` `LongStream`: all 2,000 pieces drain before any frame, so they always arrive as one piece and settle to no span. It does fail for a too small block (the commit says so), but it passes with the once a frame batching removed and with `Block`'s memo removed. It proves the final DOM shape, not the redraw cost.
- `AIAssist.stories.tsx:213-215` `Stopped`, "what arrives after Stop is never drawn": the assertion runs before any frame could draw the late piece, so it passes with the guard removed.
- `SearchField.stories.tsx:39-49` `Debounced`: keys are typed with no gap, so a 1 ms debounce passes. AC-7322 asks for 10 keys 50 ms apart firing once.
- `Reveal.stories.tsx:65` `Drop`, "no blur at any frame": it reads `filter` after the animation settled, so a `blur()` in the `from` keyframe still passes.
- `TextSwap.stories.tsx:60` `Soft`: checks the new text and `data-align`; it passes with the cross fade CSS removed.
- `SearchField.stories.tsx` `Disabled` says "no keycap" but never checks it (the default value already hides it).
- `RemoteCursor.stories.tsx` `Pointers`: no check of the glide, the idle fold, or reduced motion.
- `apps/web/build.test.ts:267` holds trivially until a screen imports ShareSheet or AIAssist (documented in the spec), and it never looks at `menu.html` or `reserve.html`, or at QrCode and `uqr`, which the comment names.

Verified as able to fail: `ai.test.ts` (an `export … from './modules/AIAssist/…'` in `index.ts` or a public entry fails it; the `> 10` floor guards a broken walk), the fixed `ws-link-page-` match (the built `LinkPage-*.js` chunks do contain `ws-link-page-`, and `kebab('LinkPage')` gives `link-page`), the `ws-ai-assist-` marker (`kebab('AIAssist')` gives `ai-assist`), `TextOnly`, the `Refused*` stories, PresenceGroup `Crowd`, the dirty Modal stories, and `share-url.test.ts`.

### 🟡 Spec conformance gaps
- AC-7302 says only (c) parts add a component folder; SearchField, NumberField and TimeSelect, all (b), add folders. The spec's own code table lists them, so the AC text needs a line ("a thin wrapper may have its own folder, no stylesheet").
- AC-7318 also covers "the link page editor (LinkEditor's real parts)" with a per scheme test; this branch adds none for that half.
- AC-7321 (the 10,000 result story for ComboBox and FilterBar) isn't built or verified here, and the open items don't say which phase owns it.
- AC-7304's `aria-keyshortcuts` and AC-7305's tabular digits are owed to phase 1, as the spec says.
- Mapping row 23 still says ShareSheet composes "Modal, Field `copy`, CopyButton, QrCode and Button"; as built it is Modal around ReadyPanel's `share` column, which the batch note explains. The row and the batch 2 line "its own lazy chunk" should match the as built text (it is a main entry export kept out of first loads).
- `verify.md` line 7: "`from` 9:00 → the list starts at 9:15 AM". `from` is inclusive in the code, README and story (`from: 9 * 60 + 15`), so the step as written fails.

## Nits
- ⚪ `apps/web/embed/v1.js:555`, `MARKS[attr]` also returns inherited keys (`constructor`, `toString`), so the "only the marks we draw" claim isn't strict. Harmless (they stringify to text with no markup, and the host page is trusted anyway), but `Object.hasOwn(MARKS, key)` makes the disable comment exactly true. **Accepted, size cap** (coordinator, 12 Nov 2026): the script is 2 bytes under its 6.5 kB cap, the attribute is the site owner's, and the worst case is junk text.
- ⚪ `packages/ui/src/molecules/Modal/Modal.tsx:459`, inside a ModalTrigger the confirm's Dialog also takes DialogTrigger's `DialogContext` (RAC `private/Dialog.mjs` provides `overlayProps` with the dialog `id`), so while both are open two dialogs share one `id`. Medium confidence; wrapping the confirm in a cleared `DialogContext` avoids it.
- ⚪ `packages/ui/src/atoms/RemoteCursor/RemoteCursor.module.css`, the pointer anchors at `inset-inline-start` but moves by a physical `x`, so in a right to left page it lands mirrored.
- ⚪ `packages/ui/src/modules/AIAssist/stream.ts:38-41`, a space exactly at `limit` makes a block of `limit + 1` characters; the doc says "at most".
- ⚪ `NumberField.tsx:212`, `inputMode="numeric"` has no minus key on iOS, so a field with a negative `minValue` can't take a typed negative.
- ⚪ `apps/web/.size-limit.js`, first load JavaScript measured 296.62 kB against a 297 kB line: 0.38 kB of room, and each batch here moved it about 0.06 kB from chunk name churn alone. Expect the next unrelated lane to trip it.

## Strengths
- AIAssist's run model (one id that Stop, a new question and unmount all retire, every late update checked against it, the signal aborted) is sound; I found no path where an old answer lands in a new turn.
- Answers and questions render as text nodes only, proven by `TextOnly`, and the stream's block logic is pure and well tested.
- `shareableUrl` composes `safeHref` and then demands an absolute `http(s)` address, refusing paths, `//host`, `mailto:` and `tel:` too; ShareSheet draws nothing but one line and Done when it refuses.
- PresenceGroup's cap holds for the DOM and the accessible name, with status in words, and `Crowd` would fail without the cap.
- Tokens only in all new CSS, no blur and no press scale, reduced motion keeps fades, forced colours handled. Words live in `strings.ts` files and each new part has a README.
- The `ws-LinkPage-` fix turns a check that could not fail into one that can.

## Test coverage
Pure logic (`stream.ts`, `number.ts`, `time-options.ts`, `share-url.ts`, `qrFileName`, the `@crm/ui/ai` reach) is unit tested, and each part has play tests. The gaps are the locale cases above (no plain `number` round trip in a comma decimal language, no native digits), controlled SearchField reset, Modal `isDirty` changing while the confirm is open, and the motion and batching checks listed under "Checks that would pass with the code removed".

## Resolution (12 Nov 2026, on `feat/port-2`)

- 🔴 NumberField parser: fixed. A point is a group mark only where the language groups with one and it could be a group; the language's own digits are read. `number.test.ts` (round trip over eleven languages and three modes) and the `German` and `Bengali` stories failed before the fix.
- 🟠 Native digits: fixed with the above (`bn-IN`, `mr-IN`, `ar-EG`, `fa`, `ne`).
- 🟠 SearchField stale guard: fixed. `ControlledReset` and `ResetMidPause` failed before.
- 🟡 Currency rounding: fixed (`roundToShown`); the `Currency` story failed before.
- 🟡 Modal confirm state: all three cases fixed, plus the two dialogs sharing one id (real: the confirm took DialogTrigger's id); `DirtyAskWithdrawn`, `DirtyClosedByCaller`, `DirtySaveInTrigger` and `DirtyInTrigger` failed before. README line corrected.
- 🟡 AIAssist frame and follow: fixed; `AskedAgainAfterStop` and `FollowsLongAnswer` failed before.
- 🟡 Raw HTML rule: every listed bypass refused, each with a config test that failed before.
- 🟡 Checks that could not fail: each was made able to fail and was failed once by breaking the code.
- 🟡 Spec gaps: AC-7302, AC-7317, AC-7318 (link page half moved to phase 3), AC-7321 (phase 5), row 23, the batch 2 line and `verify.md` line 7 amended.
- ⚪ Embed `Object.hasOwn`: accepted, size cap (above). The other nits (RemoteCursor in right to left, the block limit's off by one, iOS `inputMode`, size room) are left for their phases.
