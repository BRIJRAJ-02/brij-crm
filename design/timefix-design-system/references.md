# References

Real-product screens and flows this system borrows from, saved in the Mobbin collection “Timefix design system references (Nov 2026)”: https://mobbin.com/collections/9f90e362-afb4-4c75-b13e-9154e9c19ee6/web/screens. Each line names one concrete thing to borrow. Pixel figures were read from previews; the tokens are the source of truth.


Mobbin collection (private, only you and your team can open it): https://mobbin.com/collections/9f90e362-afb4-4c75-b13e-9154e9c19ee6/web/screens

There are 40 screens and 4 flows, all web. Measurements are read from Mobbin previews, so treat them as approximate and check them against the full-resolution image before you turn one into a token.

## 1. Buttons, icon buttons, segmented controls, tabs

- **Vercel: Firewall rules, "Basic / Deep Analysis" switch**: https://mobbin.com/screens/e17aa7d9-4bf4-4cd1-b0c2-46d34054202e
  Borrow: the segmented control sits in a grey track (2 to 3px inset). The active segment is a white raised pill, the inactive ones are text only, and it is the same height as the select next to it (32px). Use this for our pill crossfade.
  Avoid: the red filled buttons in the danger zone. Keep destructive actions in the row and confirm in a Modal.
- **Attio: Person record, tabs with counts**: https://mobbin.com/screens/5238692f-ff70-4de6-b82f-f3481b44a46b
  Borrow: tabs are icon plus label plus a grey count chip. The active tab gets a 2px ink underline and the label weight stays the same, so the width never jumps.
- **Calendly: Scheduling, header actions**: https://mobbin.com/screens/bed6bec0-49f9-4ec4-ac4f-e9a684412c62
  Borrow: one ink primary ("+ Create") next to one outlined secondary, at the same 36px height with icon and label. Below them, underline tabs sit 16px under the title.
  Avoid: the blue support bubble, which overlaps content.

## 2. Text fields, selects, comboboxes, date and time, OTP, phone

- **Attio: Company record, inline category combobox**: https://mobbin.com/screens/8353ecb1-c4e5-4896-b1f6-6f8d1622876b
  Borrow: the attribute value turns into a search input in place, and the matches show as tinted tags with the hovered row washed. The label column stays fixed at about 110px.
- **Cal.com: Availability, time select open**: https://mobbin.com/screens/ebe6e03c-2a8c-44ff-ad66-ef3f6e5ecc04
  Borrow: the time list scrolls so the current value sits last, with its check on the right. Steps are 15 minutes and the trigger keeps its focus ring while the list is open.
- **Square: New project, date picker**: https://mobbin.com/screens/a70f34a5-376f-4725-a8a3-d50564ee17b2
  Borrow: Start and End inputs sit under the month grid, with an "All day" checkbox and a "Clear" text button. The selected day is a filled 28px circle and the arrows are 28px round buttons.
- **Base: Confirm email, OTP**: https://mobbin.com/screens/ecb9ac37-d300-48db-97c0-3825ae7eefd5
  Borrow: six 32x40px cells on a grey fill. Only the focused cell gets the ink ring and caret, and "Resend" stays quiet above a full-width ink button.
- **Klaviyo: Company contact, phone field**: https://mobbin.com/screens/2567d986-85f8-4622-b656-7a8d9e432a2d
  Borrow: one bordered field split into a flag plus chevron segment and the number, with "+1" shown as fixed grey text inside the field.
- **Linear: Project milestone, compact date pick**: https://mobbin.com/screens/fb59ac32-54a6-4539-8a03-450addb61b6d
  Borrow: a small calendar (about 24px cells) anchored to an inline "Target date" input, with today in a grey circle. Properties on the right read as quiet label/value rows with no borders.

## 3. Menus, context menus, popovers, tooltips, command palette

- **Linear: Document "…" menu with "Move to" submenu**: https://mobbin.com/screens/f1e8745b-81b7-4a78-85e1-a325f4843f42
  Borrow: a filter input at the top of the submenu, grouped headers (Projects / Initiatives), shortcut hints right aligned in grey, and the current item marked with a trailing check.
- **Mercury: Keyboard shortcuts popover**: https://mobbin.com/screens/f3cc6753-dc1c-49ec-babb-99599b85f605
  Borrow: rows of about 36px with keycaps on the right, a hairline divider, and a "See all shortcuts" link as the last row. The icon trigger stays pressed while it is open.
