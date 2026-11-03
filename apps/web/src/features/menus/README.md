# Menus

The Menu app's editor (spec 0065, H1), at `/w/<slug>/menus` while Menu is installed. Its layout and flow follow
checklabs' menu editor (owner, 4 Nov 2026), rebuilt from the library: the header with the status (Draft, then
Live or Hidden: a menu that hides every guest menu for now after a danger confirm, and shows it again at once), More
(open, copy link, QR code, Discard) and one Review and publish; the menus as tabs with New menu; then each menu's
Structure, All dishes, All options (both workspace wide, so named) and Settings. At a phone's width (`narrow.ts`) the
bar keeps the title, the status, More and Publish: New menu moves into More and the count of changes waits in the
review. Where the screen stands is
in the address (`?menu=&tab=&at=&preview=off`).

- **MenusScreen**: Purpose: build menus and publish them. Main task: build a menu and publish it, watching the guest
  menu take shape in the phone beside it (the real `MenuList` drawing the draft, `preview.ts`, in the guests' own look
  from `/api/menu/look.css`, read at Preview at's day and time, `preview-at.ts`). Leaves out: presets (H5), QR codes
  per table (H2), import (H6), analytics (spec 0066). Until the first Publish it opens on a SetupChecklist (hours, which
  opens the place's own week, first menu, first dishes, then Publish, whose Review opens the review); Hide setup puts
  it away in this browser. A first menu comes with a first section. A new place starts with a restaurant's week (lunch
  and dinner, Tuesday to Sunday), so the hours step is done until someone changes it.
- **StructureTab**: the menu's sections (numbered, a grip each, Move up and down in their menu), each with its layout,
  Add dishes (search what exists with the arrows, Enter places it; a new name makes that dish here), its dishes in order
  (a grip each; the row opens the dish; Available inline, with a toast and Undo; Edit, Move up and down, Take out with
  Undo and Delete in ⋯) and its sub sections.
- **DishesTab**: every dish, searchable, Available inline (toast and Undo), New dish. Rows open the dish read only
  for Run service.
- **OptionsTab** and **GroupDrawer**: shared option groups (choose one, up to N, any; Guests must choose), checked
  inline before anything is sent.
- **SettingsTab**: name and places, serving times per day (`serving.tsx`, the library HoursEditor, starting from the
  place's hours), tax included and service added (the foot note follows them until the owner writes their own), and
  Delete.
- **SectionDrawer**: a section's name, line, layout and serving times (narrower than the menu's).
- **ItemDialog**: one dish in a drawer, in checklabs' order: name, photo (held until Save, so Cancel undoes it), price
  (the first size takes it; each size's price shows its currency), calories, description, sizes, option groups, allergens, dietary marks, Popular.
- **PublishDialog**: Review and publish: each check with Fix (hours, a dish on a menu, every dish priced, every menu
  shown somewhere, the last also refused by the server); with every check passed, a success line naming what goes live
  ("Guests will see 2 dishes on Dinner.") under the count of changes; Publish, then the live link with Copy and its QR code.
- **drawer.tsx**: every drawer asks before throwing typed changes away, and so does leaving the page.
