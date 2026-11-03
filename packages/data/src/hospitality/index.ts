// `@crm/data/hospitality` (spec 0065): the Hospitality suite's closed lists, limits and pure rules for screens (the
// hours rule the server runs too, "T1 to T10"), kept apart from the layer's entry so they never join the first load.
// Its types come through `@crm/data`.
export {
  APP_NEEDS,
  appsNeeding,
  BUSINESS_KINDS,
  DEFAULT_RESOURCE_KIND,
  mainResourceKind,
  RESOURCE_KINDS,
  EMPTY_HOURS,
  HOSPITALITY_APPS,
  HOSPITALITY_LIMITS,
  hoursProblem,
  rangesProblem,
  spanOf,
  resourceLabels,
  WEEK_DAYS,
} from '@crm/contracts/hospitality';
