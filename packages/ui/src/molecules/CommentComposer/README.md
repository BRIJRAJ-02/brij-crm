# CommentComposer

A comment being written: a field one line tall at rest that grows to ten, the `@` list of members, and Comment.

## Why it exists

New (spec 0038, the inventory's CommentComposer). No library piece writes a message with mentions: Field's multiline variant is a long text value (three lines at rest, no list), and the rich text editor (`@crm/ui/editor`) is Tiptap, which the record page doesn't load. This composes the existing parts: Field (its new `composer` variant and its list wiring), the editor's SuggestionList (the same `@` rows the note editor shows), Button and Callout.

## Use

```tsx
<CommentComposer members={members} onSubmit={async (body) => (await send(body))?.message} />
<CommentComposer mode="reply" members={members} onSubmit={reply} onCancel={close} onEditLast={editMine} autoFocus />
<CommentComposer mode="edit" members={members} initialBody={comment.body} onSubmit={save} onCancel={stopEditing} />
```

- The text holds mentions as `<@member-uuid>` tokens (`@crm/contracts/mentions`); the person sees "@Name". Removing any character of "@Name" removes the whole mention. A token naming someone not in `members` shows as `formerMember`.
- `onSubmit(body)` answers a refusal's reason, or nothing. A new comment or reply clears at once (the thread shows it as sending); a refusal puts the text back with its reason and Retry. An edit keeps its text and shows Save pending until the answer.
- `fieldRef` hands the screen the text field, to send focus there when the focused comment went away (a delete, a thread resolved into its fold).
- The count shows past 9,000 characters (Field's counter at nine tenths of 10,000).

## States

Empty (Comment disabled), typing, the `@` list open (with nobody matching), a reply or an edit with Cancel, saving an edit, an edit emptied of its text (refused with "A comment can’t be empty. Delete it instead.", no Retry), refused with Retry, and disabled (a record in the trash).

## Keyboard

Typing `@` at the start or after a space opens the list: Up and Down move, Enter or Tab pick, Esc closes it. ⌘Enter (Ctrl+Enter) sends. Esc clears focus, or cancels a reply or an edit. Up in an empty reply composer edits the person's last comment (`onEditLast`). The field names the open list with `aria-controls` and its highlighted option with `aria-activedescendant`.

## Differences from the artifact

The artifact has no composer yet; this is code first, published with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

Takes its look from CommentThread (spec 0072): the prototype folds CommentComposer into its CommentThread's composer. The text field is Field's `composer` variant (ported in tier 2a), which draws the box; this module lays it over Cancel and the send button, `space-6` apart as the prototype's edit actions are, a refusal's Callout between them.

**Use it for** writing a comment, a reply or an edit. **Don't use it for** a long text value (Field `isMultiline`) or a note (the rich text editor).

**States**: as listed above; stories add `MentionDismissed` (Esc closes the @ list, focus and text stay).

**Differences from the prototype**
- The prototype's composer is one filled box (`surface-subtle`, `radius-lg`) holding the text, a "@ mention · ⌘↵ send" hint and a round send button, turning white with an accent edge while writing; here the box is Field's, and Cancel and Comment (with their `kbd` hints) sit under it. The box's look follows Field.
- No dim while sending: a new comment clears at once and the thread shows it as sending; an edit shows Save pending.
- Kept beyond it: `<@member-uuid>` tokens, whole-mention deletion, refusal with Retry, `onEditLast`, the counter near the limit, `fieldRef`, disabled.

**Repeats from its replacer** (AC-4): the actions' `space-6` gap; it leaves with this export.
