# 0054. Verify: the link page's appearance

Run with a test account that has a handle and at least six items, including two headings. Check the public page in a private window, so no session is in play, and check it once with the phone set to dark and once set to light.

| AC | How to check | Result |
|---|---|---|
| AC-5401 | A fresh account's `/<handle>` draws exactly the page spec 0051 ships, and `select theme from auth.public_profiles` reads the six default keys | |
| AC-5402 | `profile.saveTheme` with `{ ground: '#ff0000' }`, with a missing key, and with an extra key are each refused with `CONFIG_INVALID` and nothing is stored; the same write straight to the column is refused by the check constraint | |
| AC-5403 | `pnpm --filter @crm/db test guards theme`: a direct update as `crm_app` is refused, and `crm_save_profile_theme` is owned by `crm_handle` with a fixed `search_path` | |
| AC-5404 | `curl /api/public/handles/<handle>` answers the six keys, no colour value, no workspace id, no member id, and the query log shows no extra statement against the profile row | |
| AC-5405 | With a theme picked, the page root carries the six data attributes, has no `style` attribute, and the document holds no `<style>` element written at runtime; the console shows no policy violation | |
| AC-5406 | Owner picks a light page: a visitor with a dark phone sees light, and a visitor who chose Dark in this app sees light on `/<handle>`; `/b/:key` and the app still follow their own choice | |
| AC-5407 | Change one preset's text token to a pairing not in `contrast.ts`; `pnpm --filter @crm/tokens test` fails. Put it back and it passes | |
| AC-5408 | Screenshots of all four grounds in light and dark at 390 and 1280, with the hue set to green and to gray | |
| AC-5409 | All three shapes and all four fills, read off the computed styles: each radius is the named `radius-*` token and each fill is the named accent token; a solid button is `accent` on `on-accent` in every ground | |
| AC-5410 | With `font: mono` the name and the item titles are JetBrains Mono and sentences are Inter; the network tab shows no font fetched from any other origin | |
| AC-5411 | Change the page hue: the tint ground, the letter avatars and the tiles change, and the solid button does not. An item's own hue is unchanged | |
| AC-5412 | No ground resolves to a gradient or an image; `grep` finds no `linear-gradient` in the page's stylesheet | |
| AC-5413 | Throttle the network: the loading state draws on the plain ground in the visitor's own light or dark, the themed page arrives in one step, and a video of the load shows no second paint of a different colour; the browser bar matches the resolved mode | |
| AC-5414 | With reduced motion on, nothing on the page moves or scales, and fades and colour changes remain | |
| AC-5415 | Fold a section: the order is unchanged, the blocks under it are still the blocks up to the next heading, the 60 block limit counts the same blocks, and `select data from auth.profile_items` shows `group` inside the heading's `data` with no new column | |
| AC-5416 | The folded section's row is a button with `aria-expanded` and `aria-controls`, opens and closes with Enter and Space, shows the live count, and a screen reader announces the state change | |
| AC-5417 | Opening a section puts `#<item id>` in the address; back closes it; loading that address directly opens the folder and scrolls it into view; a made up fragment is ignored | |
| AC-5418 | With more than eight rows, the search shows matches flat with a count, including a match inside a closed section | |
| AC-5419 | Turn off every block under a folded section: the row draws as a plain heading, never as a folder that opens onto nothing. Turn the heading's own switch off: the whole card leaves the page, as spec 0051 AC-5106 says | |
| AC-5420 | Settings › Account › "Your link page" shows the Appearance card above the section cards, with the five presets and the five controls, all library components; picking Bold writes all six keys | |
| AC-5421 | Change a control with the api stopped: the control goes back and says why, and the page still shows the saved look | |
| AC-5422 | The preview changes with each pick before it is saved, in both the Phone and the Desktop frame. When the column is too narrow for both, the card still sits with the list and Preview opens the same in a Modal | |
| AC-5423 | Reset puts all six keys back to the default in one press, with no Modal, and the preview shows it at once | |
| AC-5424 | `pnpm boundaries` and the guard test pass: no app screen reads a page theme custom property, and the attributes exist only inside the page root and the preview frame | |
| AC-5425 | Tab through the Appearance card: every control has a visible label, a visible focus ring and an accessible name, and its current value is announced | |
| AC-5426 | `/b/:key` loads with the same requests and the same headers as before; the guard test fails if the theme module reaches the booking entry | |
| AC-5427 | An account that never opened the Appearance card has a `/<handle>` pixel identical to the one before this spec | |
| AC-5428 | With a strong ground picked, screenshot the whole page: the card, bio, socials row, both header actions, every block kind on it, the search, the empty and loading states and the "Powered by timefix" foot all sit on the theme, with nothing left on an app colour | |
| AC-5429 | In every fill, Save contact is still the one filled control on the page | |
| AC-5430 | `pnpm size` passes, and the Appearance card's code is absent from the public page's bundle and from the app's first load | |

Also run: `pnpm check`, `pnpm test`, `pnpm --filter @crm/tokens test` (the contrast pairs) and the browser flow test for the editor and the public page.
