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
  objectsFixed: 'The objects can’t change once the relationship exists.',
  cardinality: 'How records link',
  cardinalityFixed: 'This can’t change once the relationship exists.',
  /**
   * One cardinality as a plain choice, phrased with both objects (spec 0014,
   * AC-282): "Each person has one company, each company has many people".
   */
  choice: (
    near: { readonly singular: string; readonly plural: string; readonly isOne: boolean },
    far: { readonly singular: string; readonly plural: string; readonly isOne: boolean },
  ) =>
    `Each ${near.singular} has ${howMany(near.isOne, far.singular, far.plural)}, each ${far.singular} has ${howMany(far.isOne, near.singular, near.plural)}`,
  /** A side's name field: "Name on People". */
  nameOn: (plural: string) => `Name on ${plural}`,
  /** The second name field of a relationship from an object to itself. */
  reverseNameOn: (plural: string) => `Reverse name on ${plural}`,
  nameHint: 'Shows as a column. Its API name comes from it and never changes.',
  nameMissing: 'Name this side.',
  namesEqual: 'Give each side its own name.',
  /** One side in the sentence under the choices: "People get Company, holding one company." */
  sideSentence: (onPlural: string, title: string, isOne: boolean, singular: string, plural: string) =>
    `${onPlural} get ${title === '' ? 'a column' : `“${title}”`}, holding ${howMany(isOne, singular, plural)}.`,
  /** Both sides of a relationship from an object to itself, in one sentence. */
  selfSentence: (
    onPlural: string,
    first: { readonly title: string; readonly isOne: boolean },
    second: { readonly title: string; readonly isOne: boolean },
    singular: string,
    plural: string,
  ) =>
    `${onPlural} get ${first.title === '' ? 'a column' : `“${first.title}”`}, holding ${howMany(first.isOne, singular, plural)}, and ${second.title === '' ? 'a column' : `“${second.title}”`}, holding ${howMany(second.isOne, singular, plural)}.`,
  /** Said in place of an object the viewer can't see or the dialog doesn't hold. */
  unknownSingular: 'record',
  unknownPlural: 'records',
  unknownObject: 'That object',
} as const;
