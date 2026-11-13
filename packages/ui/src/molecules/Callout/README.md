# Callout

A message that stays in the page beside what it is about.

## Why it exists

New. An import that skipped rows (#30), a secret shown once (#34), a plan near its limit (#38) and a setup step (#14, #22) need a message that stays put until what it describes changes. A toast leaves after 5 seconds, and EmptyState fills a whole region; neither fits. Its tones take the status pairs (`success-soft` and `success`, and so on) since spec 0072.

## Use

```tsx
<Callout tone="warning" title="3 rows were skipped" actions={<Button>Download skipped rows</Button>}>
  Their dates weren't in one format. Fix them, then import those rows again.
</Callout>
```

- `tone` is required: every caller decides what the message is.
- `info` is rare, quiet and never permanent: a plain line in `text-secondary` beside a `text-tertiary` icon, with no fill and no edge (Vercel's Note). Use it for a state that comes and goes or belongs to this moment (live updates paused, "Showing the first 12", a result just reported, one step still blocked: "Add your place first"). Never for a permanent explanation of how a screen works: if the screen needs the words, fix the screen. Why: 93 blue boxes explaining features made every screen look generated (the owner, 5 November 2026).
- `success` confirms a result in place. `warning` only when someone must act or is about to take a risk, `danger` for what failed (announced): these keep their tinted box, and carry the action or name the step.
- A page the viewer can only read says so with SettingsLayout's "View only" tag (`ViewOnlyTag`), never a Callout.
- Never the only copy of something critical for long: pair it with the place to act.
- `placement`: `inline` (the default) sits inside a padded region, as a box on its tone's soft ground. `banner` runs full width under a view's bars, for a state of the whole view (live updates paused): square, with only a `border-subtle` hairline below (the bar above draws the line over it), its content in line with the bars' content. Why a variant: a bordered, rounded box flush against the view's edges notched against the sidebar, doubled the bar's hairline and sat out of line with the bars. `bar` is one short, quiet line (the tone's icon and text, with no fill or edge, so it never reads as a button; a long one is cut short) at a control's height inside a bar (the view bar), for a state that comes and goes under the person: live updates paused. Why a variant: the banner pushed the table down each time the connection dropped and came back. On a phone (its container under 480px, as FloatingBar narrows) a long one wraps under its first words instead, so a reason in the bulk bar is read whole.
- `isAnnounced` says it politely when it appears (`role="status"`), for a state that changed under the person rather than one they caused. Its words go in a frame after it mounts, since a status region announces changes, not what it was born with. `danger` is always announced, as an alert, unless `isPolite`: a danger the person caused themselves (a form's "2 answers need a look" after Send, with focus already on the first) is said politely, as a status.

## States

The four tones (info as a plain line, the rest boxed), inline, in a bar (no fill for any tone, wrapping on a phone) and as a banner, announced or not.

## Keyboard

Only its actions take focus.

## Differences from the artifact

Not in the artifact. `tone` is required, and `info` has no fill or edge.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Callout: success, warning and danger sit on their soft ground (`success-soft`, `warning-soft`, `danger-soft`) with no edge, `radius-lg`, `space-12` by `space-16` in, `space-12` between the icon and the words; the words are the text colour (`text-secondary` under a title, the title `text-body-strong`) and the icon takes the tone's colour. In a bar (`CalloutBar`) there is no ground, so a toned line takes its colour on its words too.

**Two looks until the guest phases (spec 0072, decision 16).** Guests draw Callout too (a hosted form or a booking page), and guest pages keep their shipped look and cost until their own port phase (6 to 8). So `Callout.module.css` is the shipped look, which every page loads, and the prototype's look described here is `Callout.app.css`: the module's own class names, in the `utilities.app-look` layer, only under `<html data-scale="app">`, loaded by `src/app-look.ts` from the app's layouts and the stories. Change the app's look there, and the shipped look in the module; `app-look.test.ts` keeps their class names in step. The two merge back into the module when the guest pages take the prototype's look.

**Use it for** a state that stays until what it describes changes (an import that skipped rows, a sync that stopped). **Don't use it for** something that just happened (a toast), a field's error (under the field) or an explanation of how a screen works.

**States**: info (a plain line), success, warning, danger (announced), with or without a title, with actions; inline, banner, in a bar.

**Differences from the prototype**
- `info` stays the owner's quiet grey line with no ground (5 November 2026), where the prototype's info is an `accent-soft` box; the prototype's `neutral` tone has no library tone.
- No dismiss (×) and no collapse: a Callout leaves when its cause is fixed, and the screen removes it. Owed to the screen that needs one.
- Actions are Buttons in `actions`, not the prototype's link with a nudging arrow.
- The legacy `tag-*-border` edges are gone; a banner's line below is `border-subtle` for every tone.
