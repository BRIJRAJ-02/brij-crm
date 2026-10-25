# 0055. Rationale: where the HTML is rendered, and what it costs to fetch somebody else's address

## The ask

The owner, 24 and 25 October 2026, on the link page: "phase this out and keep pushing", with "ship less but ship quality". Spec 0051, as amended on 25 October 2026, ends with three follow ups that are all one feature: server rendered meta and an OG card so a shared link previews, favicons for links fetched once and stored in R2 (#32), and an import from Linktree. Its amendments 17 and 18 built the near half of sharing already, a Share button on the page and one Share modal read two ways, so this spec is only about what the other end sees. This is phase 6, the phase that makes the page worth sharing rather than only worth visiting.

The owner has already drawn the card. The design artifact Timefix OG Card shows a person card (the wordmark at the top left, the photo in a white ringed circle, the name at 64px, the address at 32px, and the product's prompt pill) and a brand fallback card (the wordmark, the product line, the site address), with a side by side against the card the product draws today. The note on it says the point plainly: at thumbnail size it should read instantly as a person you can book, with no miniature interface to squint at.

## Context

> Premise note: these three jobs look unrelated and are in fact one decision with two appendices. The decision is that our servers start reading addresses that other people typed, which this product has done exactly once before, carefully, for a Google picture. A share card needs a photo, a favicon needs the other site, an import needs the other page. Spec it as three features and you get three fetchers with three sets of rules and one of them will be the weak one. Spec it as one door with one set of rules and the three features are small. That framing shapes everything below.

Four forces pull on this design.

The first is how the public pages are served. `/<handle>` and `/<handle>/<slug>` are rewritten in `vercel.json` to the built `book.html`, a static file with a fixed title, a fixed description and a `<meta name="robots" content="noindex">`. A crawler reads that file and learns nothing. Nothing in the deployment renders HTML per request for these paths today: there is a Vercel Routing Middleware that runs on every path but the built files and either proxies or passes on, and there is one Vercel Function serving the api (spec 0045). Those are the two places a request can be met.

The second is the content security policy on the public pages: `default-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self'`. A favicon from another site cannot be loaded by a visitor's browser. It can only reach the page by being fetched by us and served from our origin, which turns a display feature into a storage feature, which is why spec 0051 wrote it down as a follow up rather than building it.

The third is server side request forgery, the risk that somebody gives us an address that points inside our own network and we fetch it for them. The product's attack surface for this is currently one function, `createPictureFetch`, which fetches an account picture and is narrow on purpose: https only, Google's picture hosts only, at most two redirects each to such a host, 3 seconds, 1 MB, and a type decided by the first bytes. Every fetch this spec adds is wider than that by nature, because the whole point is an address somebody chose.

The fourth is that the Linktree import writes to somebody's public page from a page we parsed. A parser that gets a row slightly wrong, on a page a person is about to hand to a customer, is worse than a parser that refuses.

There is one more thing worth naming. Object storage is not built. Cloudflare R2 appears in spec 0001 as a thing that arrives later, as issue #32, and nothing in the repo talks to it. Two of the three jobs here need somewhere to put bytes.

## Options considered

### Option 1: the routing middleware rewrites a crawler to a renderer

The middleware already runs on every handle path. It reads the user agent, and when it looks like a crawler it rewrites to a function that answers a small HTML document with the meta tags; everybody else gets the static shell.

**Pros**: a human's page load is untouched, with no function and no added latency on the path that matters most. The renderer only has to answer crawlers, so it can be tiny.

**Cons**: it is user agent sniffing, which means serving different content to crawlers than to people, which search engines treat as cloaking and which is also simply a lie about what the page is. The list of crawler agents is never finished, and the ones that matter most for this feature (iMessage, WhatsApp, Slack) change without telling anybody. It also puts product logic in the middleware, which is already carrying the public host moves, the handle moves and the api proxy, and which cannot import anything from the repo.

### Option 2: one function serves the handle shell to everybody, with a meta block injected (chosen)

The handle rewrites point at a Vercel Function in the web project instead of `book.html`. It holds the built shell inlined at build time, reads the public profile through the api with a short timeout, writes a meta block into the head, and answers. Everybody gets the same bytes, and the edge caches them per handle.

**Pros**: one shell, no sniffing, nothing that reads as cloaking, and the meta tags are provably the same ones a person's browser sees. The read is best effort, so the page works when the api does not. The edge cache means the function runs rarely, since the page does not change per visitor. It also gives the spec 0054 theme somewhere to be written before the first paint, which removes a visible step for free.

**Cons**: every cache miss now runs a function on the most public path in the product, which is latency and cost the static file did not have. The shell has to be inlined at build time, which is a build step to get right. A mistake in the rewrite is visible to everybody at once.

### Option 3: render the whole page on the server

Stop serving a single page app for handles and render the page itself, items and all.

**Pros**: the fastest first paint by a distance, the best possible crawler result, and no loading state at all.

**Cons**: a second rendering path for a page that already has one, which is two places for every future change and a steady source of drift between them. It would mean the public page components run on the server, which pulls the whole client data layer's shape into a place it was not built for, and it would make every page load a database read rather than a cacheable file. It is the right answer for a content site and the wrong answer for one page in a product whose client rendering works.

### Option 4: a static brand card for everybody, no per person rendering

Keep the shell, add one fixed set of meta tags naming the product, and ship a single brand image.

**Pros**: an afternoon's work, no function, no drawing, no fetching.

**Cons**: it answers none of the ask. The thing that makes a shared link worth opening is the person's name and face, and a product logo in a chat window is noise. The owner has drawn the card they want; this would be shipping the one they want replaced.

## Rationale

Option 2 follows from the first and third forces together. Something has to run per request, because a handle's name and picture are only known at request time, and the only honest version of "something runs per request" is one that runs for everybody. The moment the answer depends on who is asking, it is cloaking, the crawler list is a maintenance burden, and nobody can verify from a browser that the tags are right. Serving one shell to everybody also makes the cache trivial, because the answer depends on the handle and on nothing else: no cookie is read, so a public edge cache is correct rather than merely tempting.

Putting it in a function rather than in the middleware is the second half of that call. The middleware cannot import anything from this repo (a deploy failed on exactly that, 22 October 2026, which is why it carries copies of the path patterns in its own file), and it is already carrying three jobs. A function can read the api, can hold the shell, and can be tested like any other module.

The card is drawn rather than screenshotted because a screenshot needs a browser, and a browser in the api is a large thing to run to make a picture of six words. Turning a drawing into a PNG on the server is a well understood job with a small pinned dependency, and the card the owner drew is six text runs, a circle and a pill, which is exactly the kind of drawing that path is good at. The photo comes through the picture fetch that already exists, so the card adds no new outside host at all. The one honest gap is the typeface: the design uses Instrument Sans and the repo ships Inter, so the card is drawn in Inter and the difference is written down for the owner rather than quietly papered over.

The fetching rules are the heart of the spec and they are deliberately one module. The picture fetch already proves the shape in this repo: allow list the scheme, allow list or check the host, cap the redirects and check again after each one, cap the time and the bytes, and decide the type from the first bytes rather than from anything the other side said. What the new cases add is that the host is no longer a fixed list, so the check becomes a check of the resolved addresses against the ranges that mean "inside", before the connection and after every redirect. Checking before connecting is not enough on its own, because a name can resolve differently the second time and a redirect can point anywhere, which is how most of the published failures of this kind actually happened.

The import narrows further, to an allow list of seven hosts, and that is the single best decision in this spec. An import from an arbitrary address is a general purpose fetcher with a parser attached, pointed at anything, triggered by any account. An import from seven known services is almost no surface at all, and it loses nothing real, because nobody is importing their links from a page that is not a link in bio page. If somebody genuinely wants one more service, adding a host to a list is a one line change with a review attached.

Everything fetched is re-encoded before it is stored, which is the rule that makes serving the bytes from our own origin safe. Our origin is where the session cookies live, so anything served from it that a browser might interpret is a problem: that is also why SVG is refused outright, since an SVG can carry script and no amount of checking its bytes makes that safe to serve beside a signed in app. Decoding then re-encoding to a fixed size PNG means the bytes a visitor's browser reads were written by us, from pixels, and the pixel count cap means a small file that unpacks into a huge image is refused before memory is spent on it.

Fetching an icon in a job rather than in the request path matters for two reasons, and only one of them is speed. The obvious one is that a page read must never wait on somebody else's server. The one that matters more is that spec 0051 promised that no outside site learns a visitor opened somebody's link page, and a fetch triggered by a visitor's request would quietly break that promise even though the fetch comes from our server, because the timing would tell. A job, running once per origin for everybody, tells nothing about anybody.

The import landing archived is the same instinct applied to writing. Spec 0051 already has Archive with its own list and a Restore, so an import has somewhere to land that is complete, reversible and invisible to a visitor. The person reviews rows and presses, which means a parser that gets something wrong produces a bad row in a review list rather than a bad row on a page somebody is handing to a customer.

## Decisions taken on the owner's behalf

The owner delegates product and user experience calls (21 October 2026, "do it yourself"). These are the calls this spec made, each one the owner can reverse.

1. **One shell for everybody, never a crawler specific answer.** Sniffing is cloaking, the agent list is never finished, and nobody can check it from a browser.
2. **Only the meta block is rendered on the server, never the body.** A second rendering path for a page that already has one is a drift machine. The crawler gets what it needs; the person gets the app.
3. **A failed read answers the plain shell with a 200.** A preview is a nice to have; the page working is not. Nothing a crawler needs is worth showing a person an error.
4. **Handle pages become indexable, by default.** A page at your own address, printed on a badge and handed out, should be findable by your name. The switch exists for anybody who disagrees, and this is listed as an owner question because it is a privacy default, not a layout choice.
5. **`/b/:key` and `/f/:key` keep `noindex` and are not touched.** The booking page is frozen and a form is not a thing to find in a search engine.
6. **Spec 0051 AC-5131 is narrowed rather than quietly broken.** `/<handle>/<slug>` gains meta tags, which is a change to its shell. Saying so in both specs, and rewriting the guard test, is the honest version.
7. **The card is drawn, not screenshotted.** A browser in the api to make a picture of six words is a large thing to run and a large thing to keep running.
8. **The card is drawn in Inter and says `timefix.com`.** The repo ships Inter and self hosts it, and the brand domain decision of 24 October is `.com`. Both differ from the approved drawing, so both are owner questions rather than silent edits.
9. **Any failure drawing a person's card answers the brand card.** A broken image in a chat window is worse than a plain one, and a card with an empty name is worse than both.
10. **One module owns every outside fetch, with a lint rule behind it.** The second fetcher somebody writes in a hurry is the one that gets it wrong.
11. **SVG is refused everywhere, and everything is re-encoded.** Our origin is where the session lives. Nothing a stranger produced gets served from it as it arrived.
12. **The import is an allow list of seven hosts, not a general fetcher.** It loses nothing real and removes almost the whole risk.
13. **An import lands hidden and nothing publishes itself.** Spec 0051's amendment 23 replaced archiving with a switch on a row that stays where it is, so an imported row arrives in its own section with its switch off, which is both the review list and the final home. There is no second list to build. A parser will get something wrong; the person should be the one who sees it first.
14. **A skipped row is shown with its reason.** Silently dropping four of somebody's twenty links is how an import loses trust.
15. **Icons are fetched by a job, keyed by origin, shared by everybody.** It keeps spec 0051's promise about visitors, and it means one fetch per site rather than one per person.
16. **A failed icon is remembered for seven days.** A dead site should not be dialled on every save forever.
17. **The slices put the two R2 slices last.** Three of the five slices need no object storage, so three of them can ship now and the other two wait on #32 without holding anything up.
18. **Removing an uploaded share image asks first.** It destroys something the person made, which is what the confirm rule is for. Turning indexing off, turning an icon off and running an import do not ask, because none of them destroys anything.

## Open for the owner

Worth a word from the owner, though nothing waits on it:

- **The typeface on the card**: Inter, which ships, against Instrument Sans, which the approved design uses and which would mean a font file in the design system artifact and a tokens sync for every screen.
- **The address on the card**: `timefix.com/<handle>`, following the 24 October brand domain decision, against the `timefix.ai/brijraj` in the approved drawing.
- **Indexable by default**: a privacy default about somebody's name and face, not a layout choice.
- **Which services the import names**, and whether to name competitors in product copy at all.
- **Whether a custom share image should be plan limited** once billing exists.

## References

Sources, no links fetched for this spec.

**Project sources**:

- Spec 0051 as amended on 25 October 2026 (the block registry of amendment 1, the hide switch that replaced archiving in amendment 23, the Share button and the one Share modal of amendments 17 and 18, the lazily loaded editor view of amendments 3 and 25, the policy promise about visitors, and the three follow ups this spec picks up), spec 0052 (the six block kinds being specified beside this one, whose rule that no block changes the policy is the same rule this spec works under), spec 0053 (the social links row, which already has its own marks and needs no fetched icon), spec 0054 (the page theme the shell writes before the first paint), spec 0045 (the api as a Vercel Function in the web project), spec 0025 and 0028 (the booking pages and what `/<handle>/<slug>` reads), spec 0047 (the visitor rule and the machine check), spec 0008 (Graphile Worker and how a job is written), spec 0001 (R2 named as issue #32).
- The design artifact Timefix OG Card, version 1786954164-4d4a, read as data: the person card (wordmark at the top left, a 140px photo circle ringed in white, the name at 64px, the address at 32px, the prompt pill with its send mark), the brand fallback card, the note that it must read at thumbnail size as a person you can book, and the side by side against the card drawn today. Its ground, its sizes and its wording are what AC-5510 and AC-5511 describe; its typeface and its `.ai` address are the two owner questions above.
- The repo: `apps/web/vercel.json` (the handle rewrites, the handle paths' header block and the policy), `apps/web/middleware.ts` (what runs at the edge and why it imports nothing), `apps/web/book.html` (the shell, its fixed title and its `noindex`), `apps/web/api/index.mjs` (the api function), `apps/api/src/public/picture.ts` (`createPictureFetch`, the hardened fetch this spec generalises), `apps/api/src/analytics/visitor.ts` (the visitor rule and the machine check), `packages/tokens/fonts/Inter-Variable-latin.woff2`, `packages/ui/src/atoms/ProviderMark/` (the social marks an icon never has to replace).

**Practices and standards**:

- The Open Graph protocol and Twitter's `summary_large_image`, as the tags AC-5502 names.
- The published guidance on server side request forgery: allow list the scheme, resolve and check the address rather than trusting the name, re-check after every redirect, cap time, size and redirect count, and refuse private, loopback, link local, unique local, multicast and carrier grade NAT ranges.
- Deciding a media type from the first bytes rather than from a declared type or a file name.
- Re-encoding untrusted images before serving them from an origin that holds sessions, and refusing SVG there outright.
- Search engine guidance against serving different content to crawlers than to people.
