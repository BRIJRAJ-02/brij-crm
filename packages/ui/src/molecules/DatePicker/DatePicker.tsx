import {
  endOfMonth,
  fromAbsolute,
  isSameDay,
  parseDate,
  startOfMonth,
  startOfWeek,
  toCalendarDate,
  type CalendarDate,
} from '@internationalized/date';
import { use, useContext, useState } from 'react';
import { useLocale } from 'react-aria';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarStateContext,
  DateInput,
  DatePicker as AriaDatePicker,
  DatePickerStateContext,
  DateRangePicker as AriaDateRangePicker,
  DateRangePickerStateContext,
  DateSegment,
  FieldError,
  Group,
  Label,
  RangeCalendar,
  RangeCalendarStateContext,
  Text,
  type DateValue,
} from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { firstDayOfWeek, monthStep, weekStartDay, type WeekStart } from '../../lib/month.ts';
import { parseDateText } from '../../lib/parse-date-text.ts';
import { parseDateInput } from '../../lib/parse-input.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { Field } from '../Field/Field.tsx';
import { Menu, MenuItem, type MenuKey } from '../Menu/Menu.tsx';
import { InPopover, Popover } from '../Popover/Popover.tsx';
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

/** The calendar's first day: the member's week start, or (absent) the language's. */
function firstDay(weekStart: WeekStart | undefined): {
  readonly firstDayOfWeek?: NonNullable<ReturnType<typeof weekStartDay>>;
} {
  const day = weekStartDay(weekStart);
  return day === undefined ? {} : { firstDayOfWeek: day };
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
  weekStart: WeekStart = 'auto',
): readonly { readonly label: string; readonly date: CalendarDate }[] {
  return [
    { label: strings.today, date: today },
    { label: strings.tomorrow, date: today.add({ days: 1 }) },
    { label: strings.nextWeek, date: startOfWeek(today.add({ weeks: 1 }), locale, weekStartDay(weekStart)) },
    { label: strings.endOfMonth, date: endOfMonth(today) },
  ];
}

