// A drawn span's From and To (spec 0027): the same two fields on the card a
// span opens and in New meeting, so the time can be set exactly, from the
// keyboard too, and moved where a clash is reported.
import { Select, useFormatSettings } from '@crm/ui';
import { instantOf, lengthLabel, type DrawnSpan } from './span.ts';
import { strings } from './strings.ts';

/** Props for SpanTimes. */
export interface SpanTimesProps {
  readonly span: DrawnSpan;
  readonly locale: string;
  readonly onChange: (span: DrawnSpan) => void;
  /** The longest the span may run, in minutes; To offers nothing past it. */
  readonly maxMinutes?: number;
  /** Lengths beside To's times ("2:00 PM (1 hr)"), for a meeting. */
  readonly showsLength?: boolean;
  readonly isDisabled?: boolean;
  /** A note under the times: which zone they are in ("Times in Kolkata time (GMT+5:30)"). */
  readonly hint?: string;
}

/** The span's start and end, in 15 minute steps within its day. */
export function SpanTimes({
  span,
  locale,
  onChange,
  maxMinutes = 1440,
  showsLength = false,
  isDisabled,
  hint,
}: SpanTimesProps) {
  // The times on the member's clock, the zone the week is drawn in.
  const { timeZone } = useFormatSettings();
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const label = (minute: number) => clock.format(instantOf(span.dayKey, minute, timeZone));
  const steps = Array.from({ length: 96 }, (_, index) => index * 15);
  const ends = [...steps.slice(1), 1440].filter(
    (minute) => minute > span.startMinute && minute - span.startMinute <= maxMinutes,
  );
  return (
    <>
      <Select
        label={strings.from}
        items={steps.map((minute) => ({ id: String(minute), label: label(minute) }))}
        value={String(span.startMinute)}
        {...(isDisabled === undefined ? {} : { isDisabled })}
        onChange={(id) => {
          const startMinute = Number(id ?? span.startMinute);
          const length = span.endMinute - span.startMinute;
          onChange({ ...span, startMinute, endMinute: Math.min(1440, startMinute + length) });
        }}
      />
      <Select
        label={strings.to}
        items={ends.map((minute) => ({
          id: String(minute),
          label: showsLength ? `${label(minute)} (${lengthLabel(minute - span.startMinute)})` : label(minute),
        }))}
        value={String(span.endMinute)}
        {...(hint === undefined ? {} : { hint })}
        {...(isDisabled === undefined ? {} : { isDisabled })}
        onChange={(id) => onChange({ ...span, endMinute: Number(id ?? span.endMinute) })}
      />
    </>
  );
}
