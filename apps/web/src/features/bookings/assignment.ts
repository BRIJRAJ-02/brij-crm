// Why a round robin booking went to its host, in plain words (spec 0029,
// AC-742): "Assigned in Sales", "Sam Lee had the fewest meetings in the last 30 days: 4, at weight 100".
import type { BookingAssignment } from '@crm/data';
import { strings } from './strings.ts';

/** One ledger row as the booking's detail says it; a voided row says it no longer counts. */
export function assignmentLine(row: BookingAssignment, locale: string): string {
  const line = strings.assignedLine(row.memberName, reasonOf(row, locale));
  return row.voidedAt === undefined ? line : strings.noLongerCounts(line);
}

/** The detail's Assigned lines: each rotation's newest row (rows come newest first), one line per rotation. */
export function assignedItems(
  rows: readonly BookingAssignment[],
  locale: string,
): readonly { readonly term: string; readonly description: string }[] {
  const newest = new Map<string, BookingAssignment>();
  for (const row of rows) if (!newest.has(row.rotationId)) newest.set(row.rotationId, row);
  return [...newest.values()].map((row) => ({
    term: strings.assignedIn(row.rotationName),
    description: assignmentLine(row, locale),
  }));
}

function reasonOf(row: BookingAssignment, locale: string): string {
  if (row.reason !== 'fair') return strings.assignedWhy[row.reason];
  if (row.count === undefined || row.weight === undefined || row.windowDays === undefined)
    return strings.assignedWhy.fairPlain;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return strings.assignedWhy.fair(number.format(row.count), number.format(row.windowDays), number.format(row.weight));
}
