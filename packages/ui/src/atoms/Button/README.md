# Button

The one button: 26px tall with a 13px medium label, in five variants, built on React Aria so it works the same by mouse, touch and keyboard. This folder also holds `ToggleButton` (a button that stays pressed), `SplitButton` (a main action with a menu of its variants), `ButtonGroup` (a few buttons joined into one control) `CopyButton` (copies a value and says so in place) and `ButtonLink` (a link drawn as a Button, for an action that goes somewhere: Join the call, Add to Google Calendar, the .ics download on a booking's page). `SplitButton` (SplitButton.tsx) and the cut label tooltip (CutButton.tsx, loaded on demand) sit in files of their own, so the menu and overlay code they need stays out of the first load, which draws only plain Buttons; SplitButton draws its halves with `SplitFrame` and `SplitHalf` from Button.tsx.

## Why it exists

Ported from the design system artifact's Button card. Every pressable control in the app is one of these; a second button style is how a design system dies, so new looks are variants here.

## Use

```tsx
<Button icon="settings" onPress={openSettings}>View settings</Button>
<Button kbd="ESC" onPress={close}>Cancel</Button>
<Button variant="primary" kbd="⌘↵" onPress={save}>Add to list</Button>
<Button variant="primary" isPending>Saving</Button>
<Button icon="ellipsis" label="More actions" onPress={openMenu} />
<Button variant="primary" icon="plus" label="New form" onPress={create}>New</Button>
<ToggleButton isSelected={showArchived} onChange={setShowArchived}>Show archived</ToggleButton>
<SplitButton onPress={save} menu={<Menu label="Save options">…</Menu>}>Save</SplitButton>
<CopyButton value={apiKey} label="Copy the key" />
```

- **One primary per surface.** `primary` goes on the action that commits: Save, Add to list, Select record. Pair it with its shortcut (`kbd="⌘↵"`).
- `secondary` (the default) for view controls (View settings, Import / Export) and Cancel (`kbd="ESC"`).
- `danger` for a control that starts a destructive action, such as Delete in the bulk bar or Archive in settings: red label and edge on the raised surface, so it holds 4.5:1 in both themes.
- `danger-solid` for the final commit that destroys, such as Delete or Archive in a confirm dialog: a `danger-fill` with an `on-danger` label (5.3:1 light, 5.4:1 dark). One per dialog, in place of the primary.
- `ghost` for undo style actions that shouldn't compete, such as Discard changes, and for icon buttons inside dense rows.
- `link` for a quiet text action at label size with no box, the control's height kept for its hit area: a card footer's Sign out or Back (first run, spec 0036). A variant rather than `ghost`, whose body sized label read as a large text button beside the footer's small "Signed in as" line (owner feedback, 21 October 2026).
- `ghost-danger` for a quiet icon button that deletes at once and offers Undo (a form question's Delete): ghost at rest, the danger colour under the pointer and on keyboard focus. A variant rather than `danger`, whose red border at rest is too loud in a row of quiet icons.
- `dashed` only for "add" affordances that grow a set: Filter, Add sort, and "+ Custom" after a booking page's length chips (ChoiceChips `end`), which adds a choice rather than being one (22 October 2026).
- `ButtonGroup` (no longer used by LinkList, which shows quiet ghost actions since the owner asked on 20 October 2026) joins a few secondary icon Buttons that act on one thing into one bordered control, sharing edges as SplitButton's halves do: a list row's Open, Copy link and More (LinkList). It takes Buttons, a CopyButton, or a MenuTrigger with its Button, each with its own `label`; `label` names the group for screen readers. Why not SplitButton: that is one action and its variants, this is several actions of equal weight. Added 20 October 2026 in place of LinkList's own joined box. A Button with `isExpanded` (and `controls`) is a disclosure: it opens and closes a region, reads as expanded or collapsed, and draws held down while open, as a ToggleButton does; a danger one keeps its red on a faint red tint (a guest's Cancel booking with its confirm open). `layout="row"` keeps each button its own, spaced and wrapping, for a card's few labelled actions (a booking's Reschedule, Copy guest link and Cancel booking on Bookings), so a screen never spaces buttons with markup of its own.
- `SplitButton` when the primary action has variants (Save, Save as new view). Its `menu` is a `Menu`; the chevron is named "More options" unless `menuLabel` says otherwise.
- Labels are verbs in sentence case: "Add to list", never "ADD" or "Submit".
- `CopyButton` says it worked in place (the owner, 22 October 2026: a toast far from the button went unseen): the icon turns to a check and the label to "Copied" for two seconds, at the width it had (Button's `labelReserve` keeps the longer label's room from the start, so nothing beside it moves), and a live region tells screen readers its `announcement` ("Link copied"; "Copied" by default). A refusal says "Couldn't copy. Select the link and copy it yourself." in an error toast and selects the source text; `failureMessage` replaces it where no link is shown to select (a record page's Copy link points to the address bar). "Copied" sits by its check, at the start of the reserved room. Every copy in the app goes through it: Field's `copy` variant, Code, LinkCard, the editors' header, a record page's header. `isLabelCollapsible` passes Button's own through, so in a narrow bar (an editor's header on a phone) only the icon shows, still named by `label` (22 October 2026: the form's name was cut to one letter beside the words). Stories: Default, Copied, IconOnly, LabelCollapsible, Failed, Disabled.
- A brand's mark alone (`provider` with `label`, no `children`) is an icon only button or link with the mark in the icon's place: a host's LinkedIn in SocialLinks (booking socials, 25 October 2026). Why: the row of a person's social links is marks only, and Button already drew a mark beside a label.
- `isIconMark` on an icon only Button draws its Lucide icon as a mark among brand marks: at the marks' size (`size-icon`) and in the text colour, as the black marks are (a person's website among their social links). Why not a plain ghost icon: at `size-icon-sm` in `text-secondary` it read as a quieter, lesser link beside the brands.
- `relations` on an external ButtonLink adds link types beside `noopener noreferrer`: `me` for a person's own profile, `nofollow` for a link a visitor didn't write.
- `labelReserve` on any Button keeps room for a second label it may swap to.
- `CopyButton` takes `isDisabled` when there is nothing to copy yet (a form never published, a row still on its way), so a row of actions keeps its shape.