- **Superhuman: Command**: https://mobbin.com/screens/85dc5994-9360-428d-9092-7425e070ed7f
  Borrow: the input is visually the heading, each action shows its single-key shortcut, and the selected row gets a full-width wash with no border.
  Avoid: the monospace dark theme. Keep our light card with an ink selection wash.
- **Magnific: Command palette**: https://mobbin.com/screens/14ceb943-f04a-460f-b4f5-2ebd78d74aff
  Borrow: Recents above Quick actions, and a footer hint bar ("↑↓ Navigate, ↵ Select, Esc Close") at 11px on a grey strip.
- **Vercel: Select with described options**: https://mobbin.com/screens/ea282960-1a1c-4184-b63a-353af7f8772f
  Borrow: each option is a medium label over a grey one-line description, with a check on the right and about 8px between options. Use this for role and permission pickers.
- **Miro: Table column header menu**: https://mobbin.com/screens/1e777c3f-78e9-44b3-a7d0-030f9038c7ae
  Borrow: the menu order is Edit field, Sort asc/desc, Group by, Hide, then Duplicate and a red Delete last, separated by dividers. The header stays outlined in blue while the menu is open.

## 4. Dialogs, drawers, toasts with Undo, floating bars

- **Attio: Remove records confirm**: https://mobbin.com/screens/f6aa5c36-a41b-432f-a620-5248fb8bc7b0
  Borrow: a small 240px dialog with a bold title that states the count ("Remove 3 records from list"), one consequence line, and Cancel (text) next to a red primary in the bottom right. The selection stays visible behind the dialog.
- **Attio: Contacts table, floating bulk bar**: https://mobbin.com/screens/5bb2a956-b937-497e-bd31-afc2616bb111
  Borrow: a bottom-centred floating pill holding a "3 selected" count chip, 3 actions, "More ⌄" and a close ×. It overlaps the footer and gives selected rows a pale blue wash.
- **Calendly: Edit contact drawer**: https://mobbin.com/screens/1348f031-6be2-40f2-8aee-96f5f0c76b04
  Borrow: a right drawer of about 380px with a sticky footer: Delete on the left (red text plus icon), Cancel and an ink "Save changes" on the right. Optional fields are marked "(Optional)" rather than marking required fields with asterisks.
  Avoid: the country list modal stacked on top of the drawer. Use an anchored popover.
- **Height: Unsaved view changes bar**: https://mobbin.com/screens/a6c7db3c-5e47-4edf-9862-ed8dcc6e9e5b
  Borrow: a bottom-right card with a title, a one-line consequence ("Saving will update the view for everyone"), and Revert / Save as… / Save. Use it as our save bar.
- **Cal.com: "Copy times to" popover**: https://mobbin.com/screens/6e701606-98b1-46ee-a1b1-72c1a257b108
  Borrow: a popover with an uppercase 11px header, a checkbox list with Select All, and Cancel plus an ink Apply in the footer. The anchor icon button stays pressed and outlined while it is open.

## 5. Data table, filters, board and drag

- **Linear: View with the filter menu open**: https://mobbin.com/screens/ed670cda-0527-4716-a1a6-0159f12c4f42
  Borrow: the filter menu starts with "Add Filter…" and an F shortcut hint, then lists properties with their icons, each with a submenu chevron. Group headers ("In Progress 5") are 32px grey bands with a status icon and count.
- **Linear: Applied filter chip and hidden count**: https://mobbin.com/screens/9dab540b-f7d4-47d4-be77-5facc75f89fa
  Borrow: the chip reads "Status · is · In Progress ×" as three hit areas, with a "+" to add the next filter. The list says "14 issues hidden by filters, Clear Filters" where rows would be.
- **Attio: Deals board card**: https://mobbin.com/screens/c9b96d38-5a3a-42a0-826d-d1399639f468
  Borrow: the column header is a status dot, name and count chip, with + and drag-handle icons on the right. The card is a white 8px-radius tile with icon-led attribute rows and a quiet footer icon strip.
- **Attio: Board with collapsed columns**: https://mobbin.com/screens/287163e2-763b-40de-b658-d9d3eb757ad1
  Borrow: empty columns collapse to 24px rails with vertical titles and counts, so the board stays scannable when stages are sparse.
