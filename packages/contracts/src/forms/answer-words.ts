// An answer as words (spec 0023; spec 0063's new shapes): the one reading a submission's panel, its email notice and
// its CSV export share, so a multi select, an address or a date and time reads the same in all three. Plain
// TypeScript with no Zod. Text only: a visitor typed it, so it is never markup.

/** What the words need from their reader: how yes and no read. */
export interface AnswerWordsOptions {
  readonly yes?: string;
  readonly no?: string;
}

/** A moment read in the zone it was given in: "2 Nov 2026, 14:30 (Europe/London)". */
function momentWords(at: string, timeZone: string): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return at;
  try {
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(moment);
    return `${local} (${timeZone})`;
  } catch {
    return at;
  }
}

/**
 * An answer as words: text as itself, yes or no, a number, a phone's number, a file's name, the choices picked and
 * Other's words, an address's parts in reading order, a date and time in the visitor's zone. Empty when it holds
 * nothing.
 */
export function answerWords(value: unknown, options: AnswerWordsOptions = {}): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value ? (options.yes ?? 'Yes') : (options.no ?? 'No');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ');
  if (typeof value !== 'object') return '';
  const shape = value as Readonly<Record<string, unknown>>;
  if (typeof shape.name === 'string' && typeof shape.fileId === 'string') return shape.name;
  if (typeof shape.number === 'string') return shape.number;
  if (Array.isArray(shape.picked)) {
    const picked = shape.picked.filter((item): item is string => typeof item === 'string');
    return [...picked, ...(typeof shape.other === 'string' ? [`Other: ${shape.other}`] : [])].join(', ');
  }
  if (typeof shape.at === 'string') {
    return momentWords(shape.at, typeof shape.timeZone === 'string' ? shape.timeZone : 'UTC');
  }
  const parts = ['line1', 'line2', 'city', 'region', 'postcode', 'country']
    .map((part) => shape[part])
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  return parts.join(', ');
}
