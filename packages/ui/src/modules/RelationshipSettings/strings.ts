/** RelationshipSettings' built in copy. */
export const strings = {
  newTitle: 'New relationship',
  editTitle: 'Edit relationship',
  viewTitle: 'Relationship settings',
  create: 'Create relationship',
  creating: 'Creating relationship',
  save: 'Save',
  saving: 'Saving',
  cancel: 'Cancel',
  /** Back to the attribute form the relationship step took over from. */
  back: 'Back',
  close: 'Close',
  object: 'Object',
  relatedObject: 'Related object',
  chooseObject: 'Choose an object',
  objectMissing: 'Choose an object.',
  /** Under the related object in edit mode: the objects and the cardinality are fixed (#14 widens it). */
  shapeFixed: 'Fixed once created.',
  cardinality: 'How records link',
  /** Each side's question, one per object: "Each person has" One company or Many companies. */
  eachHas: (singular: string) => `Each ${singular} has`,
  one: (singular: string) => `One ${singular}`,
  many: (plural: string) => `Many ${plural}`,
  /** A fixed side's answer, after its question on the card: "Each company has" many people. */
  holdsOne: (singular: string) => `one ${singular}`,
  holdsMany: (plural: string) => `many ${plural}`,
  /** The two questions of a relationship from an object to itself, by side. */
  thisSideHolds: 'This side holds',
  reverseSideHolds: 'The reverse side holds',
  /** The ⓘ beside Related object. */
  aboutRelated: 'The object on the other side. It can be the same one, like a person’s manager.',
  aboutRelatedExample: 'Link each person to their company.',

  /** A side's name field: "Name on People". */
  nameOn: (plural: string) => `Name on ${plural}`,
  /** The second name field of a relationship from an object to itself. */
  reverseNameOn: (plural: string) => `Reverse name on ${plural}`,
  nameMissing: 'Name this side.',
  namesEqual: 'Give each side its own name.',
  /** Said in place of an object the viewer can't see or the dialog doesn't hold. */
  unknownSingular: 'record',
  unknownPlural: 'records',
  unknownObject: 'That object',
} as const;
