# Menus

The Menu app's editor (spec 0065, H1), at `/w/<slug>/menus` while Menu is installed. Its layout and flow follow
checklabs' menu editor (owner, 4 and 5 Nov 2026), rebuilt from the library: the header with the status (Draft, then
Live or Hidden: a menu that hides every guest menu for now after a danger confirm, and shows it again at once),
Settings, ⋯ (Discard changes while there are drafts, Delete menu) and one split Publish: "Publish & go live" before the
first publish (through the review), then "Publish · 3 drafts", which publishes at once unless something blocks it (then
the review says what), else "View", which opens the guest menu; its chevron holds Open in new tab and Show QR code. The
menu being edited is picked in the header beside the title (New menu at its foot) and Settings is a header button (its
view keeps `?tab=settings`). The status is a dot and a word, as an editor's status reads elsewhere. Then one level of
tabs as the page's second bar (`variant="bar"`, as Bookings' and Captures'), Structure, Items and Add-ons (Items and
Add-ons are workspace wide), with a search at its far end over Structure and Items, and one panel, so the phone stays
as the tabs change. At a phone's width (`narrow.ts`) the bar keeps the title, the picker, the status as an eye, ⋯ (with
Design and Settings) and Publish; a draft's status and the search give way. Where the screen stands is in the address
(`?menu=&tab=&at=&preview=off`). Every string says "item", never "dish". While it loads, `MenusPending.tsx` draws the
same frame in skeletons, its regions within 4 px of the loaded ones.

- **MenusScreen**: Purpose: build menus and publish them. Main task: build a menu and publish it, watching the guest
  menu take shape in the phone beside it (the real `MenuList` drawing the draft, `preview.ts`, memoised so typing
  elsewhere never draws it again, in the guests' own look from `/api/menu/look.css`, read at Preview at's day and time,
  `preview-at.ts`). Leaves out: the guest look (DesignScreen), QR codes per table (H2), import (H6), analytics (spec 0066), Duplicate
  menu (no write for it yet). Until the first Publish it opens on a SetupChecklist (hours, which opens the place's own
  week, first menu, first items, then Publish, whose Review opens the review); Hide setup puts it away in this browser.
  A first menu comes with a first section.
- **StructureTab**: after checklabs' Structure tab, in our own look (6 November 2026). The menu's sections as one Card each (no card in a card): the chevron and name fold it, quiet words beside them ("N sub sections · N items", and Photo grid when it is one), ⋯ always at the end (Edit, Show as a list or grid, Add sub section, Move up and down, Delete), and its grip and Edit waiting for the pointer or focus (all open at first, as checklabs opens them). Its items in order (`LinkList density="media"`): a 48px photo you can recognise, or a quiet photo mark, the row opening the item whose drawer holds the photo picker; the name with Sold out by it (the row stepping back), allergens, how many sizes and where else it sits as one quiet line, and the price on one right edge (sizes as a range, a price note quieter, No price in danger). The grip, a quick Mark sold out or available (toast and Undo) and ⋯ (Edit, the same Mark, Move up and down, Take out with Undo, Delete) wait for the pointer or focus, and simply stand there on touch, which keeps ⋯ and the grip. A quiet "+ Add item" is the list's last line, turning into the search or create field in place; its sub sections follow in the same Card, parted by a hairline. One dashed Add section at the foot. The tab bar's search keeps a section whose name matches whole, else its matching sub sections and items, open, with moving off until the search is cleared; nothing found says so. Empty: "Set up your menu". Deviations from checklabs: no dashed slot, the row itself opening the photo picker; List or Grid in ⋯, not two icons on every head; sub sections don't fold; and adding finds an existing item first (our items are shared across menus).
- **DishesTab** (Items): a card "All items" with "{n} available" and New item, then a table in the order the menus read
  (the menu shown first, its sections then their sub sections, then the other menus, then items on no menu): Item
  (its photo and name), Section ("Mains · Grill", "+1" when it sits in more), Price (sizes as a range), Available (a
  switch, toast and Undo) and ⋯ (Edit, Delete). Rows open the item, read only for Run service, who get no ⋯. At a phone's width the table gives way to rows like Structure's: the photo, name, where it sits, price, the switch and ⋯.
- **OptionsTab** and **GroupDrawer** (Add-ons on screen, a plainer word than option groups, owner, 6 November 2026): one
  Card as the Items tab's, "Add-ons" with "Choices guests can pick. Required ones need a pick." and New add-on, then the
  shared add-ons on a line each (choose one, up to N, any; Guests
  must choose), checked inline before anything is sent; none yet is an empty state in the Card.
- **SettingsTab**: name and places, serving times per day (`serving.tsx`, the library HoursEditor, starting from the
  place's hours), tax included and service added (the foot note follows them until the owner writes their own), and
  "Phone and region": the business profile's phone, the currency and the place's time zone, read only, with Edit in
  Business. Delete menu is in the header's ⋯.
- **SectionDrawer**: a section's name, line, layout and serving times (narrower than the menu's).
- **ItemDialog** (and `item-form.ts`, its rules as plain data): one item in a drawer, in the order a person fills it (owner, 6 November 2026, "much more better", "easier to understand", "if something has many options make it a dropdown"). The title is the item's name as typed, "New item" before. Name, description, then the price: first how (One price, Sizes or Other, a SegmentedControl labelled Pricing), then the box or the size rows for that kind alone, so nothing reads as a locked box (review, 9 November 2026): only the kind chosen is saved, so an item can't hold a price and a price text at once, and switching loses nothing typed (the first size takes the price, and back). The currency sits in the box. Then the photo (`FileDrop variant="photo"`: drop, paste anywhere in the sheet, or click; the picture 200px wide once chosen, with Change, Adjust crop and Remove, all held until Save, so Cancel undoes them; cropped as chosen in the shared cropper, shape `dish`). Under a hairline, what is in it, four closed dropdowns (`Select showsMarks`) that name what is chosen in plain words, in full, or a quiet None: Contains allergens and May contain allergens (checkboxes, with a search; a contained allergen shows "Already in Contains" in the other list and can't be picked there, and becoming contained takes it out of may contain), Dietary (checkboxes; a quiet line when a mark and a contained allergen can't both be true, such as Vegan with Milk) and Spice level (radios, one at most). Under another hairline, Add-ons (checkboxes; New add-on at the list's foot opens GroupDrawer over this drawer and comes back with it picked), Calories, Available (sent as the item saves, live at once with Undo, and once changed it says so, "Guests see the change at once.", since nothing else in the sheet goes live without Publish; Run service's switch acts at once) and Popular. A new item's footer has Add another, New record's own pattern: each save says so in a toast and starts the next item with focus in Name. ⌘↵ saves from anywhere. Problems show from the first Save tried, go as each is fixed, and each refused Save moves to the first one. Busy until every part has gone. No serving size: the model has none.
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
