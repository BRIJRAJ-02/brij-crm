import { momentOf } from '../../lib/moment.ts';
import { parseDateInput } from '../../lib/parse-input.ts';
import { parseLocaleDate } from '../Date/parse-date.ts';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { strings } from './strings.ts';
import { TimestampDisplay } from './TimestampDisplay.tsx';
import { TimestampEditor } from './TimestampEditor.tsx';

/** An ISO moment with its zone: `2026-10-08T14:30Z`, `2026-10-08T14:30:00.000+01:00`. */
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** A day and a time of day with no zone: `2026-10-08 14:30`, read in the time zone. */
const DAY_AND_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/;

/**
 * The date and time type (the field types pass, 31 October 2026): a moment people set, and the system's Created
 * at and Updated at, which stay read only as system attributes.
 */
export const timestampType: AttributeTypeDef<'timestamp'> = {
  type: 'timestamp',
  icon: 'clock',
  Display: TimestampDisplay,
  Editor: TimestampEditor,
  operators: () => withEmpty(['before', 'after', 'within_last', 'more_than_ago']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  // A moment with its zone as written; a day and a time in the time zone; a day alone at its start there.
  fromText: (text, context) => {
    const trimmed = text.trim();
    if (ISO_MOMENT.test(trimmed)) {
      const at = Date.parse(trimmed);
      if (!Number.isNaN(at)) return new Date(at).toISOString();
    }
    const both = DAY_AND_TIME.exec(trimmed);
    if (both !== null) {
      const [, day = '', hours = '', minutes = ''] = both;
      const moment = momentOf(day, `${hours.padStart(2, '0')}:${minutes}`, context.timeZone);
      if (moment !== undefined) return moment;
    }
    const day =
      parseDateInput(trimmed, {
        locale: context.locale,
        ...(context.today === undefined ? {} : { today: context.today }),
      }) ?? parseLocaleDate(trimmed, context.locale);
    const moment = day === undefined ? undefined : momentOf(day, '00:00', context.timeZone);
    return moment ?? refuse(strings.notAMoment(trimmed));
  },
  align: 'start',
  editIn: 'popover',
  // The default width: a narrow column drew its header as "C…" beside the sort, lock and menu icons, and cut a full
  // date and time short (QA, 22 October 2026).
  width: 'default',
};
