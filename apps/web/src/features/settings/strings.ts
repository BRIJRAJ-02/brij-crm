/** Settings' copy (spec 0012): the frame, Objects, the new object dialog, an object's tabs and the archive confirm. */
export const strings = {
  settings: 'Settings',
  loading: 'Loading',
  /** The settings sidebar (spec 0026): its way back out, its groups and the entries the other pages' copy doesn't name. */
  leaveSettings: 'Leave settings',
  account: 'Account',
  workspace: 'Workspace',
  scheduling: 'Scheduling',
  preferences: 'Preferences',
  bookingPages: 'Booking pages',
  forms: 'Forms',
  /** After Booking pages and Forms: they open in Captures, outside Settings. */
  inCaptures: 'In Captures',
  /** The settings navigation's entries. */
  objects: 'Objects',
  objectsDescription: 'Shape the records your workspace keeps.',
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
  kindColumn: 'Type',
  attributesColumn: 'Attributes',
  actionsColumn: 'Actions',
  standard: 'Standard',
  custom: 'Custom',
  attributeCount: (count: number, shown: string) => (count === 1 ? '1 attribute' : `${shown} attributes`),
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
  noLiveObjectsText: 'Restore one below or create a new one.',
  noArchived: 'Nothing is archived',
  noArchivedText: 'Archived objects show here, with their records kept.',
  noLiveObjectsMemberText: 'A workspace owner or admin can restore one or create a new one.',
  moving: 'Moving',
  /** A failed move, archive or restore: what failed, then why in the server's words. */
  moveFailed: (plural: string, why: string) => `Couldn’t move ${plural}. ${why}`,
  restoreFailed: (plural: string, why: string) => `Couldn’t restore ${plural}. ${why}`,
  readOnlyNote: 'Only workspace owners and admins can change objects and attributes.',
  loadFailed: 'Couldn’t load the objects',
  loadFailedObject: 'Couldn’t load this object',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** The new object dialog and the Configuration tab. */
  singularName: 'Singular name',
  pluralName: 'Plural name',
  apiName: 'API name',
  apiNameHint: 'Used in the API and in links. It can’t change once the object is made.',
  apiNameLocked: 'API names never change, so links and integrations keep working.',
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
  archivedObjectAttributes: (plural: string) => `${plural} is archived. Restore it to see its attributes here.`,
  /** The danger zone. */
  dangerZone: 'Archive',
  dangerArchive: (plural: string) => `Archive ${plural}`,
  dangerArchiveText: 'It leaves the sidebar and every picker. Its records, values and history are kept.',
  dangerRestore: (plural: string) => `Restore ${plural}`,
  dangerRestoreText: 'It comes back to the sidebar at its old place, with everything it held.',
  /** The archive confirm (spec 0012, screens). */
  confirmTitle: (plural: string) => `Archive ${plural}?`,
  confirmText: (records: string, count: number, atLeast: boolean) =>
    atLeast
      ? `It leaves the sidebar and its records, at least ${records} of them, are kept. Relationship fields that point to it are hidden until you restore it.`
      : count === 0
        ? 'It leaves the sidebar. It holds no records yet. Relationship fields that point to it are hidden until you restore it.'
        : count === 1
          ? 'It leaves the sidebar and its 1 record is kept. Relationship fields that point to it are hidden until you restore it.'
          : `It leaves the sidebar and its ${records} records are kept. Relationship fields that point to it are hidden until you restore it.`,
  confirmCounting:
    'It leaves the sidebar and its records are kept. Relationship fields that point to it are hidden until you restore it.',
  archiving: 'Archiving',
  archivedToast: (plural: string) => `${plural} archived.`,
  restoredToast: (plural: string) => `${plural} restored.`,
  /** An address in settings that names nothing. */
  missingTitle: 'Page not found',
  missingText: 'There’s nothing at this address.',
  checkAddress: 'Check the address for a typo, or go back to settings.',
  backToSettings: 'Back to settings',
  backToObjects: 'Back to Objects',
} as const;
