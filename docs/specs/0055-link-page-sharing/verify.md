# 0055. Verify: sharing the link page

Run with a test account that has a handle, a photo, a bio and at least one Public booking page. Check every public path in a private window, so no session is in play. A second account with no photo and no bio covers the fallbacks. Keep the browser's network tab open throughout: this spec's whole point is that nothing a visitor's browser loads comes from another origin.

| AC | How to check | Result |
|---|---|---|
| AC-5501 | `curl -s https://timefix.com/<handle>` holds the built shell plus one block of meta tags in its head. Diff the body, the script tags and the style tags against the shell the path answered before this spec: they are identical | |
| AC-5502 | In that output: `<title>`, `description`, `og:type` `profile`, `og:title`, `og:description`, `og:url`, `og:image` with width 1200, height 630 and an alt, `twitter:card` `summary_large_image`, a canonical link and a robots tag. Repeat for `/<handle>/<slug>`: the booking page's own title and note, `og:type` `website`. Set a bio holding `"` and `<script>` and check both are escaped in the output | |
| AC-5503 | Stop the api, then load `/<handle>`: a 200, the built shell, the brand card, no error shown, and a logged miss. Start the api: the page draws as usual. Then hold the api's answer past 800ms and check the same | |
| AC-5504 | Load `/<handle>` signed in as its owner and signed out: the same bytes. The answer carries `cache-control: public, s-maxage=300, stale-while-revalidate=86400`, and sends no cookie back | |
| AC-5505 | `curl -I` the path and compare every header against `vercel.json`'s block for handle paths, value for value. The test that does this fails when a value is changed on purpose | |
| AC-5506 | Settings › Profile shows "Let search engines show this page", on by default. Turn it off: the shell writes `noindex, follow`. `curl -I /b/<key>` and `/f/<key>` still answer their existing `noindex` | |
| AC-5507 | `curl` `/b/:key` before and after this spec: byte for byte the same shell, the same requests and the same policy headers. `/<handle>/<slug>` keeps its markup and gains only the meta block. The rewritten guard test fails if the booking page's shell changes at all | |
| AC-5508 | `curl -i /no-such-handle`: a 404 status, the brand card, the site's own title and description, and a `noindex` | |
| AC-5509 | With a theme set (spec 0054), the shell's root already carries the theme attributes, and the first paint is the right colour with no flash. Stop the api and load again: no theme attributes, and the page behaves as spec 0054 describes | |
| AC-5510 | `GET /api/public/handles/<handle>/card.png` saves a 1200 by 630 PNG: the Timefix wordmark top left, the photo in a 140px circle ringed in white, the name, `timefix.com/<handle>` and the signature line as a pill, set in Inter. Compare it with the approved card in the design artifact | |
| AC-5511 | The account with no photo gets initials on a hue tile. Hide the photo: the same. `curl` the card for a handle nobody holds: the brand card, a 200, never a broken image | |
| AC-5512 | Watch the server's outgoing requests while a card is drawn: only Google's picture hosts, https only, and nothing else. Point a profile picture at a non Google host, at a 4 MB file, and at a file whose first bytes are not an image: each is refused and the card falls back | |
| AC-5513 | The card's address carries a version from the profile's `updated_at`, and answers `public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`. Change the name: the address changes | |
| AC-5514 | 31 requests in a minute from one address are limited; 301 in a minute for one handle are limited. A request with a crawler's agent string is answered and is not counted | |
| AC-5515 | Upload a 6 MB image: refused. A file named `.png` whose first bytes are a PDF: refused. A 500 by 300 image: refused. A valid 2000 by 1000 PNG: accepted, and what the card route serves is a 1200 by 630 PNG we re encoded, not the bytes sent | |
| AC-5516 | The stored object's bucket has no public address. The card is served only from our own origin. `grep` the built public bundle for any R2 address: none. `img-src` in the policy is unchanged | |
| AC-5517 | Remove asks first in a Modal, puts the generated card back in one press, and the stored object is gone from the bucket | |
| AC-5518 | A link block with an icon draws it inside the row's tinted square, served from `/api/public/icons/:id` on our own origin. The policy is unchanged. A block with no icon falls back to the social mark, then the chosen Lucide icon, then the letter | |
| AC-5519 | Save a link, then load `/<handle>` at once: the page waits on nothing and answers as fast as before. The linked site's own logs, or a local server standing in for it, show one request from the job and none from a visitor's load | |
| AC-5520 | Point a link at `http://169.254.169.254/`, at `https://localhost/`, at `https://127.0.0.1/`, at an address literal, and at a host that resolves publicly then redirects to `http://169.254.169.254/latest/meta-data/`: each is refused, the last one after the redirect. Check three redirects, a 4 second site and a 300 KB file are each refused, that no cookie or credential is sent, and that the agent string names us and says nothing about any visitor | |
| AC-5521 | An SVG favicon is refused. A PNG, an ICO, a JPEG and a WebP are each accepted and what is stored is a 64 by 64 PNG | |
| AC-5522 | Two accounts linking to the same site share one object and cause one fetch. A stored icon older than 30 days is fetched again. A site that fails is not fetched again within 7 days | |
| AC-5523 | `iconOff` on a block goes back to the chosen icon. Nothing is fetched for a block whose owner chose a Lucide icon or whose address matches a social network | |
| AC-5524 | `profile.importLinks` accepts each host on the allow list. Any other host is refused with `CONFIG_INVALID` and the sentence, and the server's outgoing requests show nothing was fetched | |
| AC-5525 | The import reads the page once, inside 5 seconds and 1 MB, and runs no script from it. A page with an inline script that would call out shows no such call in the server's outgoing requests | |
| AC-5526 | After an import, `/<handle>` in a private window is unchanged. Every imported row sits in the editor, switched off, reading "Hidden from the page", in the page's own order, in one section named after the page. Turn one on: it appears | |
| AC-5527 | Import a page holding a video block, a payment block, a form and a row with no address: each is listed with its reason, each can still be added as a plain link, and nothing is dropped silently | |
| AC-5528 | An import of 50 rows brings 40 and says so. An import that would pass spec 0051's limits is refused naming the limit. The same import id sent twice adds nothing twice. A sixth import in an hour is refused | |
| AC-5529 | `grep` every policy in the repo for an origin added by this spec: none. Load `/<handle>` with a card, an uploaded image and several favicons: every picture comes from our own origin, a `data:` address or a `blob:` address, and the console shows no policy violation | |
| AC-5530 | Across a visitor's whole load, the network tab shows no request to any origin but ours | |
| AC-5531 | Every outside fetch this spec adds is in the one module. Write a `fetch` of a user supplied address somewhere else and the build fails on the lint rule | |
| AC-5532 | The owner's Share modal gains one line and the card beside it. A visitor's reading of the same modal gains nothing, and the public bundle holds no figures and no download | |
| AC-5533 | `pnpm size` passes. The import and the upload appear only in the editor's lazily loaded chunk, not in the public page's first load | |

Also run: `pnpm check`, `pnpm test`, `pnpm size`, and the browser flow tests for the public page and the editor.

Paste `timefix.com/<handle>` into WhatsApp, iMessage, Slack, X and LinkedIn and check each preview shows the name, the photo and the address. These are outside services with their own caches, so check a handle none of them has seen before.
