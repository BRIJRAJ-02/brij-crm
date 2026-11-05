// A place's opening hours, read at an instant (spec 0065, AC-6508). The pure helpers live in `@crm/contracts`
// (`hospitality-hours.ts`, also re-exported by `@crm/contracts/menu`) since the guest menu and the public business
// page read them in the browser too (spec 0065 H1, spec 0066 B4).
export {
  addDays,
  nextOpening,
  openAt,
  placeDateOf,
  rangesOn,
  wallToInstant,
  weekDayOf,
  type OpenNow,
} from '@crm/contracts/hospitality-hours';
