# StatusDot

A status as a dot in its hue, then its label.

## Why it exists

Ported from the artifact's StatusDot card. It is the status attribute's one display (cells, the record panel, cards, filters, board column headers). Screens render it through the field set, never directly. The one exception is the status page's health dot, which is the system's state, not an attribute value (its import carries an ESLint disable saying so). Inside the library, TeamList (spec 0041) draws a member's presence with it too: a state in words with a dot, not an attribute value.

## Use

```tsx
<StatusDot hue="green">Active</StatusDot>
<StatusDot hue="orange" isArchived>Paused</StatusDot>
```

- The label always shows (or its `shortLabel` in a narrow container); the dot's colour is never the only cue.
- `isArchived` turns the dot gray and adds "(archived)" for screen readers.
- `shortLabel`: a word or two shown in place of the label in a narrow container (under 480px, a phone's bar), so the dot never stands alone; the full label stays in the accessibility tree as a visually hidden copy (read at every width; the shown words are `aria-hidden`). Why a variant: an editor's status in the TopBar was cut to "D." beside the name on a phone, which said nothing (22 October 2026). The dot alone was tried and turned down: colour would be the only cue, and Draft and Paused share a gray dot (WCAG 1.4.1; decided 22 October 2026). EditorStatus (PreviewLayout) passes Live, Edited, Draft or Paused.

## States

Archived, ShortLabel (wide and narrow) and ArchivedShortLabel.

## Keyboard

It takes no focus.

## Differences from the artifact

- `hue` replaces `color`, and is required; `isArchived` is new.
