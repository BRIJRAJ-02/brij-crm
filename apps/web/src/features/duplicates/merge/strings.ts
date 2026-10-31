// The merge dialog's words (spec 0049, AC-4910 to AC-4917): plain and short.

/** "3 links", "1 note": a count and its noun, one or many. */
const counted = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/** A list read aloud: "3 links, 2 notes and 1 list entry". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/** What moves over, counted by kind. */
interface Moved {
  readonly links: number;
  readonly notes: number;
  readonly entries: number;
  readonly others: number;
}

/** The merge dialog's copy. */
export const strings = {
  title: (plural: string) => `Merge ${plural.toLowerCase()}`,
  /** The More menu's entry, and the record search's label. */
  mergeWith: 'Merge with…',
  pickerLabel: 'Merge with',
  pickAnother: 'Pick another record. A record can’t be merged with itself.',
  searchFailed: 'Search didn’t work. Keep typing to try again.',
  loading: 'Loading both records',
  loadFailed: 'Couldn’t load the two records.',
  tryAgain: 'Try again',
  swap: 'Swap',
  /** Swap's name: its visible word first. */
  swapLabel: 'Swap, keep the other record instead',
  /** Each side's card: its role, then its name, so two records with one name still tell apart. */
  keptSide: (name: string) => `Kept · ${name}`,
  mergedSide: (name: string) => `Merged away · ${name}`,
  /** AC-4916: what will happen, in one breath. */
  summary: (merged: string, kept: string) => `${merged} will be merged into ${kept}.`,
  summarySameName: (name: string) => `The newer ${name} will be merged into the older one.`,
  moves: (moved: Moved) => {
    const parts = [
      ...(moved.links > 0 ? [counted(moved.links, 'link', 'links')] : []),
      ...(moved.notes > 0 ? [counted(moved.notes, 'note', 'notes')] : []),
      ...(moved.entries > 0 ? [counted(moved.entries, 'list entry', 'list entries')] : []),
      ...(moved.others > 0 ? [counted(moved.others, 'more item', 'more items')] : []),
    ];
    if (parts.length === 0) return '';
    const isOne = parts.length === 1 && moved.links + moved.notes + moved.entries + moved.others === 1;
    return `Its ${listed(parts)} ${isOne ? 'moves' : 'move'} over.`;
  },
  cantUndo: 'This can’t be undone.',
  /** Above the rows: what the picks are for. */
  pickHint: 'Pick the value to keep where they differ. Everything else is combined.',
  noRows: 'Nothing differs that you can choose. Every other value is combined.',
  unnamed: (singular: string) => `Unnamed ${singular.toLowerCase()}`,
  tooLarge: 'Too much is attached to merge in one go. Remove some links or list entries first, then try again.',
  cancel: 'Cancel',
  merge: 'Merge',
  merging: 'Merging…',
  /** AC-4916: the toast once it lands. */
  merged: (kept: string) => `Merged into ${kept}`,
  /** AC-4914: a merged record's address. */
  wasMerged: (merged: string, kept: string) => `${merged} was merged into ${kept}`,
} as const;
