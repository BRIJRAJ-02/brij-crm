# SetupChecklist

Home's setup checklist (spec 0041): how far setup has got, the steps still open with their buttons, and the done steps folded into one line.

## Why it exists

New. The owner asked for a compact checklist (22 October 2026): a progress bar ("3 of 4 done"), done steps folded into one "3 done" line with a check each, the open steps' buttons, a one line "You're all set" note once every step is done, and a ⋯ menu with Hide setup. Steps is a flow's position (one current step, the rest upcoming), with no button per step and nothing folded. LinkList's rows are links to things with chips and a toolbar, and its done state was a grey "Done" chip on dimmed text, which is what the owner asked to replace. A variant of either would have taken most of this component inside it.

## Use

```tsx
<SetupChecklist
  title="Finish setting up"
  steps={[
    { id: 'calendar', title: 'Connect your calendar', detail: 'ada@example.com', isDone: true },
    { id: 'invite', title: 'Invite your team', detail: 'Just you', isDone: false, action: 'Invite' },
  ]}
  onAction={(id) => open(id)}
  onHide={() => hide()}
/>
```

- Open steps come first, in their order; the first one's button is primary, the rest secondary. Each button's name starts with its verb and names its step ("Invite, Invite your team"), so several read apart.
- A long step title wraps rather than being cut, so its button keeps its place on a phone.
- Done steps fold under a Disclosure titled "3 done" (an h4 under the card's h3), each with a green check and its detail. A step's state is also read out ("Done", "Not done yet"), so the icon never carries it alone.
- When every step is done, the card becomes one success Callout, "You're all set", with Dismiss. Without `onHide` there is no menu and no Dismiss.
- The ⋯ menu holds Hide setup. Where hiding is remembered (a member preference) is the screen's call.

## States

- Loading: skeleton lines, the card `aria-busy`.
- Error: an EmptyState with Try again (`onRetry`).
- No access: a locked row.
- No steps: nothing at all, so the screen leaves the section out.
- Read only and disabled don't apply: a step the member may not take is left out by the screen, not shown disabled.
- Some done: the bar, the open steps, the done fold closed (or open with `defaultDoneExpanded`).
- None done: the bar empty, no fold.
- All done: the one line note.

## Keyboard

Tab reaches the ⋯ menu, each open step's button, then the done fold's toggle (Enter or Space opens it). The menu opens with Enter, Space or the arrow keys.

## Differences from the artifact

Not in the artifact.
