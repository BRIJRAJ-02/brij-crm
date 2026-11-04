// `@crm/data/services` (spec 0066 B1): the catalogue's and the team's closed lists, limits and pure rules for screens
// (the starter service, prices in minor units, the hours rule the server runs too), kept apart from the layer's entry
// so they never join the first load. Its types come through `@crm/data`.
export {
  CATALOGUE_LIMITS,
  PRICE_TYPES,
  STAFF_TIME_OFF_REASONS,
  starterService,
  VISIT_LIMITS,
  type StarterService,
} from '@crm/contracts/visits';
export { EMPTY_HOURS, hoursProblem, rangesProblem, WEEK_DAYS, type WeekDay } from '@crm/contracts/hospitality';
export { formatPrice, minorToDecimal, parsePrice } from '@crm/contracts/menu';
