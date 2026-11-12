import {
  Calendar as AriaCalendar, type CalendarProps as AriaCalendarProps, RangeCalendar as AriaRangeCalendar, type RangeCalendarProps as AriaRangeCalendarProps,
  CalendarGrid, CalendarGridHeader, CalendarHeaderCell, CalendarGridBody, CalendarCell, Heading, CalendarStateContext, RangeCalendarStateContext,
  DatePicker as AriaDatePicker, type DatePickerProps as AriaDatePickerProps, DateRangePicker as AriaDateRangePicker, type DateRangePickerProps as AriaDateRangePickerProps,
  DateInput, DateSegment, Group, Label, Text, FieldError, Button as AriaButton, DatePickerStateContext, DateRangePickerStateContext,
  ListBox, ListBoxItem, type DateValue, type Key,
} from 'react-aria-components';
import { CalendarDate, today, getLocalTimeZone, startOfWeek, endOfWeek, startOfMonth, endOfMonth, type DateDuration } from '@internationalized/date';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Popover, PICKER_FIELD, PICKER_LABEL, PICKER_HELP, PICKER_ERROR } from '../Popover/Popover.tsx';
import './DatePicker.css';

const CLOSE_AFTER_PICK_MS = 120;
const chev = { size: 16, strokeWidth: 1.75 } as const;

/** The month grid that slides a small step sideways when the month changes (transitions.dev 08 page side-by-side). */
function SlidingMonth() {
  const single = useContext(CalendarStateContext);
  const range = useContext(RangeCalendarStateContext);
  const start = (single ?? range)?.visibleRange.start;
  const prev = useRef(start);
  const dir = useRef<'next' | 'prev' | 'none'>('none');
  if (start && prev.current && start.compare(prev.current) !== 0) {
    dir.current = start.compare(prev.current) > 0 ? 'next' : 'prev';
    prev.current = start;
  }
  return (
    <div key={start ? `${start.year}-${start.month}` : 'grid'} className={cx('tf-cal__page', `tf-cal__page--${dir.current}`)}>
      <CalendarGrid className="tf-cal__grid" weekdayStyle="short">
        <CalendarGridHeader>{(day) => <CalendarHeaderCell className="tf-cal__weekday">{day.slice(0, 2)}</CalendarHeaderCell>}</CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell date={date} className="tf-cal__cell">
              {({ formattedDate }) => <span className="tf-cal__day">{formattedDate}</span>}
            </CalendarCell>
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  );
}

function CalendarHeader() {
  return (
    <header className="tf-cal__head">
      <Heading className="tf-cal__title" />
      <span className="tf-cal__nav">
        <IconButton slot="previous" size="sm" label="Previous month"><ChevronLeft {...chev} /></IconButton>
        <IconButton slot="next" size="sm" label="Next month"><ChevronRight {...chev} /></IconButton>
      </span>
    </header>
  );
}

/** A month grid like the booking page's: 40px round days, today ringed, the chosen day filled with accent. The month slides as it changes. */
export function Calendar<T extends DateValue>({ className, ...rest }: Omit<AriaCalendarProps<T>, 'className'> & { readonly className?: string }) {
  return (
    <AriaCalendar<T> {...rest} className={cx('tf-cal', className)}>
      <CalendarHeader />
      <SlidingMonth />
    </AriaCalendar>
  );
}

/** The month grid for a span of days: the ends are accent circles, the days between sit on an accent-soft band. */
export function RangeCalendar<T extends DateValue>({ className, ...rest }: Omit<AriaRangeCalendarProps<T>, 'className'> & { readonly className?: string }) {
  return (
    <AriaRangeCalendar<T> {...rest} className={cx('tf-cal', 'tf-cal--range', className)}>
      <CalendarHeader />
      <SlidingMonth />
    </AriaRangeCalendar>
  );
}

/** Props shared by the field pickers. */
interface FieldBits {
  readonly label: string;
  readonly description?: string;
  readonly errorMessage?: string;
}