Props: `children` (the label, a string) or `icon` with `label` (icon only), or `children` with `label` (a short label with a fuller name); `icon`, `iconRight`; `provider` (a brand's mark in the icon's place); `variant`; `size` (`md` 26px, `lg` 30px to sit beside an input and pressed at 32px through an invisible `::after` a pixel past its border all round, so a card footer's controls can't be missed (the owner, 20 October 2026), `sm` a chip's 20px for an icon only Remove beside a chip inside a field's box, such as a picker's chosen member; why: a 26px button in a 30px box crowded the chip it removes; `xl` 36px with the title's 15px label, only for a page's own call to action outside the app: the marketing site's hero and footer (23 October 2026); why: its 56px headline dwarfed a 30px button, and the app's screens never use it); `kbd` (one keycap or several); `onPress`; `isDisabled`; `isPending`; `type`; `form`; `aria-describedby`; `isFullWidth`; `isLabelCollapsible`; `tooltipWhenCut`; `slot`; `ref`.

- `isFullWidth` fills the row, with the label at the start and the keycaps at the end, for the sidebar's Quick actions. `isFullWidth="center"` fills the row with the label in the middle: a Form's submit on a sign in page, and the other ways to go on under it (Continue with Google). A container never stretches a button itself; it asks for this.
- `form` is the `id` of the form a `type="submit"` button sends when it sits outside it: a Modal's footer submitting the Form in its body (see Form's README).
- `label` beside `children` (on Button, ToggleButton and ButtonLink alike) names the button more fully than its visible word: Captures' create button reads "New" on both tabs, so switching tabs moves nothing (the owner, 21 October 2026), and is named "New booking page" or "New form". The name must start with the visible label, so speech input users can say what they see (WCAG 2.5.3, label in name). Why not a longer label: the tabs' buttons would differ in width.
- `aria-describedby` points at text that says more about the button, most often the line under a disabled one that says when it turns on ("You can send another in 42 seconds."), so a screen reader reads the two together.

## States

