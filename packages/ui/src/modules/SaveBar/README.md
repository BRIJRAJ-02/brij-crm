# SaveBar

The bar a page shows while it holds unsaved changes: a quiet status, Discard and Save, floating at the foot of the view.

## Why it exists

New (20 October 2026). Bookings › Availability and the booking page editor each built their "Unsaved changes" bar from an info Callout: a blue box the width of the page, with Discard and Save on a second line under the text, which covered the cards under it. A Callout is a message that stays beside what it is about; a save bar is a control with states of its own (saving, saved, failed), a shortcut and an exit, so a Callout variant would have carried all of that into every message. The owner asked for one design for saving across the app, in the bulk bar's family, so it is built on the `FloatingBar` shell BulkActionBar uses: the same size, corners, shadow, placement and motion. Settings and the form builder adopt it next.

## Use

```tsx
<PageColumn
  footer={
    <SaveBar
      status={isSaving ? 'saving' : isDirty ? (failure ? 'error' : 'unsaved') : justSaved ? 'saved' : 'hidden'}
      error={failure}
      onSave={save}
      onDiscard={discard}
      onFocusAway={() => pageHeading(document)?.focus()}
    />
  }
>
  …
</PageColumn>
```

- Put it in a page's `footer` (PageColumn, PreviewLayout), and keep it there while nothing is unsaved (`status="hidden"`), so it can play its exit. The footer sticks to the foot of the view and sits in the flow after the last card, so the bar never hides it; the bar centres itself there.
- `status`: `unsaved` says "Unsaved changes"; `saving` keeps every word and width in place while Save's check gives way to a spinner; `saved` says "Saved" with a check for a moment, then the bar sinks out; `error` says `error` in the danger colour and Save becomes Try again; `hidden` sends it away (after a discard).
- `blockedReason` says why the changes can't be saved yet, in place of "Unsaved changes", and Save waits.
- `onDiscard` adds Discard (ghost), before Save. Esc never discards.
- `onFocusAway` says where focus goes when Discard or Save leaves while it had focus (after a discard or a save), so it never falls to the page: the page's title.
- The status is a polite live region, born with its first words: "Unsaved changes" arriving with your first edit stays quiet, and Saved or the failure is said.
- ⌘S (Ctrl+S on other keyboards) saves from anywhere on the page while the bar shows, and ⌘↵ does too outside a form (a form's ⌘↵ submits that form). Save shows the ⌘S keycap (hidden on touch only devices, as every keycap is).
- On a narrow view it spans the width inside the gutter, the status first and the buttons at the end; a failure's reason wraps them onto a second line.

## States

Unsaved, unsaved with a reason it can't save, saving, saved, failed, and leaving; wide and narrow.

## Keyboard

Tab reaches Discard, then Save, after the page's content. ⌘S or ⌘↵ saves. Esc does nothing here.

## Differences from the artifact

Not in the artifact.
