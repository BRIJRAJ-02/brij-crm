# Menus

The Menu app's editor (spec 0065, H1), at `/w/<slug>/menus` while Menu is installed. Its layout and flow follow
checklabs' menu editor (owner, 4 and 5 Nov 2026), rebuilt from the library: the header with the status (Draft, then
Live or Hidden: a menu that hides every guest menu for now after a danger confirm, and shows it again at once),
Settings, ⋯ (Discard changes while there are drafts, Delete menu) and one split Publish: "Publish & go live" before the
first publish (through the review), then "Publish · 3 drafts", which publishes at once unless something blocks it (then
the review says what), else "View", which opens the guest menu; its chevron holds Open in new tab and Show QR code. The
menu being edited is picked in the header beside the title (New menu at its foot) and Settings is a header button (its
view keeps `?tab=settings`). Then one level of tabs, Structure, Items and Options (Items and Options are workspace
wide), with a search in the tab bar over Structure and Items. At a phone's width (`narrow.ts`) the bar keeps the title,
the picker, Settings as an icon, ⋯ and Publish; a draft's badge and the search give way. Where the screen stands is in
the address (`?menu=&tab=&at=&preview=off`). Every string says "item", never "dish".

- **MenusScreen**: Purpose: build menus and publish them. Main task: build a menu and publish it, watching the guest
  menu take shape in the phone beside it (the real `MenuList` drawing the draft, `preview.ts`, memoised so typing
  elsewhere never draws it again, in the guests' own look from `/api/menu/look.css`, read at Preview at's day and time,
  `preview-at.ts`). Leaves out: the guest look (DesignScreen), QR codes per table (H2), import (H6), analytics (spec 0066), Duplicate
  menu (no write for it yet). Until the first Publish it opens on a SetupChecklist (hours, which opens the place's own
  week, first menu, first items, then Publish, whose Review opens the review); Hide setup puts it away in this browser.
  A first menu comes with a first section.
- **StructureTab**: after checklabs' Structure tab. The menu's sections as cards, each head a grip, the name, "N sub
  sections · N items" (sub sections only when it has some), Edit, List or Grid as two icons (in ⋯ at a phone's width),
  ⋯ (Add sub section, Move up and down, Delete) and a chevron that folds the section (all open at first, as checklabs
  opens them); its items in order (a grip each, the item's photo or, for someone who can add one, a dashed "+" slot;
  the row opens the item; a second line of chips: its price or each size's, a price note, what it contains, where else
  it sits; No price as a badge by the name, Sold out at the end; ⋯ holds Edit, Mark sold out or available with a toast
  and Undo, Move up and down, Take out with Undo, Delete); a bordered "+ Add item" under the list turns into the search
  or create field in place; its sub sections the same way. One dashed Add section at the foot. The tab bar's search
  keeps a section whose name matches whole, else its matching sub sections and items, open, with moving off until the
  search is cleared; nothing found says so. Empty: "Set up your menu". Deviations: the "+" slot is the row's own tile,
  not a second control (the row opens the item, whose drawer holds the photo picker), sub sections don't fold, and
  adding finds an existing item first (our items are shared across menus).
- **DishesTab** (Items): a card "All items" with "{n} available" and New item, then a table in the order the menus read
  (the menu shown first, its sections then their sub sections, then the other menus, then items on no menu): Item
  (its photo and name), Section ("Mains · Grill", "+1" when it sits in more), Price (sizes as a range), Available (a
  switch, toast and Undo) and ⋯ (Edit, Delete). Rows open the item, read only for Run service, who get no ⋯.
- **OptionsTab** and **GroupDrawer**: "Option groups" with "Choices guests can pick. Required groups need a pick." and
  New group, then the shared groups (choose one, up to N, any; Guests must choose), checked inline before anything is
  sent; none yet is a centred empty state.
- **SettingsTab**: name and places, serving times per day (`serving.tsx`, the library HoursEditor, starting from the
  place's hours), tax included and service added (the foot note follows them until the owner writes their own), and
  "Phone and region": the business profile's phone, the currency and the place's time zone, read only, with Edit in
  Business. Delete menu is in the header's ⋯.
- **SectionDrawer**: a section's name, line, layout and serving times (narrower than the menu's).
- **ItemDialog**: one item in a drawer, in checklabs' order: name ("e.g. Grilled Salmon"), photo (cropped as it is
  chosen in the shared cropper, shape `dish`, with Adjust crop on a photo already there; held until Save, so Cancel
  undoes it), price with Available beside it (sent as the item saves, live at once with Undo; Run service's switch acts
  at once), calories, description, sizes, option groups as chips with "New option group", which opens GroupDrawer over
  this drawer and comes back with the group picked, allergens, dietary marks, Popular. Busy until every part has gone.
  No serving size: the model has none.
- **PublishDialog**: Review and publish: each check with Fix (hours, an item on a menu, every item priced, every menu
  shown somewhere, the last also refused by the server); with every check passed, a success line naming what goes live
  ("Guests will see 2 items on Dinner.") under the count of changes; Publish & go live (Publish once live), then the
  live link with Copy and its QR code, which Show QR code opens straight onto.
- **DesignScreen** (`/w/<slug>/menus/design`, Design in the Menus header, spec 0065, AC-6570 as amended): Purpose: how
  the business's guest menu, reservation page and business page look. Main task: pick a preset, change its colours,
  fonts, corners or cover if wanted, see it at once in the phone (the real `MenuList`, with made up dishes before a menu
  has any), and Save (`SaveBar`, with the data layer's optimistic write and rollback; live at once, no Publish). Leaves
  out: per part colours, importing a look from an address, and anything about a menu's contents. Presets as TileGrid
  `choice` tiles with `MenuLookThumbnail`; each colour an AccentPicker, its default the preset's own, with a StatusDot
  saying AA as picked and one warning Callout when any fails (guests still read words at 4.5:1, `menuLookRoles`); Light
  and Dark above the phone only for a look that follows the guest; the cover through the shared cropper, 3:1, held until
  Save. Run service sees it read only.
- **drawer.tsx**: every drawer asks before throwing typed changes away, and so does leaving the page.
