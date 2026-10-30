// Every word the lists screens show (spec 0048): sentence case, short and plain.

export const strings = {
  // The sidebar and the New list dialog (AC-4801 to AC-4805).
  newList: 'New list',
  newListUnavailable: 'New list couldn’t open. Reload the page and try again.',
  noLists: 'No lists yet',
  createList: 'Create list',
  creatingList: 'Creating…',
  cancel: 'Cancel',
  object: 'List of',
  name: 'Name',
  namePlaceholder: 'Sales pipeline',
  nameMissing: 'Give the list a name.',
  startWith: 'Start with',
  blank: 'Blank',
  pipeline: 'Pipeline',
  noWritableObjects: 'You can’t change records of any object, so there is nothing to make a list of.',
  createFailed: 'The list wasn’t made. Try again.',
  listMade: (name: string) => `${name} is ready`,
  hidden: (name: string) => `${name} hidden from the sidebar`,
  undo: 'Undo',

  // The list page (AC-4806 to AC-4812, AC-4842).
  add: (singular: string) => `Add ${singular.toLowerCase()}`,
  table: 'Table',
  board: 'Board',
  layout: 'Layout',
  count: (count: string, isOne: boolean) => `${count} ${isOne ? 'entry' : 'entries'}`,
  empty: (plural: string) => `No ${plural.toLowerCase()} in this list yet.`,
  failed: 'The list didn’t load.',
  notFoundTitle: 'This list isn’t here',
  notFoundText: 'It may have been archived, or you may not have access to it.',
  addField: 'Add field',
  unnamed: (singular: string) => `Unnamed ${singular.toLowerCase()}`,
  fieldAdded: (title: string) => `${title} added`,
  readOnly: (name: string) => `You can view ${name} but not change it.`,

  // Adding (AC-4813 to AC-4816).
  addTitle: (singular: string, list: string) => `Add ${singular.toLowerCase()} to ${list}`,
  pick: (singular: string) => `Pick a ${singular.toLowerCase()}`,
  addToList: 'Add to list',
  adding: 'Adding…',
  alreadyIn: 'Already in this list',
  added: (name: string, list: string) => `Added ${name} to ${list}`,
  fieldMissing: (title: string) => `Give ${title} a value.`,

  // Removing (AC-4817, AC-4818).
  removeTitle: (count: number, list: string) => `Remove ${count.toLocaleString('en')} entries from ${list}?`,
  removeText: 'Undo brings them back with their values.',
  remove: 'Remove',
  removeSelected: 'Remove from list',
  keptSome: (said: string, kept: number, reason: string) => `${said}. ${kept.toLocaleString('en')} stayed: ${reason}`,
  removeFailed: 'Those entries weren’t removed. Try again.',
  removedOne: (name: string, list: string) => `Removed ${name} from ${list}`,
  removedMany: (count: number, list: string) =>
    `Removed ${count.toLocaleString('en')} ${count === 1 ? 'entry' : 'entries'} from ${list}`,

  // Boards (AC-4815, AC-4820, AC-4821).
  noGroupField: (list: string) => `${list} has no status or select field to group by.`,
  noValue: (title: string) => `No ${title.toLowerCase()}`,
  boardOf: (list: string, field: string) => `${list} by ${field.toLowerCase()}`,
} as const;
