# Four stories exhaust a browser page

**Open. This is a product bug, found in the test runner.** The CI split that works around it is in
`.github/workflows/ci.yml`; it is a workaround and should not be read as the fix.

## What happens

Every story file in one engine shares one long lived browser page. Four files leave so much behind in that
page that the files after them run out of memory:

- `packages/ui/src/modules/WeekCalendar/WeekCalendar.stories.tsx`
- `packages/ui/src/modules/LinkPage/LinkPage.stories.tsx`
- `packages/ui/src/modules/SettingsLayout/SettingsLayout.stories.tsx`
- `packages/ui/src/modules/LinkList/LinkList.stories.tsx`

WebKit dies outright (`The webkit page crashed while running tests. This can happen if the browser ran out of
memory.`). Firefox hangs on the same set, which is the other half of the story and still open.

## The evidence

One page, all 181 files, WebKit died part way through at a point that moved between runs of the same tree:
62 files in (run 41448200887), then 74 (run 41453929022). A crash point that moves is accumulation, not one
heavy story.

Splitting by membership alone, the shard holding those four died after 7 of its 90 files, while the other
shard passed all 91 (run 41461134131). Giving the four a `vitest run` of their own, which is a browser page
of their own, cleared it: 4, then 86, then 91, all green, 181 of 181 in WebKit for the first time (run
41469582229).

That run also rules out the runner. Its shards ran in reverse order, so the 91 ran **last**, on a machine
that had already done 90 files, and passed anyway. The ceiling is the page, not the host.

Ruled out along the way:

- **Per file isolation.** `--no-isolate` hangs identically (run 41448193169), so it is not the per file
  context being built and torn down.
- **The link page's font packs.** `packages/tokens/packs.css` is byte identical on main, and a branch off
  main with no `packages/ui` change passed WebKit with all 178 files in a single page (run 41464493730).
- **Anything static we added.** The car's whole `packages/ui` diff adds no `addEventListener`,
  `ResizeObserver`, `MutationObserver`, `IntersectionObserver`, `setInterval`, `setTimeout`, `.animate(` or
  `requestAnimationFrame`; the only match is one `matchMedia(...).matches` read, which subscribes to nothing.

## Why it matters beyond CI

A page that cannot survive a few mounts of these screens is a page that degrades in a real tab. The victim is
somebody's CRM left open all day opening and closing a record panel, a settings screen or a link page. Nobody
would find this by looking at the UI; a browser holding one page for an hour is simply honest about it.

## Where to start

Mount and unmount each of the four in a loop in one page and watch what the page keeps: nodes detached but
reachable, animations still registered on elements that have gone, anything subscribed at module level. Take
them one at a time — `KEEPS_A_PAGE` in `packages/ui/scripts/story-shard.ts` can hold a single file, so a
one-file pass tells you which of the four it is, or whether it is all of them.

When it is fixed, remove that file from `KEEPS_A_PAGE` and let a run prove the shard holding it finishes
without the quarantine.
