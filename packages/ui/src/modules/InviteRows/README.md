# InviteRows

The one way to add people by email: a row per person (their address, and their role where the inviter can choose), a remove button on each once there are two, and "+ Add another" under the rows to add the next.

## Why it exists

New (22 October 2026, the owner: "use the same system to add the users across", "with a plus to add"). People were added two ways: Settings › Members' invite dialog had a row per address with a role each, and first run's Invite your team had one comma separated textarea. Each was its own markup in the app. Neither Field nor Select can hold rows, and a variant of either would have bent it, so the rows, their keys and their focus rules live here once, and both screens (and every Invite button that opens the dialog) draw them.

## Use

```tsx
const [rows, setRows] = useState(() => [createInviteRow('member')]);
<InviteRows
  rows={rows}
  onChange={setRows}
  roles={[
    { id: 'admin', label: 'Admin' },
    { id: 'member', label: 'Member' },
  ]}
  rolesInfo={<InfoTip label="Role">What each role can do.</InfoTip>}
  errors={{ [rows[0].id]: 'Enter a valid email address.' }}
  max={20}
  onSubmit={send}
/>;
```

- Controlled: the screen holds the rows (`createInviteRow(roleId?, email?)` makes one with a random id) and judges the addresses; `errors` puts a row's problem under its email.
- `roles` adds the role column, a compact Select per row. A new row takes the role of the row it follows. Left out, there is no role column (everyone joins as one role).
- The columns are named once above the rows: Email, and Role with `rolesInfo` beside it (what each role can do sits by the pickers, not in a dialog's title bar). Every control keeps its own name for screen readers ("Email 2", "Role for ada@acme.com", "Remove ada@acme.com").
- "+ Add another" (a ghost Button with the plus, named "Add another person") sits under the rows, the way Slack, Linear, Vercel and Plane put it; every row ends in a remove button once there are two (one row has none, so its fields reach the end). At `max` rows the button gives way to "Up to 20 at a time.", and a longer paste keeps the first ones and calls `onOverflow(kept)` so the screen can say the rest wait.
- A pasted list fills the row it lands in and new rows after it: with an `@` in it the addresses alone (a mail client's "Ada Lovelace <ada@acme.com>, Bob <bob@x.com>"), else split on commas, semicolons, spaces or line breaks. Only several characters arriving at once split; a key typed (a stray space) never does. The input is text, not email, since an email input drops a pasted column's line breaks.
- `ref` gives `focusRow(id)`, for a screen to send focus to the first row that needs fixing.
- `autoFocus` puts focus in the first row's email as it mounts (a dialog opened to invite).
- `isDisabled` while the invites go out.

## Keyboard

Enter is the rows' own, so InviteRows works inside a library `Form` (first run) as well as a Modal: it never also submits the form around it.

- Enter in a row goes to the next row; in the last row it adds one; in an empty last row it calls `onSubmit` (the screen sends).
- Tab moves email, role and remove along each row, then to "+ Add another". Adding focuses the new row, removing the row before, a paste the last row filled.

## States

One empty row, several rows, with errors, without roles, full (`max`), disabled, and a phone's width. No loading or read only state: a screen shows its own loading before it has the roles, and someone who can't invite never sees the form.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
