// `@crm/data/roster` (spec 0037, the Team week): the roster's numbers and pure week rules for screens, the same the
// server and the data layer count by, kept apart from the layer's entry so they never join the first load.
export { isMonday, mondayOf, plusDays, TEAM_WEEK, weekDates } from '@crm/contracts/roster';
