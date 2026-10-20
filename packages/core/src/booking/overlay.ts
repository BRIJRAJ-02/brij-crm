// The visitor's calendar laid over a page's slots (spec 0028, AC-723 and
// AC-725): which slots clash with the visitor's busy times, and up to three
// Best ones. Pure: the api reads the busy times and passes them in, and they
// never leave the server; only slot starts come back.
import { DateTime } from 'luxon';
import type { BusyInterval } from './calendar.ts';

/** A slot as the overlay reads it: its start and end, ISO 8601. */
export interface OverlaySlot {
  readonly start: string;
  readonly end: string;
}

/** What the overlay found: slot starts, in the slots' order. */
export interface Overlay {
  /** Slots that overlap a busy time of the visitor's. */
  readonly clashes: readonly string[];
  /** At most three shared slots worth suggesting first. */
  readonly best: readonly string[];
}

/** How many slots are tagged Best at most. */
export const BEST_MAX = 3;
/** The room a Best slot keeps clear in the visitor's calendar on each side. */
export const BEST_CLEAR_MS = 15 * 60_000;
/** A Best slot sits inside these hours of the visitor's day (9 AM to 6 PM). */
const GOOD_HOURS = { from: 9, to: 18 } as const;

interface Span {
  readonly start: number;
  readonly end: number;
}

const spanOf = (value: { readonly start: string; readonly end: string }): Span => ({
  start: Date.parse(value.start),
  end: Date.parse(value.end),
});

/** Whether two spans overlap; one that starts as the other ends does not (ends are exclusive). */
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Whether the slot starts and ends inside the visitor's good hours, in their zone. */
function atGoodHour(slot: Span, zone: string): boolean {
  const start = DateTime.fromMillis(slot.start, { zone });
  const end = DateTime.fromMillis(slot.end, { zone });
  if (!start.isValid || !end.isValid || !start.hasSame(end.minus({ milliseconds: 1 }), 'day')) return false;
  const day = start.startOf('day');
  return start >= day.set({ hour: GOOD_HOURS.from }) && end <= day.set({ hour: GOOD_HOURS.to });
}

/**
 * Lays the visitor's busy times over the slots. A slot clashes when it
 * overlaps a busy time. Best: the soonest shared slots inside 9 AM to 6 PM in
 * the visitor's zone with 15 minutes clear before and after; when fewer than
 * three pass, the soonest shared slots fill the rest.
 */
export function overlay(slots: readonly OverlaySlot[], busy: readonly BusyInterval[], zone: string): Overlay {
  const busySpans = busy.map(spanOf).filter((span) => span.end > span.start);
  const clashesWith = (span: Span) => busySpans.some((busySpan) => overlaps(span, busySpan));
  const spans = slots.map((slot) => ({ slot, span: spanOf(slot) }));
  const clashes = spans.filter(({ span }) => clashesWith(span)).map(({ slot }) => slot.start);
  const clashing = new Set(clashes);
  const shared = spans.filter(({ slot }) => !clashing.has(slot.start)).toSorted((a, b) => a.span.start - b.span.start);
  const ideal = shared.filter(
    ({ span }) =>
      atGoodHour(span, zone) && !clashesWith({ start: span.start - BEST_CLEAR_MS, end: span.end + BEST_CLEAR_MS }),
  );
  const picked = new Set(ideal.slice(0, BEST_MAX).map(({ slot }) => slot.start));
  for (const { slot } of shared) {
    if (picked.size >= BEST_MAX) break;
    picked.add(slot.start);
  }
  return { clashes, best: slots.map((slot) => slot.start).filter((start) => picked.has(start)) };
}