- **Jira: Moving a task (flow)**: https://mobbin.com/flows/bc08701d-f5f3-4b98-beef-584970abe4dc
  Borrow: the lifted card tilts about 3 degrees and gets a stronger shadow, the source spot fades to a ghost, and the target column gets a 2px blue outline with the header reading "CONCEPTING → DESIGN".
  Avoid: the saturated blue board background.

## 6. Record page, activity, comments, notes, tasks

- **Attio: Company activity with attribute diff**: https://mobbin.com/screens/297adfeb-8312-496b-8acf-41839a6cf775
  Borrow: "changed Stage and 7 other attributes" expands into "old → new" rows with attribute icons, closes with a "Hide all changes" pill, and is grouped under "This week" date dividers.
- **Attio: Person overview highlights**: https://mobbin.com/screens/b4729369-cc37-4b1d-b51e-75954a6ff5c7
  Borrow: a 3x2 grid of small highlight cards with a grey label, a top-right icon and a value or an "empty" grey line. Notes (0) and Tasks (1) are collapsible sections with a + on the right.
- **Attio: Comments side panel**: https://mobbin.com/screens/2777225d-7e4a-43bd-a3bc-6d056423c1f1
  Borrow: the comment row icon shows a count (speech icon "1") in the table cell. The panel shows the thread and a composer, and hover actions (react, resolve, …) appear on the comment.
- **Linear: Issue with sub-issues and activity**: https://mobbin.com/screens/f00cc4fb-4083-43fc-a0fb-703a6c4ef771
  Borrow: sub-issues have a "0/4" progress ring and rows with status circle, label chips and estimate. Activity lines are 12px grey "X created the issue · 53min ago" above comment cards.

## 7. Sidebar, workspace switcher, settings, onboarding, empty states

- **Attio: Workspace switcher menu**: https://mobbin.com/screens/a1b79e12-966a-430e-a38b-a8bf72a6be89
  Borrow: the current workspace is checked in blue at the top, "+ Add new workspace" comes next, then Account / Workspace settings, a Theme submenu that shows its current value ("System"), and Sign out last.
- **Vercel: Authentication settings**: https://mobbin.com/screens/fe7d7e6e-ad12-48be-bc7f-d3e6ec6297c7
  Borrow: section cards with a title, a one-line description and rows inside a nested bordered list (icon, title, grey sub-line, one action on the right). A "More options" disclosure row ends the list, and the status tag ("Active") sits in the section header.
- **Searchable: Getting started checklist**: https://mobbin.com/screens/b3079404-1529-49f4-b72b-e83535cbe016
  Borrow: "2 of 6 completed" with a thin green bar. Done steps get a green check and strike-through, open steps a dashed circle (our draft shape). Each step expands to show one tinted action pill, and the sidebar has a mini "Getting Started 2 of 6" card with ×.
- **Attio: Board empty state**: https://mobbin.com/screens/825e0cb8-4059-4f66-a6e7-6cad2284621b
  Borrow: an outlined line illustration of about 64px, then "No records yet", one sentence, and a pair of actions: secondary "Import CSV" next to primary "New Deal". A "Learn more" card sits below.

## 8. Scheduling

- **Cal.com: Booking page, month and slots**: https://mobbin.com/screens/43d909f7-c988-4ed8-a530-0bc1b17f0067
  Borrow: three panes (details, month, slots). Available days are grey-filled 36px squares and the selected day is ink. Slots are 32px outlined pills with a green dot, and a 12h/24h segmented control sits beside the day title. Duration chips (1h / 1h 15m) live in the details pane.
- **Cal.com: Business Hours with split ranges**: https://mobbin.com/screens/540c3f6a-48fe-4df4-872a-9ac422d31e1b
  Borrow: each row is a switch, the day, start–end inputs, + and copy icons. A second range stacks under the first with a trash icon, and the summary under the title updates ("Mon, Thu - Fri, 8:00 AM - 1:00 PM").
- **Calendly: Meetings list with a toast and Undo**: https://mobbin.com/screens/bb0c5972-8b98-48be-bbd0-0431b2a566b4
  Borrow: day groups with a "Today" chip, a blue now-line with end dots between meetings, an "Up next" label on cards with a colour stripe, and a detail drawer on the right. The toast reads "2 emails sending individually · Undo".
  Avoid: the green filled toast. Ours is ink.
