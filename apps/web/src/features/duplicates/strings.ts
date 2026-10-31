import type { DuplicateReason } from '@crm/data';

/** Likely duplicates' copy (spec 0049): the hint, the record banner and the Duplicates page. Short on purpose. */
export const strings = {
  /** Why two records look like one (AC-4901). */
  reason: {
    name_company: 'Same name and company',
    name: 'Same name',
    email: 'Same email',
    domain: 'Same domain',
  } satisfies Readonly<Record<DuplicateReason, string>>,
  /** The hint under a field (AC-4904). */
  exists: (name: string) => `${name} already exists`,
  existMany: (count: number) => `${String(count)} records look like this`,
  open: 'Open',
  merge: 'Merge',
  notDuplicate: 'Not a duplicate',
  /** The record banner (AC-4906). */
  possibleOfLead: 'Possible duplicate of ',
  possibleMany: (count: number) => `${String(count)} possible duplicates`,
  review: 'Review',
  /** The view menu's entry and the page (AC-4907). */
  findDuplicates: 'Find duplicates',
  title: (pluralName: string) => `Duplicates in ${pluralName}`,
  tableLabel: 'Likely duplicates',
  columns: { record: 'Record', other: 'Looks like', reason: 'Why', actions: 'Actions' },
  showMore: 'Show more',
  emptyTitle: (pluralName: string) => `No likely duplicates in ${pluralName}`,
  emptyText: 'Records with the same name, email or domain show here.',
  emptyRecord: 'No likely duplicates of this record',
  showAll: 'Show all',
  narrowed: 'Showing one record’s likely duplicates.',
  failedTitle: 'Duplicates couldn’t load',
  failedText: 'Check your connection, then try again.',
  tryAgain: 'Try again',
  moreFailed: 'More couldn’t load.',
  noAccess: (pluralName: string) => `You can’t see ${pluralName}`,
  noAccessText: 'Ask a workspace admin for access.',
  /** Not a duplicate's toast, with Undo (AC-4908). */
  dismissed: 'Marked as not a duplicate',
  undo: 'Undo',
  dismissFailed: 'Couldn’t mark it as not a duplicate. It’s back in the list.',
  restoreFailed: 'Couldn’t undo.',
  retry: 'Retry',
  unnamed: 'Unnamed record',
};