function TodayButton() {
  const state = useContext(DatePickerStateContext);
  return <Button size="sm" variant="ghost" onPress={() => { state?.setValue(today(getLocalTimeZone())); }}>Today</Button>;
}

/** A date in a filled field: type it in segments, or open the calendar from the icon. */
export function DatePicker<T extends DateValue>({ label, description, errorMessage, className, ...rest }: Omit<AriaDatePickerProps<T>, 'className'> & FieldBits & { readonly className?: string }) {
  return (
    <AriaDatePicker<T> {...rest} className={cx('tf-date', className)}>
      <Label className={PICKER_LABEL}>{label}</Label>
      <Group className={cx(PICKER_FIELD, 'tf-date__field')}>
        <DateInput className="tf-date__input">{(segment) => <DateSegment segment={segment} className="tf-date__seg" />}</DateInput>
        <AriaButton className="tf-date__btn" aria-label="Open calendar"><CalendarDays {...chev} /></AriaButton>
      </Group>
      {description !== undefined && <Text slot="description" className={PICKER_HELP}>{description}</Text>}
      <FieldError className={PICKER_ERROR}>{errorMessage}</FieldError>
      <Popover placement="bottom end" label="Calendar" className="tf-date__pop">
        <Calendar />
        <div className="tf-date__foot"><TodayButton /></div>
      </Popover>
    </AriaDatePicker>
  );
}

/** A named span of days in the range picker's presets column. */
export interface RangePreset { readonly id: string; readonly label: string; readonly start: CalendarDate; readonly end: CalendarDate }

/** Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, counted from `now`. */
export function defaultPresets(now: CalendarDate = today(getLocalTimeZone())): ReadonlyArray<RangePreset> {
  const lastMonth = now.subtract({ months: 1 });
  return [
    { id: 'today', label: 'Today', start: now, end: now },
    { id: 'yesterday', label: 'Yesterday', start: now.subtract({ days: 1 }), end: now.subtract({ days: 1 }) },
    { id: '7', label: 'Last 7 days', start: now.subtract({ days: 6 }), end: now },
    { id: '30', label: 'Last 30 days', start: now.subtract({ days: 29 }), end: now },
    { id: 'month', label: 'This month', start: startOfMonth(now), end: now },
    { id: 'last-month', label: 'Last month', start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) },
  ];
}

function Presets({ presets }: { readonly presets: ReadonlyArray<RangePreset> }) {
  const state = useContext(DateRangePickerStateContext);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const v = state?.value;
  const active = presets.find((p) => v?.start && v.end && p.start.compare(v.start) === 0 && p.end.compare(v.end) === 0);
  const choose = (id: Key) => {
    const p = presets.find((x) => x.id === id);
    if (!p || !state) return;
    state.setValue({ start: p.start, end: p.end });
    timer.current = window.setTimeout(() => state.close(), CLOSE_AFTER_PICK_MS);
  };
  return (
    <ListBox
      aria-label="Presets" className="tf-range__presets" selectionMode="single" disallowEmptySelection
      selectedKeys={active ? [active.id] : []} onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) choose(k); }}
    >
      {presets.map((p) => <ListBoxItem key={p.id} id={p.id} className="tf-range__preset">{p.label}</ListBoxItem>)}
    </ListBox>
  );
}

/** A span of days in one filled field (start – end), with presets beside the calendar like Square's and Linear's. */
export function DateRangePicker<T extends DateValue>({ label, description, errorMessage, presets = defaultPresets(), className, ...rest }: Omit<AriaDateRangePickerProps<T>, 'className'> & FieldBits & { readonly presets?: ReadonlyArray<RangePreset>; readonly className?: string }) {
  return (
    <AriaDateRangePicker<T> {...rest} className={cx('tf-date', className)}>
      <Label className={PICKER_LABEL}>{label}</Label>
      <Group className={cx(PICKER_FIELD, 'tf-date__field')}>
        <DateInput slot="start" className="tf-date__input tf-date__input--start">{(segment) => <DateSegment segment={segment} className="tf-date__seg" />}</DateInput>
        <span className="tf-date__dash" aria-hidden="true">–</span>
        <DateInput slot="end" className="tf-date__input">{(segment) => <DateSegment segment={segment} className="tf-date__seg" />}</DateInput>
        <AriaButton className="tf-date__btn" aria-label="Open calendar"><CalendarDays {...chev} /></AriaButton>
      </Group>
      {description !== undefined && <Text slot="description" className={PICKER_HELP}>{description}</Text>}
      <FieldError className={PICKER_ERROR}>{errorMessage}</FieldError>
      <Popover placement="bottom end" label="Calendar" className="tf-date__pop">
        <div className="tf-range__panel">
          <Presets presets={presets} />
          <RangeCalendar />
        </div>
      </Popover>
    </AriaDateRangePicker>
  );
}

