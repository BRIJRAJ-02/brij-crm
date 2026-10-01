import {
  endOfMonth,
  fromAbsolute,
  isSameDay,
  parseDate,
  startOfWeek,
  toCalendarDate,
  type CalendarDate,
} from '@internationalized/date';
import { useContext } from 'react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DatePickerStateContext,
  DateRangePicker as AriaDateRangePicker,
  DateSegment,
  FieldError,
  Group,
  Heading,
  Label,
  RangeCalendar,
  Text,
  type DateValue,
} from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { Popover } from '../Popover/Popover.tsx';
import styles from './DatePicker.module.css';
import { strings } from './strings.ts';

/** A calendar day as the value shapes store it: `YYYY-MM-DD`. */
type DateString = string;

function toDate(value: DateString | null | undefined): CalendarDate | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : parseDate(value);
}

function fromDate(value: DateValue | null): DateString | null {
  return value === null ? null : value.toString().slice(0, 10);
}

/** Today in the time zone, from an instant in milliseconds. */
export function dayIn(now: number, timeZone: string): CalendarDate {
  return toCalendarDate(fromAbsolute(now, timeZone));
}

/** Today in the provider's time zone, by the provider's clock (frozen in stories), so it never comes from the machine. */
function useToday(): CalendarDate {
  const { timeZone } = useFormatSettings();
  return dayIn(useNow(), timeZone);
}

/** The quick picks from `today`: Today, Tomorrow, Next week (the language's next first day of the week) and End of month. */
export function quickPicks(
  today: CalendarDate,
  locale: string,
): readonly { readonly label: string; readonly date: CalendarDate }[] {
  return [
    { label: strings.today, date: today },
    { label: strings.tomorrow, date: today.add({ days: 1 }) },
    { label: strings.nextWeek, date: startOfWeek(today.add({ weeks: 1 }), locale) },
    { label: strings.endOfMonth, date: endOfMonth(today) },
  ];
}

function MonthHeader() {
  return (
    <header className={styles.nav}>
      <Heading className={styles.month} />
      <span className={styles.arrows}>
        <Button slot="previous" variant="ghost" icon="chevron-left" label={strings.previousMonth} />
        <Button slot="next" variant="ghost" icon="chevron-right" label={strings.nextMonth} />
      </span>
    </header>
  );
}

