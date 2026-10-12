// `@crm/contracts/values`: the attribute value shapes and their companions, in
// a pure Zod entry with no oRPC and no I/O, so packages/ui can parse what its
// editors emit (spec 0003).
export {
  ActorReferenceValue,
  ATTRIBUTE_VALUE_INVALID,
  AttributeType,
  attributeValueSchema,
  CheckboxValue,
  CurrencyValue,
  DateValue,
  DomainValue,
  EmailValue,
  emailDomain,
  FileValue,
  fullNameOf,
  InteractionValue,
  IsoInstant,
  LocationValue,
  LongTextValue,
  MULTIPLE_VALUE_TYPES,
  NumberValue,
  parseAttributeValue,
  PersonalNameValue,
  PhoneValue,
  RatingValue,
  RecordReferenceValue,
  SelectValue,
  StatusValue,
  SYSTEM_ONLY_TYPES,
  TextValue,
  Timestamp,
  TimestampValue,
  UrlValue,
  VALUE_SCHEMAS,
  type AttributeValue,
  type AttributeValueError,
  type AttributeValueOf,
  type AttributeValueOptions,
  type AttributeValueResult,
} from './attribute-values.ts';
export { COUNTRY_CODES, countryCodeFromText, isCountryCode, type CountryCode } from './countries.ts';
export { CURRENCY_CODES, type CurrencyCode } from './currencies.ts';
export { Decimal, DECIMAL_LIMITS, toCanonicalDecimal } from './decimal.ts';
export {
  BARE_OPERATORS,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  LIST_OPERATORS,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_DEPTH,
  MAX_GROUP_CONDITIONS,
  MAX_THROUGH_HOPS,
  RELATIVE_OPERATORS,
  RelativeRange,
  SINGLE_VALUE_OPERATORS,
} from './filters.ts';
export { MAX_SORTS, SortRule, SortRules } from './sorts.ts';
export { canJump, canJumpOn, JUMP_TYPES, type JumpAttribute } from './jump.ts';
export { ENGINE_REFUSAL_CODES, type EngineRefusal, type EngineRefusalCode } from './engine.ts';
export { AttributeConfig, AttributeDefault, defaultKindsFor, type AttributeConfigOf } from './attribute-config.ts';
export { HUES } from './hue-list.ts';
export { Hue } from './hues.ts';
export { OBJECT_ICONS, ObjectIcon } from './object-icons.ts';
export {
  ActorDisplay,
  FileDisplay,
  RecordRefDisplay,
  SelectOption,
  StatusOption,
  ValueVersion,
  type DisplayFor,
  type DisplayMap,
} from './options.ts';
export {
  API_SLUG_PATTERN,
  isReservedSlug,
  MAX_API_SLUG,
  RESERVED_SLUGS,
  toApiSlug,
  type ApiSlugKind,
} from './slugs.ts';
export { CARDINALITIES, flipCardinality, sidesHoldingOne, type CardinalityKey } from './cardinality.ts';
export {
  freeHue,
  nextHue,
  PICKER_TYPES,
  pickerTypeOf,
  STARTER_STAGES,
  type PickerType,
  type StageOutcome,
  type StarterStage,
} from './picker.ts';
export {
  AttributeValidation,
  checkRuleSettings,
  CountParams,
  CurrencyInParams,
  DateBound,
  DateRangeParams,
  EmailDomainParams,
  LengthParams,
  ListedRuleKind,
  PatternParams,
  PhoneCountryParams,
  RangeParams,
  RULE_SETTINGS_WORDS,
  RuleBreaking,
  RuleCondition,
  RuleKind,
  RuleParams,
  ValidationRuleInput,
  ValidationRuleView,
  type CheckedRule,
  type ConditionAttribute,
  type RuleSettingsContext,
  type RuleSettingsProblem,
} from './validation-rules.ts';
