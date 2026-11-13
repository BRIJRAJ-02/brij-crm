# AIAssist

Ask AI about a record (spec 0073, batch 3): suggested questions, a prompt, one status line while it works, the answer arriving as text, then Copy and Save as note.

## Why it exists

New, as the prototype's AIAssist (spec 0073's mapping, row 1). The app has no AI surface: no streaming text, no thinking line, no Ask AI panel. Everything inside is the library's own: the prompt is Field's `composer` variant (as CommentComposer's) with Ask or Stop as its suffix and its use as its hint, the suggestions are round secondary Buttons in a ButtonGroup row (BookingChat's quick replies), the status steps swap through TextSwap, a failure is a Callout with Try again, Copy, Save as note and New question are a ButtonGroup row arriving through Reveal's `drop`, and the sparkle is Icon's `ai` tone. It has no frame or header of its own: the screen hosts it in a Panel (whose README already names the assistant) or a Card, which give the title, the subtitle and Close (the design system review, 12 November 2026). Its own CSS is the column's layout, the question's bubble (BookingChat's bubble tokens, the small corner on the person's side), the status line's shimmer and the answer's fade.

The prototype's `AITag` is Tag's `ai` tone, and its `AIMark` is `Icon name="sparkles" tone="ai"`; `ThinkingLine` and `StreamText` stay inside this folder (spec 0073), since nothing else streams or thinks yet. Phase 5 (the AI filled sparkle on attribute values) reuses Tag's tone and the Icon, not new parts.

## Load

On `@crm/ui/ai`, an entry of its own like `@crm/ui/grid` and `@crm/ui/charts`: the screen that offers Ask AI imports it with `import()`, so neither its code nor its stylesheet sits in a first load. `src/ai.test.ts` proves the main entry and the public pages' entries never reach this folder, and `apps/web/build.test.ts` that its stylesheet's classes never reach `index.html`, `book.html` or `form.html`'s first load (AC-7314).

## Use

```tsx
const AIAssist = lazy(() => import('@crm/ui/ai').then((ai) => ({ default: ai.AIAssist })));

<Panel title="Ask AI" leading={<Icon name="sparkles" tone="ai" />} subtitle="about Acme Corp" isOpen onClose={close}>
  <AIAssist
    context="Acme Corp"
    suggestions={['Summarise this company', 'What changed this week?']}
    onAsk={(question, signal) => data.ai.ask(recordId, question, { signal })}
    onSaveNote={(answer) => notes.create(recordId, answer)}
  />
</Panel>;
```

- `onAsk(question, signal)` is the screen's: the library never calls a model, reads a key or a setting (AC-7320). It answers with the whole text (`Promise<string>`), which the panel reveals two words a step (more for a long answer, so it shows within 60 steps, about three seconds), or with the text as it is written (`AsyncIterable<string>`), drawn as it arrives. `signal` aborts on Stop, on a new question and when the panel goes away. A rejection, a stream that throws partway, or an answer with no words shows "Couldn't get an answer. Try again." with Try again.
- Answers are text, drawn as text nodes, never HTML (AC-7317): markup in an answer shows as the characters it is (story `TextOnly`). Line breaks are kept (`pre-wrap`); a long word or address wraps.
- `suggestions` show as chips before the first question; pressing one asks it.
- `thinking` is the status line's steps ("Reading the timeline", "Checking 3 notes and 2 emails"); three general ones by default. Screen readers hear "Working on an answer" once instead of every step.
- `onSaveNote` gets the whole answer; left out, Save as note isn't drawn. New question (after an answer, a stop or a failure) empties the panel and puts focus in the prompt.
- `disabledReason` turns the prompt, Ask and the suggestions off and shows why under the prompt (AI off for the workspace, a viewer who can't read the record), as Field shows any disabled reason.
- It fills its slot's height: the conversation (a region named "Conversation", focusable so it scrolls from the keyboard in every browser, with the outline ring drawn just inside its edge, since the slot around it may clip) scrolls above the prompt, and keeps the newest words in view while they arrive unless the person has scrolled up to read.
- Screen readers: one status region, there from the start, says "Working on an answer", then "Answer ready" or "Stopped."; a failure is the Callout's own alert. The answer is `aria-busy` while it arrives, and the question is prefixed "You asked:".

## Scale (spec 0073, gate 3)

Nothing draws in proportion to an answer's length. Settled text is cut into closed blocks of at most 1,000 characters (`stream.ts`, pure, tested in Node), each drawn once as a memoised text node and never again; each new piece redraws only the open block and itself, the one span that fades in. Pieces that arrive faster than the screen paints are joined and drawn once a frame. A 2,000 piece, 90 kB answer ends as about 92 text nodes and no elements (story `LongStream`); the prototype drew one span per word.

## States

Start (headline and suggestions, or the headline alone), thinking (the question, the status line, Stop), streaming (the answer arriving, busy for screen readers, Stop), answered (Copy, Save as note, New question), stopped (the words so far, "Stopped.", Copy, New question), failed (Try again, New question), a broken stream (failed), and disabled (the reason under the prompt). There is no loading or no access state of its own: the screen leaves it out, or passes `disabledReason`.

## Motion

The app's rules (spec 0071): no blur, no press scale, and no entrance on first paint (the start line and suggestions are simply there; the prototype's texts reveal is left out, Reveal's README keeps entrances off the app). The row under an answer arrives through Reveal's `drop`, the app's one entrance. The status steps swap through TextSwap every two seconds under a light that sweeps across the words over `duration-pulse`. Each new piece of an answer fades in over `duration-medium`. Under reduced motion Reveal and TextSwap keep their fades, the sweep holds still and the answer's fade stays.

## Keyboard

Enter asks; Shift+Enter breaks the line (a key that finishes an input method's word stays the method's); the prompt's hint says both. This is a chat's convention, where CommentComposer sends on ⌘Enter: a prompt is one question at a time, a comment is a message composed. Tab goes the conversation (it scrolls), the suggestions or the answer's row, the prompt, then Ask or Stop. A control that goes with the asking hands focus to the prompt: a suggestion, Try again, Stop, and Stop when the answer ends on its own while it has focus.

## Differences from the prototype

`onInsertNote` is `onSaveNote` (it is the button's word); `onClose` and the header are the host's (Panel); `onAsk` takes an abort signal and may answer with a stream; the prototype's sub line under the start headline and its "↵ to ask" keycap are left out (the prompt's hint says it, so screen readers hear it too); the start's rise and the chips' stagger are left out; the answer's words fade in without the prototype's per word spans (gate 3); failure and disabled states are added. Not in the artifact yet; it goes with the next `pnpm ui:artifact` (the artifact bundle carries `@crm/ui/ai` as it carries the grid and the charts).
