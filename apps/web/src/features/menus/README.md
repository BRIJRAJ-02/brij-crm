# Menus

The Menu app's editor (spec 0065, H1), at `/w/<slug>/menus` while Menu is installed.

- **MenusScreen**: Purpose: build menus and publish them. Main task: build a menu and publish it, watching the guest
  menu take shape in the phone beside it (the real `MenuList` drawing the draft, `preview.ts`). Leaves out: presets
  (H5), QR codes (H2), import (H6), analytics (spec 0066). Until the first Publish it opens on a SetupChecklist (hours,
  first menu, first dishes, Publish, share). Publish refuses a broken menu with one line and the dish's name, as the
  server does (`publishBlocker`, `publishProblem` in core); Discard asks first. The guest link is always on the public
  origin (`publicMenuUrl`).
- **ItemDialog**: one dish in a form: name, price or sizes (minor units through `parsePrice`), price note, words,
  dietary marks, allergens (contains and may contain), option groups, calories, Popular, and a photo drawn again at
  1200 and 400 pixels (`photo.ts`).
