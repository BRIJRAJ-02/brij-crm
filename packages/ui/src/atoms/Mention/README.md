# Mention

A mention of a member in a note or a comment.

## Why it exists

Ported from the artifact's Mention card. Notes and comments (#27, #29) mark mentions the same way; the editor renders this for its mention node.

## Use

```tsx
<Mention>@Ada Lovelace</Mention>
```

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

None.

## Timefix prototype (spec 0072)

Folded into the prototype's RecordChip (spec 0072): a mention is the name in medium weight on a grey wash inside the sentence (it was link blue on the accent tint).

**Differences from the prototype**: the library's Mention is display only (the note editor draws it through `MentionView`); the prototype's `isSelf` (yellow) and linked mentions are owed to the notes phase.
