# The story page runs out of memory, unpredictably

**Open, and not understood. Do not bisect a tree over it.** The shard and pass split in
`.github/workflows/ci.yml` is a mitigation with one green behind it, not a fix, and not a demonstrated one.

## What happens

Every story file in one engine shares one long lived browser page. Sometimes that page dies:
`The webkit page crashed while running tests. This can happen if the browser ran out of memory.` Firefox
hangs instead, with no summary and orphan processes, which is probably the same thing wearing a different
coat.

**The crash point is a distribution, not a property of a tree.** The same tree crashes at different points on
different runs, and a tree with no library change at all has both passed its whole set three times and
crashed a third of the way in. Any statement of the form "X fixed it" or "X causes it" needs more than one
run behind it, and so far nothing has that.

## Every observation we have

| Run | Branch / tree | Arrangement | Result |
|---|---|---|---|
| 41448200887 | car, 4892bf9f0 | one page, 181 files | crashed after **62** |
| 41453929022 | car, 22181e9a6 (same tree, baselines only) | one page, 181 files | crashed after **74** |
| 41457814575 | car | vitest `--shard=1/2` | shard 1 crashed after **5** of 91 |
| 41461134131 | car | membership split | shard 1 passed **91/91**; shard 2 crashed after **7** of 90 |
| 41469582229 | car, 88151ebbe | pass split, shard 2 first | **181/181**, all three passes green |
| 41477180390 | car + a 300 row story | pass split | shard 1 crashed after **37** of 91 |
| 41464493730 | `wip/embed-only`, no `packages/ui` change | one page, 178 files | passed **178** |
| (two more, same branch, same day) | `wip/embed-only` | one page, 178 files | passed **178**, twice |
| 41478500792 | `wip/embed-only`, same branch | one page, fresh runner, nothing before it | crashed after **37** of 178 |

Read the first six rows alone and our tree looks implicated. Read the last four and it plainly is not: the
same unchanged branch passes its whole set three times and then dies at 37.

## What is ruled out

- **A particular tree.** `wip/embed-only` touches no library file and both passes and crashes.
- **Runner reuse.** 41478500792 crashed on a fresh runner with nothing run before it.
- **Per file isolation.** `--no-isolate` hangs identically in Firefox (41448193169), so it is not the per
  file context being built and torn down. Do not turn isolation off; it is a diagnosis, not a fix.
- **The link page's font packs.** `packages/tokens/packs.css` is byte identical on main, and the branch that
  does not touch it crashes too.
- **Anything static the car added.** The whole `packages/ui` diff adds no `addEventListener`,
  `ResizeObserver`, `MutationObserver`, `IntersectionObserver`, `setInterval`, `setTimeout`, `.animate(` or
  `requestAnimationFrame`; the only match is one `matchMedia(...).matches` read, which subscribes to nothing.

## What we believed and withdrew

- **"The four files are the cause."** WeekCalendar, LinkPage, SettingsLayout and LinkList were the files in
  front of one shard when it died once (41461134131). They ran in one page among 178 on `wip/embed-only` and
  that page finished. They are not the cause; `KEEPS_A_PAGE` keeps them apart because it is cheap, not
  because they are guilty.
- **"The pass split fixed WebKit."** It has exactly one green behind it (41469582229) and has not been
  repeated. At this variance one pass proves no more than one failure does.
- **"The runner was the ceiling."** Disproved by 41469582229, where the 91 ran last on a used machine and
  passed — and then disproved from the other side by 41478500792 crashing on a fresh one.

## What this means for landing

A green `stories (webkit)` is not evidence the problem is solved. It is still the gate, for us as for
everyone, so a landing waits for a green one as it always would — but write down that it is one sample.

Adding weight does make it likelier: a 300 row version of `FloatingBarScrolled`, in the library's heaviest
story file, crashed shard 1 at 37 (41477180390), and dropping it to 40 rows cleared that. So keep story
fixtures small. That is a tendency worth respecting, not a mechanism anyone has shown.

## If you pick this up

Do not bisect the tree. Three identical-tree runs with three different outcomes will burn a day and tell you
nothing. Something external or probabilistic is in this — the runner's memory, the image, a browser bug, or
an interaction with how many pages Vitest keeps — and the next useful step is to measure the page's memory
as files run, on a branch that both passes and crashes, rather than to look for a guilty component.

`KEEPS_A_PAGE` in `packages/ui/scripts/story-shard.ts` can hold any set, including one file, if that helps an
experiment. Changing it needs no code change elsewhere.
