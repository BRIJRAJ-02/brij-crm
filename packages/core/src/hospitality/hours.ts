// A place's opening hours, read at an instant (spec 0065, AC-6508). The pure helpers live in `@crm/contracts`
// (`hospitality-hours.ts`) since the public business page reads them in the browser too (spec 0066, B4).
export {
  addDays,
  nextOpening,
  openAt,
  rangesOn,
  wallToInstant,
  weekDayOf,
  type OpenNow,
} from '@crm/contracts/hospitality-hours';
