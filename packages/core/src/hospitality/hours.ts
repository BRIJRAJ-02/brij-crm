// A place's opening hours read at an instant (spec 0065, AC-6508). The pure helpers live in `@crm/contracts/menu`
// since H1, so the guest menu page reads "open now" and "serving from 18:00" with the same rules the server does.
export {
  addDays,
  nextOpening,
  openAt,
  placeDateOf,
  rangesOn,
  wallToInstant,
  weekDayOf,
  type OpenNow,
} from '@crm/contracts/menu';
