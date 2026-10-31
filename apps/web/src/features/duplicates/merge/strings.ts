// The merge dialog's words (spec 0049, AC-4910 to AC-4917): plain and short.

/** "3 links", "1 note": a count and its noun, one or many. */
const counted = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/** A list read aloud: "3 links, 2 notes and 1 list entry". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/** The merge dialog's copy. */
export const strings = {
  title: (singular: string) => `Merge ${singular.toLowerCase()}`,
  /** The More menu's entry, and its record search. */
  mergeWith: 'Merge with…',
  searchRecords: (plural: string) => `Search ${plural.toLowerCase()}`,
  noMatches: 'No matches',
  loading: 'Loading both records',
  loadFailed: 'Couldn’t load the two records.',
  tryAgain: 'Try again',
  swap: 'Swap',
  swapLabel: 'Keep the other record instead',
  kept: 'Kept',
  mergedAway: 'Merged away',
  /** AC-4916: what will happen, in one breath. */
  summary: (merged: string, kept: string) => `${merged} will be merged into ${kept}.`,
  moves: (moved: {
    readonly links: number;
    readonly notes: number;
    readonly entries: number;
    readonly others: number;
  }) => {
    const parts = [
      ...(moved.links > 0 ? [counted(moved.links, 'link', 'links')] : []),
      ...(moved.notes > 0 ? [counted(moved.notes, 'note', 'notes')] : []),
      ...(moved.entries > 0 ? [counted(moved.entries, 'list entry', 'list entries')] : []),
      ...(moved.others > 0 ? [counted(moved.others, 'other item', 'other items')] : []),
    ];
    return parts.length === 0 ? '' : `Its ${listed(parts)} move over.`;
  },
  cantUndo: 'This can’t be undone.',
  /** Above the rows: what the picks are for. */
  pickHint: 'Pick the value to keep where they differ. Everything else is combined.',
  noRows: 'Nothing differs that you can choose: every other value is combined.',
  empty: 'Empty',
  unnamed: 'Unnamed record',
  tooLarge: 'Too much is attached to merge in one go.',
  cancel: 'Cancel',
  merge: 'Merge',
  merging: 'Merging…',
  /** AC-4916: the toast once it lands. */
  merged: (kept: string) => `Merged into ${kept}`,
  /** AC-4914: a merged record's address. */
  wasMerged: (merged: string, kept: string) => `${merged} was merged into ${kept}`,
} as const;