- **Hover**: `surface-hover` (the primary darkens to `accent-hover`), only on devices that can hover.
- **Pressed**: no shrink (the owner, 20 October 2026); a press reads through the hover and active colours. `scale-press` is 1, so nothing in the library scales on press.
- **Focus**: from the keyboard only, a 1px `accent-line` border (3:1 on every surface) plus the faint `shadow-focus` halo. Primary and danger keep their edge (blue, red), so their 1px `accent-line` ring sits just outside, past a 1px gap. In forced colours, a 2px `Highlight` outline.
- **Disabled**: at `opacity-disabled`, skipped by Tab, never pressed. When a line beside it says why or until when, `aria-describedby` ties that line to it.
- **Pending** (`isPending`): a spinner in place of the icon, presses ignored, still focusable, at `opacity-busy`. Screen readers hear the change. Change the label to the ongoing verb ("Saving"), unless the button must hold its width (Captures' New): then keep the label and give the button a `label`, and React Aria adds the spinner's "In progress" to its name ("New form In progress"). Without a `label`, whether "In progress" joins the name depends on the browser, so a kept label alone wouldn't reliably say anything changed.
- **Selected** (`ToggleButton`): `accent-soft` with an `accent` edge, which holds 3:1 against the surface (the artifact marks a pressed day with the accent too). It keeps that look while hovered. `aria-pressed` tells screen readers.
- **Shortcut** (`kbd`): the keycaps are for sight. The button states the shortcut through `aria-keyshortcuts` (`⌘↵` is `Meta+Enter`), so screen readers hear "Add to list", not "Add to list command return". On a touch only device (no hover, a coarse pointer) the keycaps are hidden: there are no keys to press. In a dialog at phone width (under 480px, where the footer stacks its buttons) they are hidden too, through Modal's public `modal-scrim` container (22 October 2026).

## Keyboard

- `Tab` and `Shift Tab` reach it (not when disabled).
- `Enter` and `Space` press it. On a `ToggleButton` they toggle it.
- `isLabelCollapsible` hides the label when the button's container is under 480px (a phone), leaving the icon alone in an icon only square; give it an `icon` and a `label`, which stays its name. Why a variant: the view bar's View settings must fit a phone beside the switcher and Table or Board, and only the button can hide its own label (the owner, 22 October 2026). While the label is hidden, hovering the icon shows it in a tooltip, the same one `tooltipWhenCut` opens (22 October 2026).
- `tooltipWhenCut` shows the whole label in a tooltip when the button is held narrower than its label (with `isFullWidth`, in a fixed width cell), measured only as the tooltip is about to open, like TruncatedText. Why: the sort and filter builders hold their attribute pickers to one width so rows line up (spec 0020), and a cut name must still be readable; a tooltip can't sit inside a button, so the button wraps itself.
- `autoFocus` gives it focus when it mounts: the safe choice a dialog opens on (Cancel beside Replace, spec 0020), since a dialog otherwise focuses itself and the first Tab lands on its close button.
- On a `SplitButton`, `Tab` moves from the action to the chevron; `Enter`, `Space` or `↓` opens the menu, `Esc` closes it and returns focus to the chevron. Disabled or pending, both halves wait together.

## Differences from the artifact

- `onPress` replaces `onClick`, and `isDisabled` and `isPending` replace `disabled` and `loading` (React Aria's names, so props pass straight through). Pending keeps the button focusable, where the artifact disabled it.
- `icon` and `iconRight` take registry names (`IconName`), so a typo is a type error.
- `provider` puts a brand's own mark (ProviderMark) where the icon goes, for an action named after that brand: `<Button provider="google">Continue with Google</Button>`, Add to Google Calendar. It is decorative there, since the label names the brand. Why a prop and not an `icon`: the marks are the brands' own artwork, not Lucide glyphs, so they never join the icon registry.
- The label is `children: string`. An icon only button takes `label` instead, and TypeScript refuses one without it; beside `children`, `label` gives a fuller name.
- No `className`, `style` or other HTML attributes pass through: one look, set here.
- `ButtonLink` is new (spec 0025, the guest's booking page): the same looks and sizes on a real link, so a new tab, a copied address and a download work as the browser's own. `href` passes `safeHref`; one that fails draws disabled.
- `ToggleButton` is new (the artifact had no pressed state), for format toolbars and view toggles.
- `SplitButton` takes its `menu` instead of an `onMenu` callback, so the menu opens from the chevron with focus handled by React Aria.
- No `disabledReason` tooltip yet: a disabled button gets no hover or focus, so a tooltip on it would reach no one by keyboard. Until a disabled button can stay focusable, write the reason beside it and tie it with `aria-describedby`, or put a `LockReason` beside it.
- The keycaps no longer read as part of the name, and the primary's keycap is edged instead of filled, so its text holds 4.5:1 (on the `on-accent-kbd` fill it was 3.3:1).
- The SplitButton divider on the primary uses `on-accent-kbd`, as the artifact does.
