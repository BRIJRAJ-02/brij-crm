/** Anything placed on a day by time: its id and its minutes from the day's midnight. */
export interface Timed {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Where a block sits across its day: inside a region (`left` and `width`, fractions of the column), pushed in by
 * `indent` steps from the region's start, then in `lane` of the region's `lanes`, wide enough for `span` lanes.
 */
export interface Slot {
  readonly left: number;
  readonly width: number;
  readonly indent: number;
  readonly lane: number;
  readonly lanes: number;
  readonly span: number;
}

/** A block with its slot. */
export type Placed<B extends Timed> = B & Slot;

/** "+N": the blocks a lane was too narrow to show, gathered in the last lane that fits. */
export interface More<B extends Timed> extends Slot {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly hidden: readonly B[];
}

/** One day's layout: the blocks shown, in paint order (a later start over an earlier one), and the "+N" chips. */
export interface DayLayout<B extends Timed> {
  readonly blocks: readonly Placed<B>[];
  readonly more: readonly More<B>[];
}

/** A block starting this many minutes after everything it overlaps sits over them, indented, instead of beside them. */
export const NEST_AFTER = 45;

/** The narrowest lane drawn, as a fraction of the column (a week's day holds three); past it the rest go into "+N". */
export const MIN_LANE = 1 / 3;

/** The tallest a "+N" chip draws, in minutes; a folded block starting later than that gets a chip of its own. */
const MORE_MINUTES = 30;

/** The deepest a block indents: a chain of overlaps through the day steps in this far and no further. */
export const MAX_INDENT = 3;

interface Group {
  /** The entry this group sits over, indented; none for a group straight on the day. */
  readonly parent: number | undefined;
  readonly indent: number;
  /** Each lane's busy spans: its own blocks, and what sits over them. */
  readonly lanes: { readonly start: number; readonly end: number }[][];
}

interface Entry<B extends Timed> {
  readonly block: B;
  readonly group: number;
  readonly lane: number;
}

const overlaps = (a: Timed, b: { readonly start: number; readonly end: number }) =>
  a.startMinute < b.end && b.start < a.endMinute;

/**
 * Google Calendar style lanes for one day's blocks. Sorted by start (the longer first on a tie), a block that
 * starts within `NEST_AFTER` minutes of one it overlaps sits beside it, in the first lane free at its start; one that
 * starts later than that sits over the latest block it overlaps, indented a step, so the earlier one's title still
 * shows. A block widens into lanes to its right that stay free for its whole time. When a region holds more lanes
 * than fit at `MIN_LANE`, the last lane that fits becomes "+N" and the rest wait there: nothing is lost, only
 * folded.
 */
export function placeBlocks<B extends Timed>(blocks: readonly B[]): DayLayout<B> {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  const groups: Group[] = [];
  const entries: Entry<B>[] = [];

  /** Marks `lane` of `group` busy for `block`, and every lane this one sits over. */
  const occupy = (groupIndex: number, lane: number, block: B) => {
    const group = groups[groupIndex];
    if (group === undefined) return;
    (group.lanes[lane] ??= []).push({ start: block.startMinute, end: block.endMinute });
    const parent = group.parent === undefined ? undefined : entries[group.parent];
    if (parent !== undefined) occupy(parent.group, parent.lane, block);
  };

  for (const block of sorted) {
    const active = entries.flatMap((entry, index) => (entry.block.endMinute > block.startMinute ? [index] : []));
    const near = active.filter((index) => block.startMinute - (entries[index]?.block.startMinute ?? 0) < NEST_AFTER);
    const latest = (list: readonly number[]) => list[list.length - 1];
    const sibling = latest(near);
    const parent = latest(active);
    let groupIndex: number;
    if (sibling !== undefined) groupIndex = entries[sibling]?.group ?? 0;
    else {
      const indent =
        parent === undefined ? 0 : Math.min(MAX_INDENT, (groups[entries[parent]?.group ?? 0]?.indent ?? 0) + 1);
      groups.push({ parent, indent, lanes: [] });
      groupIndex = groups.length - 1;
    }
    const group = groups[groupIndex];
    if (group === undefined) continue;
    const free = group.lanes.findIndex((spans) => spans.every((span) => !overlaps(block, span)));
    const lane = free === -1 ? group.lanes.length : free;
    entries.push({ block, group: groupIndex, lane });
    occupy(groupIndex, lane, block);
  }

  // Each group's region, its lanes that show, and "+N" for the rest; parents come before the groups over them.
  const regions = new Map<number, { readonly left: number; readonly width: number; readonly shown: number }>();
  const slots = new Map<number, Slot>();
  const folded = new Map<number, number>(); // entry -> the group whose "+N" holds it
  for (const [groupIndex, group] of groups.entries()) {
    const parentSlot = group.parent === undefined ? undefined : slots.get(group.parent);
    const parentFolded = group.parent === undefined ? undefined : folded.get(group.parent);
    const left =
      parentSlot === undefined ? 0 : parentSlot.left + (parentSlot.lane / parentSlot.lanes) * parentSlot.width;
    const width = parentSlot === undefined ? 1 : (parentSlot.span / parentSlot.lanes) * parentSlot.width;
    const fits = Math.max(2, Math.floor(width / MIN_LANE + 1e-9));
    const lanes = group.lanes.length;
    const shown = lanes > fits ? fits - 1 : lanes;
    regions.set(groupIndex, { left, width, shown });
    for (const [index, entry] of entries.entries()) {
      if (entry.group !== groupIndex) continue;
      if (parentFolded !== undefined) {
        folded.set(index, parentFolded);
        continue;
      }
      if (entry.lane >= shown) {
        folded.set(index, groupIndex);
        continue;
      }
      const drawn = lanes > fits ? fits : lanes;
      let span = 1;
      while (
        entry.lane + span < shown &&
        (group.lanes[entry.lane + span] ?? []).every((busy) => !overlaps(entry.block, busy))
      )
        span += 1;
      slots.set(index, { left, width, indent: group.indent, lane: entry.lane, lanes: drawn, span });
    }
  }

  const placed = entries.flatMap((entry, index) => {
    const slot = slots.get(index);
    return slot === undefined ? [] : [{ ...entry.block, ...slot }];
  });

  // "+N" chips: per group, one for each run of folded blocks that overlap in time.
  const more: More<B>[] = [];
  for (const [groupIndex, region] of regions) {
    const hidden = entries.flatMap((entry, index) => (folded.get(index) === groupIndex ? [entry.block] : []));
    let run: B[] = [];
    let runEnd = -1;
    const close = () => {
      const first = run[0];
      if (first === undefined) return;
      const group = groups[groupIndex];
      more.push({
        id: `more-${first.id}`,
        startMinute: first.startMinute,
        endMinute: Math.min(runEnd, first.startMinute + MORE_MINUTES),
        hidden: run,
        left: region.left,
        width: region.width,
        indent: group?.indent ?? 0,
        lane: region.shown,
        lanes: region.shown + 1,
        span: 1,
      });
      run = [];
      runEnd = -1;
    };
    for (const block of hidden) {
      // A new chip where the folded block starts: past the run's time, or past where its chip draws.
      const runStart = run[0]?.startMinute ?? block.startMinute;
      if (run.length > 0 && (block.startMinute >= runEnd || block.startMinute >= runStart + MORE_MINUTES)) close();
      run.push(block);
      runEnd = Math.max(runEnd, block.endMinute);
    }
    close();
  }
  return { blocks: placed, more };
}
