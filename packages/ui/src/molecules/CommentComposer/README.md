# CommentComposer

A comment being written: a field one line tall at rest that grows to ten, the `@` list of members, and Comment.

## Why it exists

New (spec 0038, the inventory's CommentComposer). No library piece writes a message with mentions: Field's multiline variant is a long text value (three lines at rest, no list), and the rich text editor (`@crm/ui/editor`) is Tiptap, which the record page doesn't load. This composes the existing parts: Field (its new `composer` variant and its list wiring), the editor's MentionList (the same `@` rows the note editor shows), Button and Callout.

## Use

```tsx
<CommentComposer members={members} onSubmit={async (body) => (await send(body))?.message} />
<CommentComposer mode="reply" members={members} onSubmit={reply} onCancel={close} onEditLast={editMine} autoFocus />
<CommentComposer mode="edit" members={members} initialBody={comment.body} onSubmit={save} onCancel={stopEditing} />
```

- The text holds mentions as `<@member-uuid>` tokens (`@crm/contracts/mentions`); the person sees "@Name". Removing any character of "@Name" removes the whole mention. A token naming someone not in `members` shows as `formerMember`.
- `onSubmit(body)` answers a refusal's reason, or nothing. A new comment or reply clears at once (the thread shows it as sending); a refusal puts the text back with its reason and Retry. An edit keeps its text and shows Save pending until the answer.
- The count shows past 9,000 characters (Field's counter at nine tenths of 10,000).

## States

Empty (Comment disabled), typing, the `@` list open (with nobody matching), a reply or an edit with Cancel, saving an edit, refused with Retry, and disabled (a record in the trash).

## Keyboard

Typing `@` at the start or after a space opens the list: Up and Down move, Enter or Tab pick, Esc closes it. ⌘Enter (Ctrl+Enter) sends. Esc clears focus, or cancels a reply or an edit. Up in an empty reply composer edits the person's last comment (`onEditLast`). The field names the open list with `aria-controls` and its highlighted option with `aria-activedescendant`.

## Differences from the artifact

The artifact has no composer yet; this is code first, published with the next `pnpm ui:artifact`.
