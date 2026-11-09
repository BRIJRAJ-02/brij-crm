import { TimeField as AriaTimeField, type TimeFieldProps as AriaTimeFieldProps, DateInput, DateSegment, Label, Text, FieldError, type TimeValue } from 'react-aria-components';
import { cx } from '../../lib/cx.ts';
import { formatClock } from '../WeekCalendar/clock.ts';
import { Select, type SelectOption } from '../Select/Select.tsx';
import { PICKER_FIELD, PICKER_LABEL, PICKER_HELP, PICKER_ERROR } from '../Popover/Popover.tsx';
import './TimeField.css';

/** 12-hour (9:30 AM) or 24-hour (09:30) clock. */
export type HourCycle = 12 | 24;

/** "HH:MM" for a minute of the day. */
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** How a "HH:MM" time reads on a 12- or 24-hour clock: "9:30 AM" or "09:30". A thin wrapper over formatClock, the one time formatter. */
export function formatTime(value: string, hourCycle: HourCycle): string {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return formatClock(h * 60 + m, hourCycle === 12);
}

/** Every time of day `step` minutes apart, as Select options with "HH:MM" ids. */
export function timeOptions(step = 15, hourCycle: HourCycle = 24, from = 0, to = 24 * 60): ReadonlyArray<SelectOption> {
  const out: SelectOption[] = [];
  for (let t = from; t < to; t += step) out.push({ id: hhmm(t), label: formatTime(hhmm(t), hourCycle) });
  return out;
}

/** Props for TimeSelect. */
export interface TimeSelectProps {
  readonly label: string;
  /** "HH:MM", 24-hour. */
  readonly value?: string | null;
  readonly onChange?: (value: string | null) => void;
  readonly hourCycle?: HourCycle;
  /** Minutes between options; 15 by default, like Cal.com. */
  readonly step?: number;
  /** Earliest option in minutes from midnight (an end time starts after its start). */
  readonly from?: number;
  readonly isLabelHidden?: boolean;
  readonly isDisabled?: boolean;
  readonly isInvalid?: boolean;
  readonly errorMessage?: string;
}

/** A time picked from a list in 15-minute steps (Cal.com's availability rows). The list opens scrolled to the current time with its tick. */
export function TimeSelect({ label, value, onChange, hourCycle = 24, step = 15, from = 0, isLabelHidden, isDisabled, isInvalid, errorMessage }: TimeSelectProps) {
  return (
    <Select
      className="tf-time-select" label={label} items={timeOptions(step, hourCycle, from)} value={value} onChange={onChange} placeholder="--:--"
      searchable={false} isLabelHidden={isLabelHidden} isDisabled={isDisabled} isInvalid={isInvalid} errorMessage={errorMessage}
    />
  );
}

/** Props for TimeField. */
export interface TimeFieldProps<T extends TimeValue> extends Omit<AriaTimeFieldProps<T>, 'className' | 'hourCycle'> {
  readonly label: string;
  readonly hourCycle?: HourCycle;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isLabelHidden?: boolean;
}

/** A typed time in a filled field: hour, minute (and am/pm) segments you type or step with the arrow keys. */
export function TimeField<T extends TimeValue>({ label, hourCycle = 24, description, errorMessage, isLabelHidden, ...rest }: TimeFieldProps<T>) {
  return (
    <AriaTimeField<T> {...rest} hourCycle={hourCycle} className="tf-time">
      <Label className={cx(PICKER_LABEL, isLabelHidden && 'tf-sr-only')}>{label}</Label>
      <DateInput className={cx(PICKER_FIELD, 'tf-time__field')}>{(segment) => <DateSegment segment={segment} className="tf-time__seg" />}</DateInput>
      {description !== undefined && <Text slot="description" className={PICKER_HELP}>{description}</Text>}
      <FieldError className={PICKER_ERROR}>{errorMessage}</FieldError>
    </AriaTimeField>
  );
}
