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
| 41485749715 | car, f6d75ff14 | pass split | shard 1 **91/91**; the quarantined four **4/4**; the other 86 crashed after **3** |
| 41490051715 | `wip/embed-handle-fix`, off `33dfbed7b` | one page, 178 files, fresh runner | crashed after **37** of 178 |
| 41491888165 | car, 60fe63aec | pass split | shard 1 crashed after **37** of 91 |
| 41495821106 | car, 0d01d83fe | passes capped at 30 | 23/23, 23/23, then crashed after **9** of 23 |

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

- **"The four files are the cause."** Refuted, not refined. WeekCalendar, LinkPage, SettingsLayout and
  LinkList were the files in front of one shard when it died once (41461134131). They ran in one page among
  178 on `wip/embed-only` and that page finished. Then on 41485749715 they passed **4 of 4 in a page of their
  own**, shard 1 took all 91, and the pass holding the other 86 ordinary files **died after 3**. So the
  quarantine is holding files that are not the problem while the crash walks off into ordinary ones, and a
  page can die after three of anything. `KEEPS_A_PAGE` keeps them apart for cheap and historical reasons; no
  evidence now points at them.
- **"The pass split fixed WebKit."** It has exactly one green behind it (41469582229) and has not been
  repeated. At this variance one pass proves no more than one failure does.
- **"The runner was the ceiling."** Disproved by 41469582229, where the 91 ran last on a used machine and
  passed — and then disproved from the other side by 41478500792 crashing on a fresh one.

## What this means for landing

A green `stories (webkit)` is not evidence the problem is solved. It is still the gate, for us as for
everyone, so a landing waits for a green one as it always would — but write down that it is one sample.

Keep story fixtures small anyway, on general grounds: a 300 row version of `FloatingBarScrolled`, in the
library's heaviest story file, sat in a run that crashed shard 1 at 37 (41477180390), and the next run after
dropping it to 40 rows was green. But do not read that as cause and effect, which an earlier version of this
page did: a later run with the 40 row version crashed shard 1 at **the same 37** (41491888165). Two samples
either side of a change, at this variance, say nothing.

## 37, four times — unexplained, and NOT a ceiling in files

The series, in the order observed:
**62, 74, 5, 178, 178, 178, 37, 37, (91 + 4 + 3), 37, 37, (23 + 23 + 9).**

**37 has now appeared four times, and in both arrangements:**

| Run | Branch | Arrangement | Files in that page |
|---|---|---|---|
| 41477180390 | car | sharded, shard 1 | 37 of **91** |
| 41478500792 | `wip/embed-only` | unsharded, cold runner | 37 of **178** |
| 41490051715 | `wip/embed-handle-fix` | unsharded, cold runner | 37 of **178** |
| 41491888165 | car | sharded, shard 1 | 37 of **91** |

Four different trees, two different file counts per page, sharded and unsharded alike, and the same figure.
Every other number in the series appears once.

Two readings of this have already been wrong, both towards a tidier story, and they are left here as a
warning about the third.

The first called it "37 twice, both on a full unsharded 178-file run from a cold runner" and set the sharded
runs aside as not comparable. The sharded runs land on 37 too.

The second said the limit must therefore be counted in files rather than content — a per-file cost hitting a
ceiling near the 37th — and predicted that a pass under the ceiling would survive. **That was tested and it
failed**: a fresh page of 23 crashed after 9 (41495821106). See the section below.

So four identical figures remain the most striking thing here, and no account of them survives contact.
Whatever produces 37 is not a count of files, because 9 and 3 happen on pages that never approach it.

### The cap was tried, and it FAILED the prediction

Run **41495821106**, the first under the 30-file cap: pass 1 **23/23**, pass 2 **23/23**, pass 3 **crashed
after 9 of 23**.

The prediction was written before the run: a pass of 30 or fewer survives if the ceiling is counted in
files, and the hypothesis is wrong if one dies anyway. One died. **The count hypothesis is refuted.** A
fresh page of 23 files crashed after 9, which is the same shape as the pass of 86 that died after 3.

So the four 37s are not a ceiling in files. They remain unexplained — four identical figures in eleven
observations is still the most striking thing on this page — but whatever produces them, it is not "the
37th file is one too many", because 9 and 3 happen on pages that never get near 37.

What this rules out, added to the list above: **the number of files scheduled in a page**, in both
directions. Large pages sometimes finish (178, three times) and small fresh ones sometimes die (23 → 9,
86 → 3).

**The cap was removed** (the owner, 2 November 2026). A branch should not carry CI machinery into main that
is known to be unjustified, and this had just refuted its own only evidence. We are back to two plain
shards, one `vitest run` each. A fix that failed its own test and was taken out is a better entry in this
file than one quietly kept.

### What we did about it, which was also the experiment

Every pass is now capped at **30 files** (`MAX_PER_PASS` in `packages/ui/scripts/story-shard.ts`), so two
shards of ~91 become four passes and three. Each pass is a fresh `vitest run` and so a fresh page.

The prediction, written before the first run under the cap: **if the ceiling is counted in files, every pass
of 30 or fewer survives and WebKit goes green. If a pass of 30 dies anyway, the count hypothesis is wrong.**
Either way the run costs what an unchanged push would have cost.

