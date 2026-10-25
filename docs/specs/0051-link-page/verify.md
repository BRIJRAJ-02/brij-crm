# 0051. Verify: the link page

Run with a test account that has a handle, two workspaces, and at least one Public booking page in each. Check the public page in a private window, so no session is in play.

| AC | How to check | Result |
|---|---|---|
| AC-5101, AC-5109 | Add a link, a heading, a booking page and a contact card, then open `/<handle>`: the items read in the editor's order, headings included | |
| AC-5102 | The 41st link is refused with the limit sentence, and Add › Link is off with the same sentence | |
| AC-5103 | `javascript:alert(1)` and a `data:` address are refused; `www.timefix.com` is stored as `https://www.timefix.com`; `ada@example.com` becomes `mailto:ada@example.com` and `+91 98 7654 3210` becomes `tel:+919876543210`; an email link opens in the same tab | |
| AC-5104 | Pause the booking page: its row leaves `/<handle>` and the item stays in the editor. Make it live again: it comes back in its old place | |
| AC-5105 | A second heading called "sales" beside "Sales" is refused | |
| AC-5106 | Turn a link's "Show on the page" switch off: it leaves the page at once, stays where it was in the editor, dimmed, and reads "Hidden from the page". The switch puts it back. Turn a heading's switch off: the heading and every row under it leave the page, and turning it on brings back only the rows that were on. Delete asks first in a Modal | |
| AC-5107 | Send the same add twice with one id (the browser's network tab, resend): one item, not two | |
| AC-5108 | `curl /api/public/handles/<handle>` holds no workspace id, no member id and no email, and pages at 20 with a cursor | |
| AC-5110 | With 21 links including a LinkedIn, an X and a plain website: the first two show their marks, the third its Lucide icon or letter. The browser's network tab shows no request to any outside origin, and the console shows no policy violation | |
| AC-5111 | Screenshots at 390 and 1280, light and dark; tab through the whole page; the loading state holds the rows' places | |
| AC-5112 | A handle with no items shows the empty state; an unknown handle shows the existing not found page | |
| AC-5113, AC-5114 | `curl -i /api/public/handles/<handle>/contact.vcf` answers `text/vcard`, an attachment filename, a folded card with the photo; a handle with no card answers 404 | |
| AC-5115 | Save contact on an iPhone and on Android opens the contact sheet; scanning a QR of the `.vcf` address does the same | |
| AC-5116 | Profile shows only the "Your link page" row; Edit link page opens `?view=link-page`. Drag a row, move one with Enter and the arrows on its grip, and move one from its menu: each saves at once; with the api stopped, the row goes back and says why | |
| AC-5117, AC-5118 | Add item opens one Modal with the four kinds as a radio group, the chosen kind's fields, a Section select with "No section", and the "How it will look" row; New section opens the same Modal with Section chosen; Booking page lists only pages not already placed, with their workspace named; each row's menu offers all its items | |
| AC-5119 | At 1280 wide the preview sits beside the list (two fifths of the width) and changes as you type, before saving. In a column too narrow for both, Preview opens the same in a Modal | |
| AC-5120 | A fresh account with no handle sees the claim note and the Add menu off | |
| AC-5121, AC-5122, AC-5135 | Home shows the card with the QR; scanning it with a phone opens `/<handle>`; the card's QR and the editor header's Share open the same modal, with Download QR code saving a 1024 square that a scanner still reads and the figures foot showing Views and Clicks; the code is dark on light in dark mode too. On `/<handle>` the Share button opens the visitor's reading of that modal, with no download and no figures, and on a phone it hands the page to the system share sheet | |
| AC-5123 | An account with no handle sees the quiet state with a link to Settings › Profile | |
| AC-5124, AC-5125 | Two loads in a private window add one `auth.profile_views` row with 2 views; pressing two items adds two `auth.profile_item_presses` rows; loading the page signed in as its owner on the app's host adds nothing; a read with `?q=` and a read with `sec-fetch-site: cross-site` count nothing | |
| AC-5126 | `curl` with a bot user agent counts nothing; a press with an id that is not on the page answers 204 and writes no row; 61 presses in a minute are limited | |
| AC-5127 | The editor shows each item's presses over 30 days and the page's views and visitors with the period before it, said as "up from N"; a new item reads "No presses yet"; a heading shows no figure | |
| AC-5128 | A view row dated 400 days ago is gone after the daily cleanup | |
| AC-5129, AC-5130 | After the backfill, every page that was on the profile is an item in its old order; the first workspace's pages keep no heading and a second workspace's sit under "Book a time", with no workspace named anywhere on the public page. Make a new booking page Public: it joins the end of the link page once; remove its block and switch it to Link only and back: it does not come back. The booking editor shows "On your link page" with Edit link page to the owner only | |
| AC-5131 | `/b/:key` and `/<handle>/<slug>` load with the same requests and the same headers as before; `pnpm boundaries` and the guard test pass | |
| AC-5132 | `pnpm --filter @crm/db test guards profile`: a direct select as `crm_app` is refused, and each new definer is owned by `crm_handle` with a fixed `search_path` | |
| AC-5133 | With more than eight rows, the search finds a link by its note and a booking page by its title, shows the matches flat with a count, and a slow earlier answer never replaces a newer one | |

Also run: `pnpm check`, `pnpm test`, and the two browser flow tests for the editor and the public page.
| AC-5134 | `/<handle>` shows Save contact and a square Share button under the card; with no contact block, Share stands alone and the contact block draws no card of its own | |
| AC-5136 | The editor draws section cards with a grip, a count and a section menu; a row drags from one section to another in one save, and the keyboard move on a grip does the same | |
| AC-5137 | Add a link with "No section" chosen: it lands before the first heading. Add one with a section chosen: it lands at the end of that section's rows. Hide a row: its place in `auth.profile_items.position` is unchanged | |
