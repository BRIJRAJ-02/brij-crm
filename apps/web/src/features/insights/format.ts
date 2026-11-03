// Insights' arithmetic and words, pure so they are tested on their own (spec 0067): the tiles against the period
// before, the chart's points, the funnel's biggest drop, a source's name, and the CSV of what the screen shows.
import type { InsightFunnel, InsightNumbersLike, InsightSessionRow, InsightSourceRow } from './types.ts';
import { strings } from './strings.ts';

/** A count as the reader's language writes it. */
export const figure = (count: number, locale?: string) => new Intl.NumberFormat(locale).format(count);

/** A share as a whole percent, "41%"; a whole of zero is "0%", never a division by nothing. */
export const percent = (part: number, whole: number, locale?: string) =>
  whole === 0 ? '0%' : new Intl.NumberFormat(locale, { style: 'percent' }).format(part / whole);

/** A duration in words, to the nearest sensible unit: "45s", "2m 30s", "1h 4m". */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

/** One tile as Stats draws it. */
export interface Tile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly comparison?: string;
  readonly trend?: 'up' | 'down' | 'same';
}

/** How many days a period spans, both ends included. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The four tiles (AC-6711): visits, finishes, finish rate and average time to finish, each against the equal period
 * before when there is one. Arrows carry no colour, since up isn't always good; the time to finish, where less is
 * better, says faster or slower in words with no arrow.
 */
export function tilesOf(numbers: InsightNumbersLike, locale?: string): readonly Tile[] {
  const { totals, previous } = numbers;
  const days = strings.previousDays(daysBetween(numbers.from, numbers.to));
  const count = (now: number, before: number | undefined): Partial<Tile> => {
    if (before === undefined) return {};
    if (now === before) return { comparison: strings.noChange(days), trend: 'same' };
    const up = now > before;
    return {
      comparison: strings.change(`${up ? '+' : '−'}${figure(Math.abs(now - before), locale)}`, days),
      trend: up ? 'up' : 'down',
    };
  };
  const rateNow = totals.visits === 0 ? 0 : totals.finishes / totals.visits;
  const rateBefore = previous === undefined || previous.visits === 0 ? undefined : previous.finishes / previous.visits;
  const rate: Partial<Tile> =
    rateBefore === undefined
      ? {}
      : Math.round(rateNow * 100) === Math.round(rateBefore * 100)
        ? { comparison: strings.noChange(days), trend: 'same' }
        : {
            comparison: strings.points(
              `${rateNow > rateBefore ? '+' : '−'}${String(Math.abs(Math.round(rateNow * 100) - Math.round(rateBefore * 100)))}`,
            ),
            trend: rateNow > rateBefore ? 'up' : 'down',
          };
  const avg = totals.avgMs;
  const before = previous?.avgMs;
  const time: Partial<Tile> =
    avg === undefined
      ? { comparison: strings.noTime }
      : before === undefined || Math.round(avg / 1000) === Math.round(before / 1000)
        ? {}
        : {
            comparison: avg < before ? strings.faster(duration(before - avg)) : strings.slower(duration(avg - before)),
          };
  return [
    {
      id: 'visits',
      label: strings.visits,
      value: figure(totals.visits, locale),
      ...count(totals.visits, previous?.visits),
    },
    {
      id: 'finishes',
      label: strings.finishes,
      value: figure(totals.finishes, locale),
      ...count(totals.finishes, previous?.finishes),
    },
    { id: 'rate', label: strings.finishRate, value: percent(totals.finishes, totals.visits, locale), ...rate },
    { id: 'time', label: strings.avgTime, value: avg === undefined ? '—' : duration(avg), ...time },
  ];
}

/** The biggest drop between two steps of a funnel (AC-6713), as its sentence, or undefined when nobody left. */
export function biggestDrop(funnel: InsightFunnel, locale?: string): string | undefined {
  const reached = [...funnel.steps.map((step) => step.reached), funnel.finished];
  const names = [...funnel.steps.map((step) => step.step), 'finish'];
  let worst: { readonly at: number; readonly lost: number; readonly share: number } | undefined;
  for (let at = 0; at < reached.length - 1; at += 1) {
    const here = reached[at] ?? 0;
    const lost = here - (reached[at + 1] ?? 0);
    if (here === 0 || lost <= 0) continue;
    const share = lost / here;
    if (worst === undefined || lost > worst.lost) worst = { at, lost, share };
  }
  if (worst === undefined) return undefined;
  return strings.mostLeave(stepWord(names[worst.at] ?? ''), percent(worst.share, 1, locale));
}

/** A step's name. */
export const stepWord = (step: string, kind?: string) =>
  step === 'finish' && kind !== undefined
    ? (strings.finishWord[kind] ?? strings.steps.finish ?? step)
    : (strings.steps[step] ?? step);

/** A source's name: the groups by their own names, a UTM word as it was sent. */
export const sourceWord = (source: string) => strings.sourceWords[source] ?? source;

/** A cell for CSV: quoted when it must be, and never read as a formula by a spreadsheet. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows as CSV text, a header first, lines ended with CRLF as RFC 4180 has them. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

/**
 * What the screen shows as CSV (AC-6717): the tiles, the chart's buckets, the sources, and the sessions loaded,
 * with a name and email only where the screen already shows one (the door allowed it).
 */
export function insightsCsv(
  numbers: InsightNumbersLike & { readonly sources: readonly InsightSourceRow[] },
  sessions: readonly InsightSessionRow[],
): string {
  const parts = [
    toCsv(
      ['Section', 'From', 'To', 'Visits', 'Finishes', 'Average ms'],
      [
        [
          'Totals',
          numbers.from,
          numbers.to,
          numbers.totals.visits,
          numbers.totals.finishes,
          numbers.totals.avgMs ?? '',
        ],
      ],
    ),
    toCsv(
      [numbers.grain === 'week' ? 'Week starting' : 'Day', 'Visits', 'Finishes'],
      numbers.buckets.map((bucket) => [bucket.start, bucket.visits, bucket.finishes]),
    ),
    toCsv(
      ['Source', 'Medium', 'Campaign', 'Visits', 'Finishes'],
      numbers.sources.map((row) => [row.source, row.medium, row.campaign, row.visits, row.finishes]),
    ),
  ];
  if (sessions.length > 0) {
    parts.push(
      toCsv(
        ['When', 'Page', 'Finished', 'Source', 'Medium', 'Campaign', 'Got to', 'Name', 'Email'],
        sessions.map((row) => [
          row.at,
          row.pageName,
          row.finished ? 'yes' : 'no',
          row.source,
          row.medium ?? '',
          row.campaign ?? '',
          row.furthestStep,
          row.person?.name ?? '',
          row.person?.email ?? '',
        ]),
      ),
    );
  }
  return parts.join('\r\n\r\n');
}
