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
  name: 'Name',
  nameMissing: 'Name the attribute.',
  type: 'Type',
  /** Under the type once it exists (#14 removes it when types can change). */
  typeLater: 'Changing the type comes later.',
  /** Under the type while creating, for the types whose name alone doesn't say what they hold. */
  typeHints: {
    status: 'Stages a record moves through, like a deal’s pipeline. Each record is at one stage.',
    actor_reference: 'Someone in this workspace, like a record’s owner.',
    domain: 'A website without its path, like acme.com.',
  } as Partial<Record<string, string>>,
  /** The picker's own labels where they differ from the type's (AC-228). */
  multiSelect: 'Multi select',
  link: 'Link',
  phone: 'Phone',
  apiName: 'API name',
  apiNameHint: 'Used by the API and integrations. It can’t change once the attribute exists.',
  apiNameLocked: 'API names never change, so links and integrations keep working.',
  copyApiName: 'Copy the API name',
  description: 'Description',
  descriptionHint: 'Tells your team what this attribute holds.',
  required: 'Required',
  requiredHint: 'New records need a value. Records already empty stay as they are.',
  unique: 'Unique',
  uniqueHint: 'No two records can share a value.',
  allowMultiple: 'Allow multiple',
  allowMultipleHint: 'Each record can hold several.',
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
  daysHint: 'From 0 to 3,650. New records get today’s date plus this many days.',
  daysInvalid: 'Give a whole number of days from 0 to 3,650.',
  /** The type's settings (AC-230). */
  numberDisplay: 'Display',
  plain: 'Plain',
  percent: 'Percent',
  defaultCurrency: 'Default currency',
  defaultCurrencyHint: 'New amounts start in this currency; each value keeps its own.',
  searchCurrencies: 'Search currencies',
  currencyItem: (code: string, name: string) => `${code} · ${name}`,
  options: 'Options',
  stages: 'Stages',
  /** Under an existing attribute's options: they don't wait for Save. */
  optionsSaveAtOnce: 'Changes to options save as you make them.',
  /** Create pressed while an option row refuses what was typed. */
  optionsInvalid: 'Fix the options marked above, then create the attribute.',
  /** Under the default when it names an archived option (AC-236). */
  archivedDefaultFirst: (label: string) => `This option is archived. New records get ${label}.`,
  archivedDefaultNone: 'This option is archived. New records get no value.',
  archivedDefaultSome: 'Some of these options are archived. New records get the others.',
  /** The validation rules' group (spec 0013). */
  rules: 'Rules',
  /** Under the rules: they wait for Save, unlike options. */
  rulesSaveOnSave: 'Rules save when you press Save.',
} as const;
