# Menus

The Menu app's editor (spec 0065, H1), at `/w/<slug>/menus` while Menu is installed. Its layout and flow follow
checklabs' menu editor (owner, 4 Nov 2026), rebuilt from the library: the header with the status (Draft, then
Live or Hidden: a menu that hides every guest menu for now after a danger confirm, and shows it again at once), More
(open, copy link, QR code, Discard) and one Publish (Review and publish, or "Publish · 7 changes" once live); the menu
being edited picked in the header beside the title (a Select with New menu at its foot, checklabs' editor names its
menu there) and Settings as a header button (its view keeps `?tab=settings`, the tabs give way to it); then one level
of tabs, Structure, Items and Options (Items and Options are workspace wide). At a phone's width (`narrow.ts`) the bar
keeps the title, the picker, Settings as an icon, More and Publish; a draft's badge gives way. Where the screen stands is
in the address (`?menu=&tab=&at=&preview=off`).

- **MenusScreen**: Purpose: build menus and publish them. Main task: build a menu and publish it, watching the guest
  menu take shape in the phone beside it (the real `MenuList` drawing the draft, `preview.ts`, in the guests' own look
  from `/api/menu/look.css`, read at Preview at's day and time, `preview-at.ts`). Leaves out: presets (H5), QR codes
  per table (H2), import (H6), analytics (spec 0066). Until the first Publish it opens on a SetupChecklist (hours, which
  opens the place's own week, first menu, first dishes, then Publish, whose Review opens the review); Hide setup puts
  it away in this browser. A first menu comes with a first section. A new place starts with a restaurant's week (lunch
  and dinner, Tuesday to Sunday), so the hours step is done until someone changes it.
- **StructureTab**: after checklabs' Structure tab. The menu's sections as cards, each head a grip, the name, "N
  items", List or Grid as two icons and ⋯ (Edit, Add sub section, Move up and down, Delete), no numbers; its dishes in
  order (a grip each, the dish's photo or a quiet photo mark, never a letter tile; the row opens the dish; Sold out as a
  badge; ⋯ holds Edit, Mark sold out or available with a toast and Undo, Move up and down, Take out with Undo, Delete);
  "+ Add item" under the list turns into the search or create field in place (search what exists with the arrows,
  Enter places it; a new name makes that dish here; Escape on an empty field puts it back); its sub sections the same
  way. One dashed Add section at the foot. Deviations: no collapse chevron (a section's dishes always show; a long
  menu reads one section at a time in the preview), and adding finds an existing dish first (our dishes are shared
  across menus).
- **DishesTab** (Items): every dish, searchable, its photo tile, Available inline (checklabs' Visible switch; toast and
  Undo), New dish. Rows open the dish read only
  for Run service.
- **OptionsTab** and **GroupDrawer**: shared option groups (choose one, up to N, any; Guests must choose), checked
  inline before anything is sent.
- **SettingsTab**: name and places, serving times per day (`serving.tsx`, the library HoursEditor, starting from the
  place's hours), tax included and service added (the foot note follows them until the owner writes their own), and
  Delete.
- **SectionDrawer**: a section's name, line, layout and serving times (narrower than the menu's).
- **ItemDialog**: one dish in a drawer, in checklabs' order: name, photo (cropped as it is chosen in the shared cropper, shape `dish`, with Adjust crop on a photo
  already there; held until Save, so Cancel undoes it), price
  (the first size takes it; each size's price shows its currency), calories, description, sizes, option groups, allergens, dietary marks, Popular.
- **PublishDialog**: Review and publish: each check with Fix (hours, a dish on a menu, every dish priced, every menu
  shown somewhere, the last also refused by the server); with every check passed, a success line naming what goes live
  ("Guests will see 2 dishes on Dinner.") under the count of changes; Publish, then the live link with Copy and its QR code.
- **drawer.tsx**: every drawer asks before throwing typed changes away, and so does leaving the page.