It died. See the section above: a pass of 23 crashed after 9. The pass of 86 that died after 3
(41485749715) had already argued the same way, and the cap's own run settled it.

The quarantine of four files went at the same time. It rested on a theory this page refutes, and under a cap
it is redundant: every pass is small now.

### If the cap does not settle it

Repeat the same run on an unchanged tree several times, and vary only the number of files scheduled.

- If it keeps landing on 37 across different file counts, the limit is a count of files, and the next thing
  to find is what is allocated per file and never released. Vitest browser mode with isolation on is the
  obvious place: something per test file that outlives it.
- If it scatters once the sample grows, the four 37s were chance and the search moves to the runner and the
  image.

Either outcome is informative, which is more than anything else on this page offers.

## If you pick this up

Do not bisect the tree. Three identical-tree runs with three different outcomes will burn a day and tell you
nothing. Run the experiment above first.

**You cannot clear a red by re-running it.** `gh run rerun` answers "Must have admin rights to Repository"
for everyone working on this repo, and the token bears that out: `repos/BRIJRAJ-02/brij-crm` reports
`{"admin": false, "maintain": false, "push": false, "pull": true}` (pushes go through a separate
credential). So **every retry costs a fresh push**, which is also a fresh commit on the branch. Plan around
that: you cannot quietly retry until it passes, and at this variance you should not want to — picking the
run that suits you is how the four-files theory survived as long as it did.

Beyond the experiment, something external or probabilistic is in this — the runner's memory, the image, a
browser bug, or an interaction with how many pages Vitest keeps — and the next useful measurement is the
page's memory as the files run, on a branch that both passes and crashes.

`KEEPS_A_PAGE` in `packages/ui/scripts/story-shard.ts` can hold any set, including one file, if that helps an
experiment. Changing it needs no code change elsewhere.

---

## A separate problem found the same day: baselines drift under the threshold

Not the page leak. Recorded here because it has the same shape — a check that cannot fail — and because the
next person to see one of these two stories go red needs to know it had been moving for a while.

The screenshot comparator tolerates a difference up to a threshold. Two stories are **passing** today while
their committed baseline and what CI actually renders are measurably apart (run 41485749715, light):

| Story | Differing pixels | Worst channel delta | Where |
|---|---|---|---|
| `Sidebar/Item-Menu` | 13,273 of 1,080,000 | 47 | the menu, x 32..507, y 131..232 |
| `Sidebar/Section-Menu-And-Fold` | 1,201 of 854,400 | 69 | scattered; mean, min and max over the sidebar are identical, so antialiasing |

Item-Menu is the one that matters: thirteen thousand pixels moving by up to 47 is a real change, consistent
with this branch's shadow and border tokens moving a menu, and the comparator is designed not to see it. We
only know because the images were diffed by hand after the job had already passed.

So the suite tolerates change until something tips over, at which point it reads as a sudden regression with
no cause. If `Item-Menu` fails later, it did not break then: it has been drifting since the token pass.

**Do not tighten the threshold to fix this,** and do not adopt the drifted shots as baselines. A passing
baseline that has drifted is drift, not a decision, and changing a comparator threshold on a branch that is
trying to land turns a landing into a week. It needs its own pass, deliberately, when nothing is in flight.

### And a third, which compounds with it: `--update` adopts other people's frames

`pnpm test:visual --update` rewrites **every** story's baseline, not the ones you changed. Run three times
on an unchanged tree by another lane, it rewrote baselines for components that lane never touched on two of
the three runs — ChoiceChips, Code and LinkPageBlocks once, SettingsLayout another — different files each
time (found by crm-50).

This is worse than a blank shot, which "open the image before adopting" already catches. These frames render
correctly. They are somebody else's unsettled frame in a file nobody was looking at, and once adopted the
drift they carry is invisible to everyone.

**It applies to the CI artifact too**, which looked like the safe route: `ci.yml`'s regeneration step is
literally `pnpm test:visual --update`, run when `visual` fails, and the `screenshot-baselines` artifact is
its output. So the artifact can hand you the same contaminated frame.

The defence, either route: **diff the whole set against what is committed, copy only the files you named,
and ask why anything else moved.** After any local `--update`, `git status packages/ui/__screenshots__` and
revert everything unintended.

### What this branch carries

Checked rather than asserted. Against the artifact of run 41485749715, **6 of 2,234 images differ from what
is committed**, and all six are three stories we can account for:

| Story | Why |
|---|---|
| `SegmentedControl/Colour-Dots` (both themes) | the render held a hover; fixed in the story, baseline untouched |
| `Sidebar/Item-Menu` (both themes) | sub-threshold drift from this branch's shadow and border tokens |
| `Sidebar/Section-Menu-And-Fold` (both themes) | antialiasing; mean, min and max over the sidebar are identical |

Nothing else moved. That is the evidence that no contaminated frame is being carried: a frame adopted from
an unsettled render would almost certainly not reproduce byte for byte on a later run, so it would appear
here as a difference. Six, all explained, is a far stronger claim than "we were careful".