/** A calendar day as a short label in the language: "Fri 6 Nov" (en-GB), "Fri, Nov 6" (en-US). */
function useDayLabel(): (date: CalendarDate) => string {
  const { locale } = useFormatSettings();
  const format = memoIntl(
    `date-picker-day:${locale}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
  );
  return (date) => format.format(date.toDate('UTC'));
}

/** The range presets from `today`: the last 7 days, this month, last month and this quarter, ends included. */
export function rangePresets(
  today: CalendarDate,
): readonly { readonly label: string; readonly start: CalendarDate; readonly end: CalendarDate }[] {
  const lastMonth = startOfMonth(today).subtract({ months: 1 });
  const quarterStart = startOfMonth(today).set({ month: Math.floor((today.month - 1) / 3) * 3 + 1 });
  return [
    { label: strings.lastSevenDays, start: today.subtract({ days: 6 }), end: today },
    { label: strings.thisMonth, start: startOfMonth(today), end: endOfMonth(today) },
    { label: strings.lastMonth, start: lastMonth, end: endOfMonth(lastMonth) },
    { label: strings.thisQuarter, start: quarterStart, end: endOfMonth(quarterStart.add({ months: 2 })) },
  ];
}

/** The calendar's state, single or range: both page and focus the same way. */
function useCalendarState() {
  const single = useContext(CalendarStateContext);
  const range = useContext(RangeCalendarStateContext);
  return single ?? range;
}

/**
 * The month's title, which opens the months of its year to jump to (as Square's and Calendly's "Aug 2026 ⌄"), then
 * Today when the month on show isn't today's (unless the quick picks under it already offer Today), then the arrows:
 * a month either way, or a year while choosing a month.
 */
function MonthHeader({
  today,
  hasTodayPick,
  isPickingMonth,
  onPickingMonthChange,
}: {
  readonly today: CalendarDate;
  readonly hasTodayPick: boolean;
  readonly isPickingMonth: boolean;
  readonly onPickingMonthChange: (isPicking: boolean) => void;
}) {
  const state = useCalendarState();
  const { locale } = useFormatSettings();
  if (state === null) return null;
  const shown = state.visibleRange.start;
  const title = memoIntl(
    `date-picker-month:${locale}`,
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  ).format(shown.toDate('UTC'));
  const isTodaysMonth = shown.year === today.year && shown.month === today.month;
  const goToYear = (years: number) => {
    state.setFocusedDate(state.focusedDate.add({ years }));
  };
  return (
    // A plain block, not a header: inline (MonthCalendar) a header would be a page banner landmark.
    <div className={styles.nav}>
      <AriaButton
        className={styles.month}
        aria-expanded={isPickingMonth}
        aria-label={strings.chooseMonth(title)}
        onPress={() => {
          onPickingMonthChange(!isPickingMonth);
        }}
      >
        <span aria-live="polite">{isPickingMonth ? String(shown.year) : title}</span>
        <Icon name={isPickingMonth ? 'chevron-up' : 'chevron-down'} size="xs" tone="muted" />
      </AriaButton>
      {!isTodaysMonth && !hasTodayPick && (
        <Button
          variant="ghost"
          onPress={() => {
            onPickingMonthChange(false);
            state.setFocusedDate(today);
          }}
        >
          {strings.today}
        </Button>
      )}
      <span className={styles.arrows}>
        {isPickingMonth ? (
          <>
            <Button
              variant="ghost"
              icon="chevron-left"
              label={strings.previousYear}
              onPress={() => {
                goToYear(-1);
              }}
            />
            <Button
              variant="ghost"
              icon="chevron-right"
              label={strings.nextYear}
              onPress={() => {
                goToYear(1);
              }}
            />
          </>
        ) : (
          <>
            <Button slot="previous" variant="ghost" icon="chevron-left" label={strings.previousMonth} />
            <Button slot="next" variant="ghost" icon="chevron-right" label={strings.nextMonth} />
          </>
        )}
      </span>
    </div>
  );
}

/**
 * The twelve months of the year on show, three across, one tab stop (the month on show) with the arrows, Home and
 * End moving among them: choosing one shows its days, focused. Esc goes back to the days, leaving the popover open.
 */
function MonthPicker({ today, onPicked }: { readonly today: CalendarDate; readonly onPicked: () => void }) {
  const state = useCalendarState();
  const { locale } = useFormatSettings();
  const { direction } = useLocale();
  if (state === null) return null;
  const backToDays = () => {
    state.setFocused(true);
    onPicked();
  };
  const shown = state.visibleRange.start;
  const format = memoIntl(
    `date-picker-month-short:${locale}`,
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
  );
  return (
    <div className={styles.months} role="group" aria-label={String(shown.year)}>
      {Array.from({ length: 12 }, (_, index) => {
        const month = shown.set({ month: index + 1, day: 1 });
        const isShown = index + 1 === shown.month;
        return (
          <AriaButton
            key={index}
            className={styles.monthCell}
            data-today={(month.year === today.year && month.month === today.month) || undefined}
            aria-current={isShown ? 'true' : undefined}
            excludeFromTabOrder={!isShown}
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the month on show takes focus as the months open
            autoFocus={isShown}
            onKeyDown={(event) => {
              // React Aria stops a key handled here, so Esc goes back to the days and never closes the popover.
              if (event.key === 'Escape') {
                backToDays();
                return;
              }
              const next = monthStep(index, event.key, direction === 'rtl');
              const group = event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement : null;
              const target = next === undefined ? undefined : group?.querySelectorAll<HTMLElement>('button')[next];
              if (target === undefined) {
                event.continuePropagation();
                return;
              }
              event.preventDefault();
              target.focus();
            }}
            onPress={() => {
              state.setFocusedDate(state.focusedDate.set({ year: month.year, month: month.month }));
              backToDays();
            }}
          >
            {format.format(month.toDate('UTC'))}
          </AriaButton>
        );
      })}
    </div>
  );
}

/**
 * The month grid, always six weeks tall so paging never resizes it. Days outside the month show faded. Today, by the
 * provider's clock (not React Aria's reading of the machine's date), is the link colour inside a hairline ring.
 * `shown` (MonthCalendar's) tints the days the view beside it shows, its ends rounded.
 */
function Grid({
  today,
  shown,
}: {
  readonly today: CalendarDate;
  readonly shown?: { readonly start: CalendarDate; readonly end: CalendarDate } | undefined;
}) {
  return (
    <div className={styles.weeks}>
      <CalendarGrid className={styles.grid} weekdayStyle="short">
        <CalendarGridHeader>
          {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => {
            const isShown = shown !== undefined && date.compare(shown.start) >= 0 && date.compare(shown.end) <= 0;
            return (
              <CalendarCell
                date={date}
                className={styles.day}
                data-today-mark={isSameDay(date, today) ? '' : undefined}
                data-shown={isShown ? '' : undefined}
                // A week running over the month's edge ends its band at the month's first or last day.
                data-shown-start={isShown && (isSameDay(date, shown.start) || date.day === 1) ? '' : undefined}
                data-shown-end={
                  isShown && (isSameDay(date, shown.end) || date.add({ days: 1 }).day === 1) ? '' : undefined
                }
              />
            );
          }}
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  );
}

/** A calendar's inside: its header, then the days, or the months while the title is open. */
function CalendarBody({
  today,
  shown,
  hasTodayPick = false,
}: {
  readonly today: CalendarDate;
  readonly shown?: { readonly start: CalendarDate; readonly end: CalendarDate } | undefined;
  /** The quick picks under it hold Today, so the header leaves its own out. */
  readonly hasTodayPick?: boolean;
}) {
  const [isPickingMonth, setPickingMonth] = useState(false);
  return (
    <>
      <MonthHeader
        today={today}
        hasTodayPick={hasTodayPick}
        isPickingMonth={isPickingMonth}
        onPickingMonthChange={setPickingMonth}
      />
      {isPickingMonth ? (
        <MonthPicker
          today={today}
          onPicked={() => {
            setPickingMonth(false);
          }}
        />
      ) : (
        <Grid today={today} shown={shown} />
      )}
    </>
  );
}

/**
 * "Type a date" at the popover's top, as Linear's and Twenty's: words or numbers ("tomorrow", "next fri", "in 2
 * weeks", "Oct 8", "8/10"), the day they name shown at the end (the field's description, not a live region), and
 * Enter chooses it; an Enter that names no day says "No match" once. Down moves to the days.
 */
function TypeDate({ today, startText = '' }: { readonly today: CalendarDate; readonly startText?: string }) {
  const state = useContext(DatePickerStateContext);
  const { locale, weekStart } = useFormatSettings();
  const dayLabel = useDayLabel();
  const [text, setText] = useState(startText);
  // The text an Enter found no day in: said once, until the text changes.
  const [missed, setMissed] = useState<string | undefined>(undefined);
  if (state === null) return null;
  const found = parseDateText(text, {
    today: today.toString(),
    locale,
    firstDayOfWeek: firstDayOfWeek(locale, weekStart),
  });
  const day = found === undefined ? undefined : parseDate(found);
  const isTyped = text.trim() !== '';
  return (
    <div className={styles.typed}>
      <Field
        label={strings.typeDate}
        isLabelHidden
        size="sm"
        placeholder={strings.typeDatePlaceholder}
        value={text}
        onChange={setText}
        // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the popover opens to type, as Linear's does
        autoFocus
        isSuffixDescribing
        suffix={
          <span className={styles.resolved} data-missing={(isTyped && day === undefined) || undefined}>
            {day !== undefined ? dayLabel(day) : isTyped ? strings.noDateFound : ''}
          </span>
        }
        onKeyDown={(event) => {
          // Down goes to the days, on the day that has focus there, so the keyboard never has to Tab past the month.
          if (event.key !== 'ArrowDown') return;
          const focusedDay = event.currentTarget
            .closest('[role="dialog"]')
            ?.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]');
          if (focusedDay === null || focusedDay === undefined) return;
          event.preventDefault();
          focusedDay.focus();
        }}
        onSubmit={() => {
          if (day === undefined) {
            setMissed(text);
            return;
          }
          state.setValue(day);
          state.close();
        }}
      />
      <VisuallyHidden>
        <span role="status">{missed !== undefined && missed === text ? strings.noDateFound : ''}</span>
      </VisuallyHidden>
    </div>
  );
}

/** The key of the last quick pick, No date. Never a pick's label. */
const NO_DATE = 'no-date';

/**
 * Quick picks as an inline menu, one tab stop with the arrows, each with the day it means at the end ("Tomorrow ·
 * Sat 31 Oct"), and No date last.
 */
function QuickPicks({ isClearable, today }: { readonly isClearable: boolean; readonly today: CalendarDate }) {
  const state = useContext(DatePickerStateContext);
  const { locale, weekStart } = useFormatSettings();
  const dayLabel = useDayLabel();
  if (state === null) return null;
  const picks = quickPicks(today, locale, weekStart);
  const choose = (key: MenuKey) => {
    const pick = picks.find((each) => each.label === key);
    if (key === NO_DATE) state.setValue(null);
    else if (pick !== undefined) state.setValue(pick.date);
    else return;
    state.close();
  };
  return (
    <div className={styles.picks}>
      <Menu label={strings.quickPicks} isInline onAction={choose}>
        {picks.map((pick) => (
          <MenuItem key={pick.label} id={pick.label} meta={dayLabel(pick.date)}>
            {pick.label}
          </MenuItem>
        ))}
        {isClearable && state.value !== null && (
          <MenuItem id={NO_DATE} icon="x">
            {strings.noDate}
          </MenuItem>
        )}
      </Menu>
    </div>
  );
}

/** Whether a range runs exactly from `start` to `end`. */
function isRange(
  value: { readonly start: DateValue | null; readonly end: DateValue | null } | null,
  start: CalendarDate,
  end: CalendarDate,
): boolean {
  if (value === null || value.start === null || value.end === null) return false;
  return isSameDay(value.start, start) && isSameDay(value.end, end);
}

/**
 * The range presets as an inline menu under the calendar: Last 7 days, This month, Last month, This quarter. The
 * one the range matches is checked.
 */
function RangePresets({ today }: { readonly today: CalendarDate }) {
  const state = useContext(DateRangePickerStateContext);
  if (state === null) return null;
  const presets = rangePresets(today);
  return (
    <div className={styles.picks}>
      <Menu
        label={strings.presets}
        isInline
        onAction={(key) => {
          const preset = presets.find((each) => each.label === key);
          if (preset === undefined) return;
          state.setValue({ start: preset.start, end: preset.end });
          state.close();
        }}
      >
        {presets.map((preset) => (
          <MenuItem key={preset.label} id={preset.label} isChecked={isRange(state.value, preset.start, preset.end)}>
            {preset.label}
          </MenuItem>
        ))}
      </Menu>
    </div>
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
  /** "Type a date" above the calendar, and Today, Tomorrow, Next week and End of month under it. On by default. */
  readonly showQuickPicks?: boolean;
  /** What "Type a date" starts with: the key that opened a grid cell's editor, so "t" then "omorrow" reads on. */
  readonly startText?: string;
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

function lookProps(look: DateFieldLook, isInPopover: boolean) {
  return {
    className: styles.root,
    'data-size': look.size ?? 'md',
    // In a popover (a grid cell's editor, a filter's value) its focus is the accent edge alone, as a Field's there.
    'data-in-popover': isInPopover || undefined,
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
 * The typed date's box: its segments and the calendar button. A pasted day ("8 Oct 2026", "2026-10-08T09:00Z",
 * "tomorrow") fills it whole, read as Type a date reads text (`parseDateInput`), since a segment takes only digits.
 */
function DateBox({ look, today }: { readonly look: DateFieldLook; readonly today: CalendarDate }) {
  const state = useContext(DatePickerStateContext);
  const { locale, weekStart } = useFormatSettings();
  return (
    <Group
      className={styles.box}
      onPaste={(event) => {
        if (state === null || look.isReadOnly === true || look.isDisabled === true) return;
        const found = parseDateInput(event.clipboardData.getData('text/plain'), {
          locale,
          today: today.toString(),
          firstDayOfWeek: firstDayOfWeek(locale, weekStart),
        });
        if (found === undefined) return;
        event.preventDefault();
        state.setValue(parseDate(found));
      }}
      // Enter in the date submits its form, as it does in any text field (a day off's Add). On the way down,
      // since a segment keeps its keys to itself.
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' || !(event.target instanceof HTMLElement) || event.target.closest('button') !== null)
          return;
        event.target.closest('form')?.requestSubmit();
      }}
    >
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
  );
}

/**
 * A calendar day, typed in the language's order or picked from a calendar with
 * quick picks. The calendar's first day follows the language, and "today" is
 * today in the provider's time zone. It is the date attribute's editor.
 */
export function DatePicker({
  value,
  defaultValue,
  onChange,
  showQuickPicks = true,
  startText,
  ...look
}: DatePickerProps) {
  const isInPopover = use(InPopover);
  const controlled = toDate(value);
  const initial = toDate(defaultValue);
  const today = useToday();
  const { weekStart } = useFormatSettings();
  return (
    <AriaDatePicker
      {...lookProps(look, isInPopover)}
      {...(controlled === undefined ? {} : { value: controlled })}
      {...(initial === undefined ? {} : { defaultValue: initial })}
      onChange={(next) => {
        onChange?.(fromDate(next));
      }}
    >
      {look.isLabelHidden !== true && <Label className={styles.label}>{look.label}</Label>}
      <DateBox look={look} today={today} />
      <FieldParts look={look} />
      <Popover label={strings.calendar}>
        {showQuickPicks && <TypeDate today={today} {...(startText === undefined ? {} : { startText })} />}
        <Calendar
          className={styles.calendar}
          defaultFocusedValue={controlled ?? initial ?? today}
          // The typed row takes focus as it opens; Tab reaches the days. Without it the chosen day does.
          {...(showQuickPicks ? { autoFocus: false } : {})}
          {...firstDay(weekStart)}
        >
          <CalendarBody today={today} hasTodayPick={showQuickPicks} />
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

/**
 * DatePicker's range variant, for filters and dashboards: a start and an end day, picked on one calendar as one
 * unbroken band, or from the presets under it.
 */
export function DateRangePicker({ value, defaultValue, onChange, ...look }: DateRangePickerProps) {
  const isInPopover = use(InPopover);
  const controlled = toRange(value);
  const initial = toRange(defaultValue);
  const today = useToday();
  const { weekStart } = useFormatSettings();
  return (
    <AriaDateRangePicker
      {...lookProps(look, isInPopover)}
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
          {...firstDay(weekStart)}
        >
          <CalendarBody today={today} />
        </RangeCalendar>
        <RangePresets today={today} />
      </Popover>
    </AriaDateRangePicker>
  );
}

/** Props for MonthCalendar. */
export interface MonthCalendarProps {
  /** What the month is for, its accessible name ("Go to date"). */
  readonly label: string;
  /** The chosen day, `YYYY-MM-DD`. */
  readonly value: DateString;
  readonly onChange: (value: DateString) => void;
  /**
   * The days the view beside it shows (the week on screen, `YYYY-MM-DD` to `YYYY-MM-DD`, both ends kept), tinted as
   * one band, as Google Calendar's small month marks its week.
   */
  readonly shown?: { readonly start: DateString; readonly end: DateString };
  /**
   * Focus the chosen day as it mounts: for a month opened in a popover (Bookings' Go to date), so the arrows move
   * through the days at once, as DatePicker's own popover does. Inline beside a view, leave it off.
   */
  readonly autoFocus?: boolean;
}

/**
 * DatePicker's calendar on its own, inline rather than in a popover and compact: a small month for jumping to a
 * date beside a view (Bookings' calendars panel, as Google Calendar keeps one over its calendars). The month, its
 * arrows, its keys, today's ring and the chosen day are DatePicker's; the days are shorter, to fit a side column.
 */
export function MonthCalendar({ label, value, onChange, shown, autoFocus = false }: MonthCalendarProps) {
  const today = useToday();
  const { weekStart } = useFormatSettings();
  return (
    <Calendar
      className={styles.calendar}
      data-inline=""
      aria-label={label}
      // eslint-disable-next-line jsx-a11y-x/no-autofocus -- only a month opened from its own button asks for it
      autoFocus={autoFocus}
      value={parseDate(value)}
      onChange={(next) => {
        const day = fromDate(next);
        if (day !== null) onChange(day);
      }}
      {...firstDay(weekStart)}
    >
      <CalendarBody
        today={today}
        shown={shown === undefined ? undefined : { start: parseDate(shown.start), end: parseDate(shown.end) }}
      />
    </Calendar>
  );
}
