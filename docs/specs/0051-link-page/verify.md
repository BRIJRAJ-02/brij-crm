# 0051. Verify: the link page

Run with a test account that has a handle, two workspaces, and at least one Public booking page in each. Check the public page in a private window, so no session is in play.

| AC | How to check | Result |
|---|---|---|
| AC-5101, AC-5109 | Add a link, a heading, a booking page and a contact card, then open `/<handle>`: the items read in the editor's order, headings included | |
| AC-5102 | The 41st link is refused with the limit sentence, and Add › Link is off with the same sentence | |
| AC-5103 | `javascript:alert(1)` and a `data:` address are refused; `timefix.ai` is stored as `https://timefix.ai` | |
| AC-5104 | Pause the booking page: its row leaves `/<handle>` and the item stays in the editor. Make it live again: it comes back in its old place | |
| AC-5105 | A second heading called "sales" beside "Sales" is refused | |
| AC-5106 | Archive a link: it leaves the page at once and sits under Archived with Restore. Delete asks first in a Modal | |
| AC-5107 | Send the same add twice with one id (the browser's network tab, resend): one item, not two | |
| AC-5108 | `curl /api/public/handles/<handle>` holds no workspace id, no member id and no email, and pages at 20 with a cursor | |
| AC-5110 | With 21 links including a LinkedIn, an X and a plain website: the first two show their marks, the third its Lucide icon or letter. The browser's network tab shows no request to any outside origin, and the console shows no policy violation | |
| AC-5111 | Screenshots at 390 and 1280, light and dark; tab through the whole page; the loading state holds the rows' places | |
| AC-5112 | A handle with no items shows the empty state; an unknown handle shows the existing not found page | |
| AC-5113, AC-5114 | `curl -i /api/public/handles/<handle>/contact.vcf` answers `text/vcard`, an attachment filename, a folded card with the photo; a handle with no card answers 404 | |
| AC-5115 | Save contact on an iPhone and on Android opens the contact sheet; scanning a QR of the `.vcf` address does the same | |
| AC-5116 | Drag a row, move one with Enter and the arrows on its grip, and move one from its menu: each saves at once; with the api stopped, the row goes back and says why | |
| AC-5117, AC-5118 | Add offers all four kinds; Booking page lists only pages not already placed, with their workspace named; each row's menu offers all six items | |
| AC-5119 | At 1400 wide the preview sits beside the list and changes as you type, before saving. At 1000 wide, Preview opens the same in a Modal | |
| AC-5120 | A fresh account with no handle sees the claim note and the Add menu off | |
| AC-5121, AC-5122 | Home shows the card with the QR; scanning it with a phone opens `/<handle>`; Download PNG saves a 1024 square that a scanner still reads; the code is dark on light in dark mode too | |
| AC-5123 | An account with no handle sees the quiet state with a link to Settings › Profile | |
| AC-5124, AC-5125 | Two loads in a private window add one `auth.profile_views` row with 2 views; pressing two items adds two `auth.profile_item_presses` rows; loading the page signed in as its owner adds nothing | |
| AC-5126 | `curl` with a bot user agent counts nothing; a press with an id that is not on the page answers 204 and writes no row; 61 presses in a minute are limited | |
| AC-5127 | The editor shows each item's presses over 30 days and the page's views and visitors with the period before it; a new item reads "No presses yet" | |
| AC-5128 | A view row dated 400 days ago is gone after the daily cleanup | |
| AC-5129, AC-5130 | After the backfill, every page that was on the profile is an item in its old order, each workspace's group a heading named after it; the page editor's Section control renames that item's heading | |
| AC-5131 | `/b/:key` and `/<handle>/<slug>` load with the same requests and the same headers as before; `pnpm boundaries` and the guard test pass | |
| AC-5132 | `pnpm --filter @crm/db test guards profile`: a direct select as `crm_app` is refused, and each new definer is owned by `crm_handle` with a fixed `search_path` | |
| AC-5133 | With more than eight rows, the search finds a link by its note and a booking page by its title, shows the matches flat with a count, and a slow earlier answer never replaces a newer one | |

Also run: `pnpm check`, `pnpm test`, and the two browser flow tests for the editor and the public page.
