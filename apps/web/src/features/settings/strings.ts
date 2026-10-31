import { sharedStrings } from '@crm/ui';

/** Settings' copy (spec 0012): the frame, Objects, the new object dialog, an object's tabs and the archive confirm. */
export const strings = {
  settings: 'Settings',
  loading: 'Loading',
  /** The settings sidebar (spec 0026): its way back out, its groups and the entries the other pages' copy doesn't name. */
  leaveSettings: 'Leave settings',
  account: 'Account',
  workspace: 'Workspace',
  preferences: 'Preferences',
  /** The settings navigation's entries. */
  objects: 'Objects',
  trash: 'Trash',
  newObject: 'New object',
  creatingObject: 'Creating object',
  createObject: 'Create object',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving',
  retry: 'Retry',
  /** The custom object meter (AC-222). */
  customObjects: 'Custom objects',
  /** The objects table. */
  objectColumn: 'Object',
  /** The Object header's InfoTip, for those who may drag the rows (SW15). */
  kindColumn: 'Type',
  attributesColumn: 'Attributes',
  recordsColumn: 'Records',
  /** Under a record rule, or when the counts didn't load: no number to give. */
  recordsUnknown: '—',
  actionsColumn: 'Actions',
  standard: 'Standard',
  custom: 'Custom',
  attributeCount: (count: number, shown: string) => (count === 1 ? '1 attribute' : `${shown} attributes`),
  recordCount: (count: number, shown: string) => (count === 1 ? '1 record' : `${shown} records`),
  rowActions: (plural: string) => `Actions for ${plural}`,
  open: 'Open',
  moveUp: 'Move up',
  moveDown: 'Move down',
  archive: 'Archive',
  restore: 'Restore',
  restoring: 'Restoring',
  /** Said after a move from the row menu, so the new place is heard. */
  moved: (plural: string, place: number, of: number) => `${plural} moved to ${String(place)} of ${String(of)}.`,
  archived: 'Archived',
  archivedObjects: 'Archived objects',
  noLiveObjects: 'No live objects',
  /** Only a member who can't add one needs a line; the page's New object is the way on for the rest. */
  noLiveObjectsMemberText: 'Ask an owner or admin.',
  moving: 'Moving',
  /** A failed move, archive or restore: what failed, then why in the server's words. */
  moveFailed: (plural: string, why: string) => `Couldn’t move ${plural}. ${why}`,
  restoreFailed: (plural: string, why: string) => `Couldn’t restore ${plural}. ${why}`,
  loadFailed: 'Couldn’t load the objects',
  loadFailedObject: 'Couldn’t load this object',
  /** The new object dialog and the Configuration tab. */
  singularName: 'Singular name',
  /** The New object dialog's single flow: the name, the guesses that follow it and the inline attributes. */
  objectName: 'Name',
  objectNamePlaceholder: 'Project, Partner, Invoice…',
  followsName: (plural: string) => plural,
  /** A plural Name: the singular guessed from it, said beside the plural so nothing changes unseen. */
  followsNames: (singular: string, plural: string) => `One ${singular}, many ${plural}`,
  namesAndApi: 'More settings',
  firstAttributes: 'Attributes',
  nameIsAlways: 'Name is added for you',
  attributePlaceholder: 'Add an attribute, then press Enter',
  attributeMore: 'Another attribute',
  attributeN: (n: number) => `Attribute ${String(n)}`,
  attributeType: (title: string) => `Type of attribute ${title}`,
  removeAttribute: (title: string) => `Remove attribute ${title}`,
  starters: 'Suggested attributes',
  nameIsDefault: 'Every object already has Name.',
  attributeRepeated: 'Already in the list.',
  pluralName: 'Plural name',
  apiName: 'API name',
  apiNameHint: 'Can’t change later.',
  apiNameLocked: 'Can’t change later.',
  objectId: 'Object ID',
  objectIdReason: 'Set by the system.',
  copyApiName: 'Copy API name',
  copyObjectId: 'Copy object ID',
  icon: 'Icon',
  changeIcon: (name: string) => `Icon: ${name}`,
  iconPicker: 'Object icon',
  colour: 'Colour',
  nameMissing: 'Give a name.',
  apiNameTaken: 'An object already uses this API name.',
  apiNameReserved: 'That API name is reserved.',
  /** What a Save in the Configuration tab says once it lands. */
  saved: (plural: string) => `${plural} saved.`,
  created: (plural: string) => `${plural} created.`,
  /** An object's tabs. */
  objectTabs: (plural: string) => `${plural} settings`,
  attributesTab: 'Attributes',
  configurationTab: 'Configuration',
  system: 'System',
  primary: 'Primary',
  required: 'Required',
  unique: 'Unique',
  titleColumn: 'Title',
  typeColumn: 'Type',
  rulesColumn: 'Rules',
  noAttributes: 'No attributes yet',
  /** An archived object's attributes tab, for everyone; owners and admins get Restore beside it. */
  archivedObjectAttributes: (plural: string) => `${plural} is archived. Its records are kept.`,
  /** The Configuration tab's first section: the form. */
  lookSection: 'Names and look',
  /** The danger zone. */
  dangerZone: 'Danger zone',
  /** The same section once the object is archived: bringing it back isn't dangerous. */
  restoreZone: 'Restore',
  /** The Configuration tab's IDs, apart from what Save changes. */
  /** The Configuration tab's quiet fold at the foot: the API name and object ID. */
  developer: 'Developer',
  idsSection: 'Identifiers',
  /** The attribute that names the object's records (late trap #15), saved as it is picked. */
  recordNameSection: 'Record names',
  /** A toast's way back: an archive's restore, or the record name's change. */
  undo: 'Undo',
  recordNameTitle: 'Name attribute',
  recordNameText: 'Names each record in chips, page titles and search.',
  recordNameStandard: (title: string) =>
    `People, Companies and Deals are always named by their ${title === '' ? 'Name' : title}.`,
  recordNameNone:
    'To name records by something else, add a text, email, domain, link or personal name attribute that holds one value.',
  recordNameUnavailable: "Couldn't load this object's attributes. Reload to choose one.",
  recordNameChanged: (plural: string, title: string) => `${plural} are now named by ${title}.`,
  recordNameFailed: (why: string) => `Couldn't change the name attribute. ${why}`,
  recordNameUndoStale: sharedStrings.undoStale,
  dangerArchive: (plural: string) => `Archive ${plural}`,
  dangerArchiveText: 'Hidden from the sidebar. Records are kept.',
  dangerRestore: (plural: string) => `Restore ${plural}`,
  dangerRestoreText: 'Back in the sidebar, as it was.',
  /** The archive confirm (spec 0012, screens). */
  confirmTitle: (plural: string) => `Archive ${plural}?`,
  confirmText: (records: string, count: number, atLeast: boolean) =>
    atLeast
      ? `Hidden from the sidebar. At least ${records} records are kept.`
      : count === 0
        ? 'Hidden from the sidebar. It holds no records.'
        : count === 1
          ? 'Hidden from the sidebar. Its 1 record is kept.'
          : `Hidden from the sidebar. Its ${records} records are kept.`,
  confirmCounting: 'Hidden from the sidebar. Its records are kept.',
  archiving: 'Archiving',
  archivedToast: (plural: string) => `${plural} archived.`,
  restoredToast: (plural: string) => `${plural} restored.`,
  /** An object's settings' way to its records ("Open Projects"). */
  openRecords: (plural: string) => `Open ${plural}`,
  /** An address in settings that names nothing. */
  missingTitle: 'Page not found',
  missingText: 'There’s nothing at this address.',
  backToSettings: 'Back to settings',
  backToObjects: 'Back to Objects',
} as const;
