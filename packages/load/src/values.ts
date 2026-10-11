// An edit's new value (spec 0011, value sourcing): made per type from the
// value the user's window holds, so it really changes something: text from a
// word list, a checkbox flipped, an option other than the current one, a
// number or date nudged. A value the user doesn't hold (spread edits a
// sampled record) is made fresh.
import type { Random } from './random.ts';
import type { ShapeAttribute } from './shapes.ts';

const WORDS = [
  'quarterly',
  'renewal',
  'follow up',
  'intro call',
  'pricing',
  'security review',
  'procurement',
  'pilot',
  'expansion',
  'onboarding',
  'demo',
  'contract',
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A date `days` after `iso` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A new value for `attribute` that differs from `current` (undefined when the user doesn't hold one). */
export function newValue(attribute: ShapeAttribute, current: unknown, random: Random): unknown {
  switch (attribute.type) {
    case 'text':
    case 'long_text': {
      const next = () => `${random.pick(WORDS)} ${String(random.int(1, 10_000))}`;
      let text = next();
      while (text === current) text = next();
      return text;
    }
    case 'checkbox':
      return current === undefined || current === null ? random.chance(0.5) : current !== true;
    case 'select':
    case 'status': {
      const others = attribute.options.filter((option) => option !== current);
      return random.pick(others.length > 0 ? others : attribute.options);
    }
    case 'currency': {
      const amount = isRecord(current) && typeof current.amount === 'string' ? Number(current.amount) : undefined;
      const currency =
        isRecord(current) && typeof current.currency === 'string' ? current.currency : (attribute.currency ?? 'USD');
      const base = amount === undefined || !Number.isFinite(amount) ? random.int(1_000, 250_000) : amount;
      // Nudged by 1 to 10% either way, whole cents, never below one.
      const nudged = Math.max(1, Math.round(base * (1 + (random.chance(0.5) ? 1 : -1) * random.int(1, 11) * 0.01)));
      return { amount: String(nudged === base ? nudged + 1 : nudged), currency };
    }
    case 'number': {
      const base = typeof current === 'string' ? Number(current) : random.int(1, 1_000);
      return String(Math.round((Number.isFinite(base) ? base : 0) + random.int(1, 50)));
    }
    case 'date': {
      const base = typeof current === 'string' ? current : new Date().toISOString().slice(0, 10);
      const days = random.int(1, 31) * (random.chance(0.5) ? 1 : -1);
      return addDays(base, days);
    }
    default:
      throw new Error(`The harness doesn't edit ${attribute.type} attributes.`);
  }
}
