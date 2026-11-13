# Popover

The floating surface menus, selects, pickers and "+N" lists open in.

## Why it exists

New. The artifact draws each menu's surface itself and animates it in only. One popover gives every overlay the same surface, the same placement and the exit animation the artifact lacks (house rule 8), so Menu, Select, DatePicker and TagList don't each style their own.

## Use

```tsx
<DialogTrigger>
  <Button>Filter</Button>
  <Popover label="Filter">…</Popover>
</DialogTrigger>
```

- Put a `Menu` or `ListBox` straight inside; give `label` for any other content, and it opens as a dialog with that name.
- `width`: `content` (the default), `menu` (240px, or the trigger's width when wider), `list` (exactly that width, so long options wrap: Select's `optionDescription="below"`), `trigger` (at least the trigger's width and wider when an option needs it, so an option never wraps: a select), `panel` (`size-dialog`, never past the window, for a few SettingsRows with their controls at the end: the Members page's Scheduling access, spec 0037; why: at `list` width each row's level Select and Remove dropped under its name, so the rows read as broken; under the dialog's width, a phone, the popover meets the window and the rows stack their controls under the text, as SettingsRow does in any narrow column), `builder` (`size-dialog-wide`, never past the window, for a view's FilterBuilder or SortBuilder). Why `builder`: those size themselves by container query, so shrink to fit gave them no width at all and their fields collapsed (spec 0020's Toolbar).
- `placement` follows React Aria (`bottom start` by default) and flips when there is no room.
- `triggerRef` anchors it to an element that isn't a React Aria trigger (a context menu's row).
- What it holds knows it is in a popover (`InPopover`, a context): a Field or a Select there draws its focus with its accent border alone, no halo, since the popover's edge already frames it (the owner, 21 October 2026: a halo inside a grid cell's editor read as a second ring). Modal sets it back to false for what it holds.
- Layer: popovers and dialogs share one layer (`z-modal`), so whichever opened last is on top: a Select's list over the Modal it sits in, a Modal over the popover it came from. React Aria's own inline z-index (100000) drew every popover over every dialog. Still, an action in a popover that opens a dialog closes the popover first (the Bookings week card's Reschedule, Cancel booking and Reassign), so focus moves into the dialog and nothing is left open behind it.

## States

Opening grows it from its trigger in `duration-popover`; closing fades it in `duration-exit`. Opened from the keyboard it appears and leaves at once. Reduced motion keeps the fade and drops the growth.

## Keyboard

Esc closes it and returns focus to the trigger. Focus stays inside while it is open (unless `isNonModal`).

## Differences from the artifact

- Not a card in the artifact; it takes over the surface `ws-menu` drew, with an exit animation.
- Its gap to the trigger is a `space-4` margin on the placed side, so it comes from a token.

## Insets

Every popover shares one padding scale from `styles/base.css`: a list (Menu, Select's options) sits `--popover-inset` (`space-6`, the prototype's, since spec 0072's tier 2) inside the edge, each row pads `--popover-item-block` and `--popover-item-inline` (`space-4`, `space-8`), so text starts at `--popover-text-inset` (14px). A Popover dialog (pickers, tips, view settings, filters, sorts) pads `--popover-panel-inset` (`space-8`), and a row inside one pads up to `--popover-text-inset`, so its text lines up with a menu's. Never pad a popover's content again from a screen.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Popover: `surface-raised`, a `border-subtle` hairline, `radius-xl` and `shadow-md`, in body type. Motion is transitions.dev 05 menu dropdown as the prototype's CSS has it: it grows from the trigger's anchor point, `scale-medium` to 1 over `duration-fast` on `ease-smooth-out`, and leaves to `scale-tiny` with a fade over `duration-quick`, ignoring the pointer while it goes. Reduced motion keeps the fade and drops the scale.

**Two looks until the guest phases (spec 0072, decision 16).** Guests draw Popover too (a hosted form or a booking page), and guest pages keep their shipped look and cost until their own port phase (6 to 8). So `Popover.module.css` is the shipped look, which every page loads, and the prototype's look described here is `Popover.app.css`: the module's own class names, in the `utilities.app-look` layer, only under `<html data-scale="app">`, loaded by `src/app-look.ts` from the app's layouts and the stories. Change the app's look there, and the shipped look in the module; `app-look.test.ts` keeps their class names in step. The two merge back into the module when the guest pages take the prototype's look.

**Use it for** a short panel tied to a button (share, notify, a filter), inside a `DialogTrigger` with `label`. Menu, Select, DatePicker and IconPicker already render it; never wrap them again. **Don't use it for** a form of several steps (a Modal) or an icon's hover label (Tooltip).

**States**: closed, opening, open, closing; opened from the keyboard it appears and leaves at once (house rule, the prototype animates either way).

**Differences from the prototype**
- `width` keeps the library's `content`, `menu`, `list`, `trigger`, `panel` and `builder`; the prototype's `panel` (`size-panel`) is the library's `panel` at `size-dialog`.
- The prototype's `pickfield` trigger lives in Field, Select and Button's `field` variant here; its `PopoverSearch` is Menu's and Select's search row.
- Kept beyond the prototype: `isNonModal`, `triggerRef`, the `InPopover` context (a field inside draws its focus with its edge alone), the dialogs' z layer and keyboard instant opening.
