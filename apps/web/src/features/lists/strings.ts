// Every word the lists screens show (spec 0048): sentence case, short and plain.

export const strings = {
  // The sidebar and the New list dialog (AC-4801 to AC-4805).
  newList: 'New list',
  newListUnavailable: 'Couldn’t open. Reload and try again.',
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
  noWritableObjects: 'You can’t change any object’s records.',
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
  notFoundText: 'It may be archived, or you don’t have access.',
  addField: 'Add field',
  unnamed: (singular: string) => `Unnamed ${singular.toLowerCase()}`,
  fieldAdded: (title: string) => `${title} added`,
  readOnly: (name: string) => `You can only view ${name}.`,

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

  // Lists around the record (AC-4822 to AC-4827).
  listsSection: 'Lists',
  notInAny: 'Not in any list',
  openList: 'Open list',
  entryActions: (list: string) => `${list} actions`,
  addToListMenu: 'Add to list',
  alreadyInShort: 'Already in',
  importAction: 'Import',
  // A counted add of many (AC-4825): undone from its finish toast, so the confirm stays plain.
  confirmAddTitle: (records: string, list: string) => `Add ${records} to ${list}?`,
  confirmAddText: 'Undo takes them out again.',
  confirmAddAction: 'Add',
  addedMany: (count: number, list: string) => `Added ${count.toLocaleString('en')} to ${list}`,
  addedManyKept: (said: string, already: number) =>
    `${said}. ${already.toLocaleString('en')} ${already === 1 ? 'was' : 'were'} already in it`,
  allAlreadyIn: (list: string) => `Already in ${list}`,
  noneAdded: (reason: string) => `Nothing was added. ${reason}`,
  addFailed: 'Nothing was added. Try again.',
  addRecordTitle: (name: string, list: string) => `Add ${name} to ${list}`,

  needsValues: (list: string) => `${list} needs a value. Use Add to list.`,

  // The column picker's two groups (AC-4807).
  listFieldsGroup: (list: string) => `${list} fields`,
  objectFieldsGroup: (plural: string) => `${plural} fields`,

  // Settings and archive (AC-4828 to AC-4832).
  settingsTitle: 'Lists',
  settingsGeneral: 'General',
  settingsFields: 'Fields',
  settingsTabs: (list: string) => `${list} settings`,
  nameColumn: 'Name',
  objectColumn: 'Object',
  createdByColumn: 'Created by',
  entriesColumn: 'Entries',
  settingsEmpty: 'No lists yet',
  archivedSection: 'Archived',
  actionsColumn: 'Actions',
  look: 'Icon and colour',
  eachRecordOnce: 'Each record once',
  save: 'Save',
  saved: (name: string) => `${name} saved`,
  saveFailed: 'The list wasn’t saved. Try again.',
  archive: 'Archive list',
  archiveTitle: (name: string) => `Archive ${name}?`,
  archiveText: 'It leaves everyone’s sidebar. Restore it from Settings › Lists.',
  archiveAction: 'Archive',
  archivedToast: (name: string) => `${name} archived`,
  archiveFailed: 'The list wasn’t archived. Try again.',
  restore: 'Restore',
  restoredToast: (name: string) => `${name} restored`,
  restoreFailed: 'The list wasn’t restored. Try again.',
  archivedTitle: (name: string) => `${name} is archived`,
  archivedText: 'Its entries are kept.',
  // A list whose object is archived (AC-4832): it returns with the object.
  objectArchivedText: (plural: string) => `${plural} is archived too. Restoring it brings this list back.`,
  onlyManagers: (maker: string | undefined) =>
    maker === undefined
      ? 'Only owners and admins can change this list.'
      : `Only ${maker}, owners and admins can change this list.`,
  listAtLimit: '500 of 500 lists, archived ones included.',
  fieldLimit: 'Fields',
  menu: 'List menu',
  importList: 'Import',
  clearFilters: 'Clear filters',
  filteredEmpty: (plural: string) => `No ${plural.toLowerCase()} match.`,
} as const;
