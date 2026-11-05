// Which hours the week draws when it fits them to the working day (T13, 5 November 2026: "the visible hours follow
// the working hours, not 0 to 24", as Cal.com's calendar view keeps to its start and end hour). Pure: the open
// hours and the blocks come in, whole hours go out, so it is tested without a browser.

/** A stretch of a day in minutes from its midnight, the end exclusive (1440 is the next midnight). */
export interface MinuteRange {
  readonly startMinute: number;
  readonly endMinute: number;
}

/** The hours drawn: `from` is the first hour's row, `to` the hour the last row ends on (0 to 24). */
export interface HourRange {
  readonly from: number;
  readonly to: number;
}

/** The whole day: what the week draws when nothing says where the working day is. */
export const WHOLE_DAY: HourRange = { from: 0, to: 24 };

/** An hour of quiet time either side of the working day: what came just before and after reads, and a drag has room. */
export const MARGIN_HOURS = 1;

/** The fewest hours drawn, so a short working day still reads as a day (a four hour day draws eight). */
export const FEWEST_HOURS = 8;

/**
 * The hours to draw: the working hours of every day shown (`open`, a day's ranges; undefined for a day whose hours
 * are not known, an empty list for a day off), widened to take in everything on the grid (`spans`: blocks, a drawn
 * span), with `MARGIN_HOURS` either side, at least `FEWEST_HOURS` and never past midnight. With no working hours
 * known and nothing on the grid it is the whole day, so nothing is ever hidden that the week could have shown.
 */
export function visibleHours(
  open: readonly (readonly MinuteRange[] | undefined)[],
  spans: readonly MinuteRange[],
): HourRange {
  const known = open.flatMap((ranges) => ranges ?? []).filter((range) => range.endMinute > range.startMinute);
  if (known.length === 0) return WHOLE_DAY;
  const all = [...known, ...spans.filter((span) => span.endMinute > span.startMinute)];
  const first = Math.min(...all.map((range) => range.startMinute));
  const last = Math.max(...all.map((range) => range.endMinute));
  let from = Math.max(0, Math.floor(first / 60) - MARGIN_HOURS);
  let to = Math.min(24, Math.ceil(last / 60) + MARGIN_HOURS);
  // Too short a day: grow it evenly, keeping inside midnight.
  while (to - from < FEWEST_HOURS) {
    if (to < 24) to += 1;
    if (to - from < FEWEST_HOURS && from > 0) from -= 1;
  }
  return { from, to };
}

/** Whether a minute of the day is on the hours drawn (the now line shows only then). */
export const isOnHours = (minute: number, hours: HourRange): boolean =>
  minute >= hours.from * 60 && minute <= hours.to * 60;
