# Walks

Playwright walks over the built prototype pages, served from a harness folder on 127.0.0.1:5391 (`app.html` is the Timefix app, `bp.html` Bookings, `biz.html` Business).

- `pages.sh` builds the three standalone pages and the harness copies; `bundle.sh` builds the design system bundle and READMEs. Both expect a working copy laid out as `<root>/tfds` (this folder's parent, with `build.mjs` pointing at the main repo's installs), `<root>/ds/project/tokens.json`, `<root>/pages` and `<root>/harness`; edit the paths at the top when you move them.
- `head.mjs` is the shared setup. `smoke.mjs` opens every sidebar page in the team, salon and restaurant workspaces plus Bookings and Business, and fails on a page error or a page that scrolls. The `wNN*.mjs` files walk one wave's features.
- `all.sh` runs every walk light and dark.