- **Calendly: Event types, row hover**: https://mobbin.com/screens/0fd5b8fa-d3e5-4075-9558-cb2c86668cfd
  Borrow: hovering a meeting card shows four extra icon actions before "Copy link" and adds a pale blue wash. Cards have a 6px colour stripe on the left and the meta reads "1 hr · Google Meet · Group".
- **Calendly: One-off meeting week grid**: https://mobbin.com/screens/54e3901e-5c39-4569-b618-5426f3d4b9ab
  Borrow: unavailable hours are hatched (diagonal stripes, not grey blocks), "+ Add times" sits under each day header, and a small "Unavailable" chip marks the slot.
- **Klaviyo: Campaign calendar week**: https://mobbin.com/screens/6b3dd16e-7760-46c9-9f32-6d6852777fa0
  Borrow: today is an ink circle on the date number, and events are white cards with a 2px coloured outline and stripe, a title, a sub-line and a time. Filter dropdown chips run across the toolbar.

## 9. Charts, stats, progress, skeletons

- **Mercury: Books overview**: https://mobbin.com/screens/fa7bec0e-b6aa-48cf-8f1a-2dd89a1c7601
  Borrow: the stat card is a 13px label, a 28px number, then a grey delta line ("+$115 vs prior period"). Breakdown rows carry a thin inline bar under the label with the share in % on the right. Lines are 1.5px with no gridlines.
- **Mercury: Empty or loading charts**: https://mobbin.com/screens/f7740c28-3995-422a-bc34-d10f4bc8c483
  Borrow: before data arrives, the charts draw as dotted grey placeholder curves and bars, and values show as "—". The layout never shifts when real numbers land.
- **Searchable: Checklist progress** (above, family 7) is the thin progress bar reference.

## 10. Micro-interactions (flows)

- **Amazon: Deleting an item**: https://mobbin.com/flows/41db0b39-0a7e-4faf-9859-b85c12ef66d8
  Borrow: the deleted row collapses in place to a one-line "✓ Deleted · Undo" strip, so Undo sits exactly where the user looked. Pair this with our collapse-on-remove.
- **Amie: Deleting a todo**: https://mobbin.com/flows/8a41c48d-ed44-4397-805d-10e083d92632
  Borrow: the row "…" trigger stays pressed while its menu is open (single-key shortcuts D, H, ⌘C), then a compact toast with a red icon tile says what happened and where ("Deleted from Inbox").
- **Obvious: Moving a board card**: https://mobbin.com/flows/2e1e0ac6-857f-455b-b472-bc685f074a25
  Borrow: a drag lift with a soft shadow and no tilt, while the source card stays as a faded copy. The column count updates on drop (2 → 3). This is the calmer alternative to Jira's tilt.
- **Calendly: Undo toast** (family 8) and **Jira: target column header "A → B"** (family 5).

## Patterns across all references

- Each product has one ink (near-black) primary per view and everything else is outlined or text. Calendly, Cal.com, Vercel and Square all hold to this.
- Blue appears only for selection (selected rows, focused cells, the current workspace check, the now-line). It is never decorative, which matches our rule.
- Menus are about 36px per row, with grouped headers, right-aligned grey shortcut hints, a trailing check for the current value, and destructive items last under a divider.
- Triggers stay visibly pressed or outlined while their popover is open (Cal.com copy, Miro header, Mercury shortcuts, Amie "…").
- Selections get a pale blue row wash, and bulk actions arrive as a floating bottom-centre pill with a count chip and ×.
- Undo is offered in context: a toast with "Undo", or the row collapsing to "Deleted · Undo" in place, with no confirm dialog for reversible deletes.
- Empty, loading and zero states keep the final layout (dashed placeholders, "—" values, collapsed 24px rails), so nothing jumps when data lands.
- Record pages pair a fixed label column (about 110px, grey icon plus label) with values that edit in place, and attribute changes appear in activity as "old → new" diffs.
- Scheduling surfaces show availability as shape and texture (grey-filled available days, hatched unavailable hours, dot-prefixed slot pills) rather than as colour alone.
- Settings are bordered section cards: a title and one-line description, rows with a grey sub-line and one right-aligned action, and status tags in the section header.
- Checklists use shape for state (dashed circle open, green check done, strike-through label) with an "n of m" counter and a thin progress bar.
- Drag uses lift, a ghost source and a clearly outlined target. Take the calmer no-tilt version (Obvious) and borrow Jira's "From → To" header for clarity.
