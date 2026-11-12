# AIAssist

Ask AI about a record (spec 0073, batch 3): suggested questions, a prompt, one status line while it works, the answer arriving as text, then Copy and Save as note.

## Why it exists

New, as the prototype's AIAssist (spec 0073's mapping, row 1). The app has no AI surface: no streaming text, no thinking line, no Ask AI panel. Everything inside is the library's own: the prompt is Field's `composer` variant (as CommentComposer's), the suggestions are round secondary Buttons (BookingChat's quick replies), the status steps swap through TextSwap, a failure is a Callout with Try again, Copy is CopyButton, and the sparkle is Icon's `ai` tone. Its own CSS is the card's layout, the question's bubble, the status line's shimmer and the answer's fade.

The prototype's `AITag` is Tag's `ai` tone, and its `AIMark` is `Icon name="sparkles" tone="ai"`; `ThinkingLine` and `StreamText` stay inside this folder (spec 0073), since nothing else streams or thinks yet. Phase 5 (the AI filled sparkle on attribute values) reuses Tag's tone and the Icon, not new parts.

## Load

On `@crm/ui/ai`, an entry of its own like `@crm/ui/grid` and `@crm/ui/charts`: the screen that offers Ask AI imports it with `import()`, so neither its code nor its stylesheet sits in a first load. `src/ai.test.ts` proves the main entry and the public pages' entries never reach this folder, and `apps/web/build.test.ts` that its stylesheet's classes never reach `index.html`, `book.html` or `form.html`'s first load (AC-7314).

## Use

```tsx
const AIAssist = lazy(() => import('@crm/ui/ai').then((ai) => ({ default: ai.AIAssist })));

<AIAssist
  context="Acme Corp"
  suggestions={['Summarise this company', 'What changed this week?']}
  onAsk={(question, signal) => data.ai.ask(recordId, question, { signal })}
  onSaveNote={(answer) => notes.create(recordId, answer)}
  onClose={close}
/>;
```

- `onAsk(question, signal)` is the screen's: the library never calls a model, reads a key or a setting (AC-7320). It answers with the whole text (`Promise<string>`), which the panel reveals two words a step (more for a long answer, so it shows within 60 steps, about three seconds), or with the text as it is written (`AsyncIterable<string>`), drawn as it arrives. `signal` aborts on Stop, on a new question and when the panel goes away. A rejection, a stream that throws partway, or an answer with no words shows "Couldn't get an answer. Try again." with Try again.
- Answers are text, drawn as text nodes, never HTML (AC-7317): markup in an answer shows as the characters it is (story `TextOnly`). Line breaks are kept (`pre-wrap`); a long word or address wraps.
- `suggestions` show as chips before the first question; pressing one asks it.
- `thinking` is the status line's steps ("Reading the timeline", "Checking 3 notes and 2 emails"); three general ones by default. Screen readers hear "Working on an answer" once instead of every step.
- `onSaveNote` gets the whole answer; `onClose` puts Close in the header. Left out, neither is drawn.
- The heading is an `h2` ("Ask AI") naming the region, with what it is about after it.
- Fill a column: the card takes its slot's height, and its body scrolls between the header and the prompt.

## Scale (spec 0073, gate 3)

Nothing draws in proportion to an answer's length. Settled text is cut into closed blocks of at most 1,000 characters (`stream.ts`, pure, tested in Node), each drawn once as a memoised text node and never again; each new piece redraws only the open block and itself, the one span that fades in. Pieces that arrive faster than the screen paints are joined and drawn once a frame. A 2,000 piece, 90 kB answer ends as about 92 text nodes and no elements (story `LongStream`); the prototype drew one span per word.

## States

Start (headline and suggestions), thinking (the question, the status line, Stop), streaming (the answer arriving, busy for screen readers, Stop), answered (Copy, Save as note, New question), stopped (the words so far, "Stopped.", Copy), failed (Try again), and a broken stream (failed).

## Motion

The app's rules (spec 0071): no blur, no press scale. The start line rises `distance-medium` out of a fade over `duration-very-slow`, the suggestions follow a `duration-stagger` apart, and Copy and Save as note rise in over `duration-fast`. The status steps swap through TextSwap every two seconds under a light that sweeps across the words over `duration-pulse`. Each new piece of an answer fades in over `duration-medium`. Under reduced motion the rises become fades, TextSwap keeps its fade, the sweep holds still and the answer's fade stays.

## Keyboard

Enter asks; Shift+Enter breaks the line (a key that finishes an input method's word stays the method's). Tab goes New question and Close (in the header), the suggestions, then the prompt, then Ask or Stop. Stop puts focus back in the prompt; New question empties the panel and puts focus in the prompt.

## Differences from the prototype

`onInsertNote` is `onSaveNote` (it is the button's word); `onAsk` takes an abort signal and may answer with a stream; the prototype's sub line under the start headline is left out (less text, the owner's 5 November call); the answer's words fade in without the prototype's per word spans (gate 3); a failure state is added. Not in the artifact yet; it goes with the next `pnpm ui:artifact` (the artifact bundle carries `@crm/ui/ai` as it carries the grid and the charts).
