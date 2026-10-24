# SocialLinksEditor

Where a person keeps their own social links: one settings row per network, each a field that takes a handle or a pasted link, with Add social link for the networks not used yet.

## Why it exists

New (booking socials, 25 October 2026). Settings › Profile and the booking page editor's Edit social links dialog edit the same set, so they draw the same editor. Reuse first: each link is a `SettingsRow` (the network's mark as its leading mark, the network's name as its title) holding a `Field` (the network's address as its `prefix`, its example handle as the placeholder) with a row `Menu` in its `suffix` (inside the box, as Your page's Copy is, so every field on the screen ends on one line), the same parts Settings › Profile's Handle and Bio rows and its Public pages order use; the card is `Card`, its footer the dashed Add Button with a `Menu` of networks. What none of them hold is the set itself: one row per network, in order, checked as each field is left by the rule the server keeps (`checkSocialLink` in `@crm/contracts`), so a module.

## Use

```tsx
const [rows, setRows] = useState(() => socialLinksDraftOf(profile.socials));
<SocialLinksEditor rows={rows} onChange={setRows} />;
// On save:
const checked = socialLinksOfDraft(rows);
if (checked.ok) save(checked.links);
else setRows(checked.rows); // every row that won't save now says why
```

- Controlled: the screen holds the draft (`SocialLinkDraft[]`) and saves it its own way: Settings › Profile with its SaveBar, the dialog with Save.
- `draft.ts` holds the plain functions: `draftOf` (stored links to rows, each field holding its handle), `checkedRow`, `linksOf` (rows to canonical links, an empty row left out, or the rows with their errors) and `isDraftChanged`.
- A field is checked as it is left: a pasted profile link becomes its handle ("https://twitter.com/ada?s=20" reads "ada" after "x.com/"); a link to another network, a post, or another site is refused in plain words under the field ("That’s a link to Instagram, not LinkedIn."). A whole link shows without the prefix.
- Remove takes a row out of the draft at once, with no confirm: nothing is saved until Save, and Discard brings it back.
- One row per network, at most ten: Add social link offers only the networks not used, and goes away when every one is.
- `tone="bare"` drops the card's frame, for a dialog that frames it already.

## States

- **Empty**: one row, "No social links yet", with Add social link.
- **Loading** (`isLoading`): two rows' shapes, the card marked busy.
- **Error**: a row's field shows why its text won't save, and the screen's save waits for it.
- **Disabled** (`isDisabled`, while a save is out): everything stays, nothing takes input.
- **Read only** (`isReadOnly`): the fields read only, with `readOnlyReason`; no menus, no Add.

## Keyboard

`Tab` moves field, row menu, field, then Add social link. A new row's field takes focus. The menus open with `Enter`, `Space` or `ArrowDown`, and their items are Move up, Move down and Remove (`Delete` is not bound: a field's own key).
