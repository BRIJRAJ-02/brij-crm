// TimeSelect (spec 0073, AC-7306): the prototype's TimeSelect as a thin wrapper over Select's `time` variant (SelectBase:
// a time never wears a dot or a badge, so it skips their faces), so a
// time of day picked from a list looks and works like every other Select (Enter opens, arrows move, typing jumps)
// and adds no CSS. A typed exact time stays Field's `temporal={{ type: 'time' }}`.
import { useMemo } from 'react';
import { useFormatSettings } from '../../provider/context.ts';
import { SelectBase } from '../Select/Select.tsx';
import { timeOptions, type HourCycle } from './time-options.ts';
import { strings } from './strings.ts';

/** Props for TimeSelect. */
export interface TimeSelectProps {
  /** Names the time ("Start", "Ends at"). */
  readonly label: string;
  /** Keeps the label for screen readers only, inside a row that says what the time is. */
  readonly isLabelHidden?: boolean;
  /** The time, `HH:MM` on a 24 hour clock; `null` is none chosen. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onChange?: (value: string | null) => void;
  /** 12 ("9:30 AM") or 24 ("09:30"); left out, the reader's language decides. */
  readonly hourCycle?: HourCycle;
  /** Minutes between the times listed; 15 by default. */
  readonly step?: number;
  /** The first time listed, in minutes from midnight: an end time starts after its start. */
  readonly from?: number;
  /** The last time listed is before this, in minutes from midnight. */
  readonly to?: number;
  readonly hint?: string;
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  /** Why it can't be changed, said under it while it is read only ("Set by the team"). */
  readonly readOnlyReason?: string;
  readonly size?: 'md' | 'sm';
}

/** A time of day picked from a list, a step apart, on a 12 or 24 hour clock: working hours, availability rows. */
export function TimeSelect({
  label,
  isLabelHidden = false,
  value,
  defaultValue,
  onChange,
  hourCycle,
  step = 15,
  from = 0,
  to = 24 * 60,
  hint,
  error,
  isRequired = false,
  isDisabled = false,
  isReadOnly = false,
  readOnlyReason,
  size = 'md',
}: TimeSelectProps) {
  const { locale } = useFormatSettings();
  const items = useMemo(
    () => timeOptions({ locale, step, from, to, ...(hourCycle === undefined ? {} : { hourCycle }) }),
    [locale, step, from, to, hourCycle],
  );
  return (
    <SelectBase
      label={label}
      isLabelHidden={isLabelHidden}
      variant="time"
      size={size}
      items={items}
      placeholder={strings.placeholder}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
    />
  );
}
