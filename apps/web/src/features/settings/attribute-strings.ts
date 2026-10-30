/** The attribute screens' copy (spec 0012, milestone 2): the Attributes tab, the dialog's toasts and the archive confirm. */
export const strings = {
  /** Archiving an option a default named (late trap #34): what new records get now, in the default Callout's words. */
  defaultOptionDropped: (option: string, field: string) =>
    `${option} archived, so ${field}’s default gives new records the others.`,
  defaultOptionMoved: (option: string, field: string, first: string) =>
    `${option} archived, so new records get ${first} as their ${field}.`,
  defaultOptionGone: (option: string, field: string) => `${option} archived, so new records get no ${field}.`,
  undo: 'Undo',
  /** Under Unique when a Save is refused for values records share: the object's table. */
  openTable: (plural: string) => `Open ${plural}`,
  /** A Required When rule, read only in the dialog: the attributes its condition looks at (none named: hidden). */
  requiredWhenLine: (titles: readonly string[]) => {
    const last = titles.at(-1);
    if (last === undefined) return 'Required when a condition holds (set through the API).';
    const named = titles.length === 1 ? last : `${titles.slice(0, -1).join(', ')} and ${last}`;
    return `Required when ${named} ${titles.length === 1 ? 'matches' : 'match'} (set through the API).`;
  },
  newAttribute: 'New attribute',
  /** The attribute meter (AC-227). */
  attributes: 'Attributes',
  attributeLimit: 'Attributes',
  /** The Attributes tab's table. */
  titleColumn: 'Attribute',
  typeColumn: 'Type',
  rulesColumn: 'Rules',
  actionsColumn: 'Actions',
  system: 'System',
  archived: 'Archived',
  archivedAttributes: 'Archived attributes',
  noAttributes: 'No attributes yet',
  noAttributesText: 'Add one with New attribute.',
  noAttributesMemberText: 'A workspace owner or admin can add one.',
  /** Badges (AC-227). */
  primary: 'Primary',
  /** Primary's InfoTip in the Rules column. */
  primaryHelp: 'The attribute that names each record. It shows as the record’s title in tables, links and search.',
  required: 'Required',
  unique: 'Unique',
  /** How many validation rules an attribute holds (spec 0013). */
  validationRules: (count: number) => (count === 1 ? '1 rule' : `${String(count)} rules`),
  hasDefault: 'Default',
  /** The default names an archived option (AC-236). */
  defaultArchived: 'Default archived',
  /** An option write refused (spec 0012, milestone 3): by Add option, or in a toast once the dialog closed. */
  optionAddRefused: (label: string, why: string) => `Couldn’t add “${label}”. ${why}`,
  optionNotSaved: (label: string, why: string) => `Couldn’t save the option “${label}”. ${why}`,
  /** An attribute archived because its relationship's other object is (AC-226). */
  archivedBy: (plural: string) => `Links to ${plural}, which is archived`,
  archivedByHidden: 'Links to an archived object',
  rowActions: (title: string) => `Actions for ${title}`,
  edit: 'Edit',
  moveUp: 'Move up',
  moveDown: 'Move down',
  archive: 'Archive',
  restore: 'Restore',
  restoring: 'Restoring',
  moving: 'Moving',
  /** Said after a move, so the new place is heard. */
  moved: (title: string, place: number, of: number) => `${title} moved to ${String(place)} of ${String(of)}.`,
  moveFailed: (title: string, why: string) => `Couldn’t move ${title}. ${why}`,
  restoreFailed: (title: string, why: string) => `Couldn’t restore ${title}. ${why}`,
  restored: (titles: string) => `${titles} restored.`,
  archivedToast: (titles: string) => `${titles} archived.`,
  created: (title: string) => `${title} added.`,
  saved: (title: string) => `${title} saved.`,
  /** Two ends, as one toast names them. */
  both: (first: string, second: string) => `${first} and ${second}`,
  readOnlyNote: 'Only owners and admins can change this.',
  /** Why a dialog opened read only. */
  systemReason: (title: string) => `${title} is set by the system.`,
  memberReason: 'Only workspace owners and admins can change attributes.',
  /** The type picker's entry that hands over to the relationship dialog (spec 0014). */
  relationship: 'Relationship',
  loading: 'Loading attributes',
  loadFailed: 'Couldn’t load the attributes',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** The archive confirm (spec 0012, screens). */
  confirmTitle: (title: string) => `Archive ${title}?`,
  confirmText: 'It leaves every table and form. Its values are kept and come back if you restore it.',
  confirmBoth:
    'It leaves every table and form. Its values are kept and come back if you restore it. It is one end of a relationship: the other end is archived with it, and both come back together.',
  archiving: 'Archiving',
  confirmArchive: (title: string) => `Archive ${title}`,
  cancel: 'Cancel',
  /** The table's column menu (spec 0012, screens). */
  editAttribute: 'Edit attribute',
  archiveAttribute: 'Archive attribute',
  addAttribute: 'Add attribute',
} as const;