/** The month grid. Today's dot comes from the provider's clock, not React Aria's own reading of the machine's date. */
function Grid({ today }: { readonly today: CalendarDate }) {
  return (
    <CalendarGrid className={styles.grid} weekdayStyle="short">
      <CalendarGridHeader>
        {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
      </CalendarGridHeader>
      <CalendarGridBody>
        {(date) => (
          <CalendarCell date={date} className={styles.day}>
            {({ formattedDate }) => (
              <>
                {formattedDate}
                {isSameDay(date, today) && <span className={styles.today} data-today-mark="" />}
              </>
            )}
          </CalendarCell>
        )}
      </CalendarGridBody>
    </CalendarGrid>
  );
}

function QuickPicks({ isClearable, today }: { readonly isClearable: boolean; readonly today: CalendarDate }) {
  const state = useContext(DatePickerStateContext);
  const { locale } = useFormatSettings();
  if (state === null) return null;
  return (
    <footer className={styles.quick}>
      {quickPicks(today, locale).map((pick) => (
        <Button
          key={pick.label}
          variant="ghost"
          onPress={() => {
            state.setValue(pick.date);
            state.close();
          }}
        >
          {pick.label}
        </Button>
      ))}
      {isClearable && state.value !== null && (
        <Button
          variant="ghost"
          icon="x"
          onPress={() => {
            state.setValue(null);
            state.close();
          }}
        >
          {strings.clear}
        </Button>
      )}
    </footer>
  );
}

interface DateFieldLook {
  /** What the date is ("Projected close"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  readonly size?: 'md' | 'sm';
  /** Opens the calendar on first render (stories and previews). */
  readonly defaultOpen?: boolean;
  /** Called when focus enters or leaves the whole field (segments, button and calendar). */
  readonly onFocusChange?: (isFocused: boolean) => void;
  /** Called when the calendar opens or closes. */
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/** Props for DatePicker. */
export interface DatePickerProps extends DateFieldLook {
  /** A calendar day, `YYYY-MM-DD`, or `null` for none. */
  readonly value?: DateString | null;
  readonly defaultValue?: DateString | null;
  readonly onChange?: (value: DateString | null) => void;
  /** Today, Tomorrow, Next week and End of month under the calendar. On by default. */
  readonly showQuickPicks?: boolean;
}

function FieldParts({ look }: { readonly look: DateFieldLook }) {
  const description = (look.isReadOnly === true ? look.readOnlyReason : undefined) ?? look.hint;
  return (
    <>
      {description !== undefined && (
        <Text slot="description" className={styles.hint}>
          {description}
        </Text>
      )}
      <FieldError className={styles.error}>
        <Icon name="circle-alert" size="xs" />
        {look.error}
      </FieldError>
    </>
  );
}

function lookProps(look: DateFieldLook) {
  return {
    className: styles.root,
    'data-size': look.size ?? 'md',
    isRequired: look.isRequired ?? false,
    isReadOnly: look.isReadOnly ?? false,
    isDisabled: look.isDisabled ?? false,
    isInvalid: look.error !== undefined,
    ...(look.isLabelHidden === true ? { 'aria-label': look.label } : {}),
    ...(look.defaultOpen === undefined ? {} : { defaultOpen: look.defaultOpen }),
    ...(look.onFocusChange === undefined ? {} : { onFocusChange: look.onFocusChange }),
    ...(look.onOpenChange === undefined ? {} : { onOpenChange: look.onOpenChange }),
  };
}

/**
 * A calendar day, typed in the language's order or picked from a calendar with
 * quick picks. The calendar's first day follows the language, and "today" is
 * today in the provider's time zone. It is the date attribute's editor.
 */
export function DatePicker({ value, defaultValue, onChange, showQuickPicks = true, ...look }: DatePickerProps) {
  const controlled = toDate(value);
  const initial = toDate(defaultValue);
  const today = useToday();
  return (
    <AriaDatePicker
      {...lookProps(look)}
      {...(controlled === undefined ? {} : { value: controlled })}
      {...(initial === undefined ? {} : { defaultValue: initial })}
      onChange={(next) => {
        onChange?.(fromDate(next));
      }}
    >
      {look.isLabelHidden !== true && <Label className={styles.label}>{look.label}</Label>}
      <Group className={styles.box}>
        <DateInput className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        {look.isReadOnly === true ? (
          <Icon name="lock" size="xs" tone="muted" label={strings.readOnly} />
        ) : (
          <AriaButton className={styles.open} aria-label={strings.openCalendar}>
            <Icon name="calendar" size="sm" />
          </AriaButton>
        )}
      </Group>
      <FieldParts look={look} />
      <Popover label={strings.calendar}>
        <Calendar className={styles.calendar} defaultFocusedValue={controlled ?? initial ?? today}>
          <MonthHeader />
          <Grid today={today} />
        </Calendar>
        {showQuickPicks && <QuickPicks isClearable={look.isRequired !== true} today={today} />}
      </Popover>
    </AriaDatePicker>
  );
}

/** A range of calendar days, each `YYYY-MM-DD`, start and end included. */
export interface DateRange {
  readonly start: DateString;
  readonly end: DateString;
}

/** Props for DateRangePicker. */
export interface DateRangePickerProps extends DateFieldLook {
  readonly value?: DateRange | null;
  readonly defaultValue?: DateRange | null;
  readonly onChange?: (value: DateRange | null) => void;
}

function toRange(value: DateRange | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : { start: parseDate(value.start), end: parseDate(value.end) };
}

/** DatePicker's range variant, for filters and dashboards: a start and an end day, picked on one calendar. */
export function DateRangePicker({ value, defaultValue, onChange, ...look }: DateRangePickerProps) {
  const controlled = toRange(value);
  const initial = toRange(defaultValue);
  const today = useToday();
  return (
    <AriaDateRangePicker
      {...lookProps(look)}
      {...(controlled === undefined ? {} : { value: controlled })}
      {...(initial === undefined ? {} : { defaultValue: initial })}
      onChange={(next) => {
        const start = next === null ? null : fromDate(next.start);
        const end = next === null ? null : fromDate(next.end);
        onChange?.(start === null || end === null ? null : { start, end });
      }}
    >
      {look.isLabelHidden !== true && <Label className={styles.label}>{look.label}</Label>}
      <Group className={styles.box}>
        <DateInput slot="start" className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <span className={styles.dash} aria-hidden="true">
          –
        </span>
        <DateInput slot="end" className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <AriaButton className={styles.open} aria-label={strings.openCalendar}>
          <Icon name="calendar" size="sm" />
        </AriaButton>
      </Group>
      <FieldParts look={look} />
      <Popover label={strings.calendar}>
        <RangeCalendar
          className={styles.calendar}
          data-range=""
          defaultFocusedValue={controlled?.start ?? initial?.start ?? today}
        >
          <MonthHeader />
          <Grid today={today} />
        </RangeCalendar>
      </Popover>
    </AriaDateRangePicker>
  );
}
