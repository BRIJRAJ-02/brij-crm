/** Words for a record count: "one company", "many companies". */
const howMany = (isOne: boolean, singular: string, plural: string) => (isOne ? `one ${singular}` : `many ${plural}`);

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
  close: 'Close',
  object: 'Object',
  relatedObject: 'Related object',
  chooseObject: 'Choose an object',
  objectMissing: 'Choose an object for this side.',
  /** Under the related object in edit mode: the objects and the cardinality are fixed (#14 widens it). */
  shapeFixed: 'The objects and how records link can’t change once the relationship exists.',
  cardinality: 'How records link',
  /** The ⓘ beside the first side's question: what one and many mean. */
  /** Each side's question, one per object: "Each person has" One company or Many companies. */
  eachHas: (singular: string) => `Each ${singular} has`,
  one: (singular: string) => `One ${singular}`,
  many: (plural: string) => `Many ${plural}`,
  /** The two questions of a relationship from an object to itself, by side. */
  thisSideHolds: 'This side holds',
  reverseSideHolds: 'The reverse side holds',
  /** The ⓘ beside Related object. */
  aboutRelated:
    'The object on the other side. Records of the two objects can then link to each other. It can be the same object, such as a person’s manager.',
  aboutRelatedExample: 'Companies and People: link each person to the company they work at.',

  /**
   * One cardinality as a plain choice, phrased with both objects (spec 0014,
   * AC-282): "Each person has one company, each company has many people".
   */
  choice: (
    near: { readonly singular: string; readonly plural: string; readonly isOne: boolean },
    far: { readonly singular: string; readonly plural: string; readonly isOne: boolean },
  ) =>
    `Each ${near.singular} has ${howMany(near.isOne, far.singular, far.plural)}, each ${far.singular} has ${howMany(far.isOne, near.singular, near.plural)}`,
  /**
   * One cardinality from an object to itself, by side: "This side holds one
   * person, the reverse side holds many people".
   */
  selfChoice: (fromOne: boolean, toOne: boolean, singular: string, plural: string) =>
    `This side holds ${howMany(fromOne, singular, plural)}, the reverse side holds ${howMany(toOne, singular, plural)}`,
  /** A side's name field: "Name on People". */
  nameOn: (plural: string) => `Name on ${plural}`,
  /** The second name field of a relationship from an object to itself. */
  reverseNameOn: (plural: string) => `Reverse name on ${plural}`,
  nameHint: 'Each name shows as a column on its object.',
  nameMissing: 'Name this side.',
  namesEqual: 'Give each side its own name.',
  /** Said in place of an object the viewer can't see or the dialog doesn't hold. */
  unknownSingular: 'record',
  unknownPlural: 'records',
  unknownObject: 'That object',
} as const;
