/** AttributeSettings' built in copy. */
export const strings = {
  newTitle: 'New attribute',
  editTitle: 'Edit attribute',
  viewTitle: 'Attribute settings',
  create: 'Create attribute',
  creating: 'Creating attribute',
  save: 'Save',
  saving: 'Saving',
  cancel: 'Cancel',
  close: 'Close',
  /** Editing: the footer's quiet danger action, opening the screen's archive confirm. */
  archive: 'Archive',
  /** Editing, under the type: archive this one and start a new one with the same name. */
  wrongType: 'Wrong type? Archive and recreate',
  /** Editing, under the type, for a type with a safe change: opens the Change type step. */
  changeTypeLink: 'Change type…',
  /** The Change type step (the field types pass). */
  changeType: 'Change type',
  changingType: 'Changing type',
  newType: 'New type',
  back: 'Back',
  checkingValues: 'Checking every value…',
  checkFailed: 'Couldn’t check the values.',
  retry: 'Try again',
  noValues: 'No values to convert.',
  allConvert: (count: string, n: number) => (n === 1 ? 'Its 1 value converts.' : `All ${count} values convert.`),
  name: 'Name',
  nameMissing: 'Name the attribute.',
  type: 'Type',
  /** Under the type while creating, for the types whose name alone doesn't say what they hold. */
  typeHints: {
    status: 'Pipeline stages, one per record.',
    actor_reference: 'A workspace member, like an owner.',
    domain: 'A website, like acme.com.',
  } as Partial<Record<string, string>>,
  /** The picker's own labels where they differ from the type's (AC-228). */
  multiSelect: 'Multi select',
  link: 'Link',
  phone: 'Phone',
  apiName: 'API name',
  apiNameLocked: 'Never changes, so links keep working.',
  copyApiName: 'Copy the API name',
  /** On create, a name an archived attribute holds: it can come back instead of a second one. */
  restoreArchived: (name: string) => `Restore the archived ${name}`,
  /** A name a live attribute of this object already goes by. */
  nameTaken: 'Name taken here. Pick another.',
  /** The fold under Name and Type: everything most new attributes never need. */
  moreSettings: 'More settings',
  description: 'Description',
  required: 'Required',
  unique: 'Unique',
  allowMultiple: 'Allow multiple',
  allowMultipleLocked: 'Set when the attribute was made.',
  defaultValue: 'Default value',
  /** The default's kinds for a date and a member (AC-234). */
  noDefault: 'None',
  fixedDate: 'A date',
  daysFromToday: 'Today plus days',
  currentUser: 'Current user',
  chosenMember: 'A member',
  defaultDate: 'Default date',
  defaultMember: 'Default member',
  days: 'Days from today',
  daysInvalid: 'A whole number, 0 to 3,650.',
  /** The type's settings (AC-230). */
  numberDisplay: 'Display',
  plain: 'Plain',
  percent: 'Percent',
  compact: 'Compact',
  decimals: 'Decimals',
  decimalsAuto: 'Auto',
  /** A phone attribute's country for numbers typed without their code. */
  defaultCountry: 'Default country',
  workspaceCountry: 'Workspace’s country',
  searchCountries: 'Search countries',
  defaultCountryHint: 'For numbers without a country code.',
  defaultCurrency: 'Default currency',
  searchCurrencies: 'Search currencies',
  currencyItem: (code: string, name: string) => `${code} · ${name}`,
  options: 'Options',
  stages: 'Stages',
  /** Under an existing attribute's options: they don't wait for Save. */
  optionsSaveAtOnce: 'Options save as you go.',
  /** Create pressed while an option row refuses what was typed. */
  optionsInvalid: 'Fix the options marked above.',
  /** Under the default when it names an archived option (AC-236). */
  archivedDefaultFirst: (label: string) => `Archived. New records get ${label}.`,
  archivedDefaultNone: 'Archived. New records get no value.',
  archivedDefaultSome: 'Some are archived. New records get the others.',
  /** The validation rules' group (spec 0013). */
  rules: 'Rules',
  /** Under the rules: they wait for Save, unlike options. */
  rulesSaveOnSave: 'Rules wait for Save.',
} as const;