/** What a time grid shows at once. */
export type DateView = 'day' | 'week' | 'month';
const STEP: Readonly<Record<DateView, DateDuration>> = { day: { days: 1 }, week: { weeks: 1 }, month: { months: 1 } };

/** The label DateNav shows for a date in a view: "Mon, 9 Nov 2026", "9 – 15 Nov 2026", "November 2026". */
export function dateNavLabel(date: CalendarDate, view: DateView, locale = 'en-GB'): string {
  const tz = getLocalTimeZone();
  const js = (d: CalendarDate) => d.toDate(tz);
  if (view === 'day') return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(js(date));
  if (view === 'month') return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(js(date));
  const a = startOfWeek(date, locale);
  const b = endOfWeek(date, locale);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(js(a), js(b));
}

/** Props for DateNav. */
export interface DateNavProps {
  readonly date: CalendarDate;
  readonly onDateChange: (date: CalendarDate) => void;
  readonly view: DateView;
  readonly onViewChange?: (view: DateView) => void;
  /** The views offered in the segmented control; omit onViewChange to hide it. */
  readonly views?: ReadonlyArray<DateView>;
  /** T, J and K move the grid while focus isn't in a field. */
  readonly enableShortcuts?: boolean;
  /** Something after the label (a time zone, a filter). */
  readonly end?: ReactNode;
}

/** The bar a calendar or roster leads with: Today, previous, next, the range it shows, and Day / Week / Month. */
export function DateNav({ date, onDateChange, view, onViewChange, views = ['day', 'week', 'month'], enableShortcuts = false, end }: DateNavProps) {
  const now = today(getLocalTimeZone());
  const label = dateNavLabel(date, view);
  const unit = view === 'day' ? 'day' : view;
  useEffect(() => {
    if (!enableShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest('input, textarea, [contenteditable], [role="spinbutton"], [role="combobox"]')))) return;
      const k = e.key.toLowerCase();
      if (k === 't') onDateChange(today(getLocalTimeZone()));
      else if (k === 'k') onDateChange(date.subtract(STEP[view]));
      else if (k === 'j') onDateChange(date.add(STEP[view]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableShortcuts, date, view, onDateChange]);
  return (
    <div className="tf-datenav">
      <Tooltip label="Go to today" shortcut="T"><Button size="sm" onPress={() => onDateChange(now)}>Today</Button></Tooltip>
      <span className="tf-datenav__steps">
        <Tooltip label={`Previous ${unit}`} shortcut="K"><IconButton size="sm" label={`Previous ${unit}`} onPress={() => onDateChange(date.subtract(STEP[view]))}><ChevronLeft {...chev} /></IconButton></Tooltip>
        <Tooltip label={`Next ${unit}`} shortcut="J"><IconButton size="sm" label={`Next ${unit}`} onPress={() => onDateChange(date.add(STEP[view]))}><ChevronRight {...chev} /></IconButton></Tooltip>
      </span>
      <h3 className="tf-datenav__label" aria-live="polite"><TextSwap swapKey={label}>{label}</TextSwap></h3>
      {end}
      {onViewChange && <span className="tf-datenav__end"><SegmentedControl aria-label="View" size="sm" items={views.map((v) => ({ id: v, label: v[0]?.toUpperCase() + v.slice(1) }))} selectedKey={view} onSelectionChange={(k) => onViewChange(k as DateView)} /></span>}
    </div>
  );
}
