// The Team day's minute arithmetic (spec 0030), after timefix's `team-grid.ts`: plain functions over minutes of the
// day shown, with no zone in them. Where the grid opens is the team's working day, not midnight or an empty evening.

/** A stretch of the day in minutes from its midnight, the end exclusive. */
export interface MinuteSpan {
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Spans merged where they touch or overlap, by start, empty ones dropped. */
export function mergeMinutes(spans: readonly MinuteSpan[]): readonly MinuteSpan[] {
  const sorted = spans
    .filter((span) => span.endMinute > span.startMinute)
    .toSorted((a, b) => a.startMinute - b.startMinute);
  const merged: MinuteSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && span.startMinute <= last.endMinute) {
      merged[merged.length - 1] = {
        startMinute: last.startMinute,
        endMinute: Math.max(last.endMinute, span.endMinute),
      };
    } else merged.push(span);
  }
  return merged;
}

/**
 * Where the day opens: the hour before now on today while now is inside the team's working hours, else the hour the
 * earliest of them begins; 8:00 when nobody has hours. Opening on now at 11pm showed an empty evening with the whole
 * working day scrolled away (timefix's `openAtMinute`).
 */
export function openingMinute(hours: readonly MinuteSpan[], nowMinute: number | undefined): number {
  const merged = mergeMinutes(hours);
  const first = merged[0]?.startMinute;
  const last = merged.at(-1)?.endMinute;
  if (first === undefined || last === undefined) return 8 * 60;
  const hourOf = (minute: number) => Math.floor(minute / 60) * 60;
  if (nowMinute !== undefined && nowMinute >= first && nowMinute < last) return Math.max(0, hourOf(nowMinute) - 60);
  return hourOf(first);
}
