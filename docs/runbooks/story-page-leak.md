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

Adding weight does make it likelier: a 300 row version of `FloatingBarScrolled`, in the library's heaviest
story file, crashed shard 1 at 37 (41477180390), and dropping it to 40 rows cleared that. So keep story
fixtures small. That is a tendency worth respecting, not a mechanism anyone has shown.

## The one piece of possible structure: 37, twice

The series so far, in the order observed: **62, 74, 5, 178, 178, 178, 37, (91 + 4 + 3), 37.**

Every figure appears once except **37, which has appeared twice** — 41478500792 on `wip/embed-only` and
41490051715 on `wip/embed-handle-fix`. Both were a **full unsharded run of all 178 files from a cold
runner**, on two branches whose trees differ by six `apps/web` files that no story imports.

Nobody is claiming that means anything on a sample this small. It is either the only structure in the data
or it is a coincidence, and the point of writing it down is that it is the only thing here we can actually
test.

### Start here: the experiment with a prediction

Repeat the **full unsharded 178-file run from a cold runner** on an unchanged tree, several times.

- If the crash keeps landing on or near 37, the crash point is a function of the ordering and of what ran
  before it, and the thing to look at next is what the 37th file in that order leaves behind.
- If it scatters, 37 twice was chance, and the search moves to the runner and the image rather than the
  suite.

Either outcome is informative, which is more than anything else on this page offers.

**The sharded runs cannot be used for this.** They have a different ordering and a different number of files
per page, so their figures are not comparable with the unsharded ones. The repeats have to be the plain
178-file run or they mean nothing.

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
