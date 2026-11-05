import type { Ref } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { ShortcutTooltip } from '../../atoms/Tooltip/ShortcutTooltip.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';

/** One step button: its name, and its key when it has one. */
interface Step {
  /** "Previous week", "Next day". */
  readonly label: string;
  readonly onPress: () => void;
  /** At the first or last place there is to go. */
  readonly isDisabled?: boolean;
  /** Its single key shortcut, taught in its tooltip ("K"). */
  readonly kbd?: string;
}

/** Props for DateNav. */
export interface DateNavProps {
  /** Today's button: "Today", or "Today · 19 Oct" while another week shows. Never off, so the arrows never move. */
  readonly today: {
    readonly label: string;
    /** Its tooltip ("Go to today"). */
    readonly hint: string;
    readonly onPress: () => void;
    readonly kbd?: string;
    /** Only while the screen loads, when there is nowhere to go yet. */
    readonly isDisabled?: boolean;
  };
  readonly previous: Step;
  readonly next: Step;
  /** Go to date: a calendar icon after the arrows, opening a month the screen draws (its Popover's trigger). */
  readonly jump?: {
    readonly label: string;
    readonly isExpanded: boolean;
    readonly onPress: () => void;
    readonly ref?: Ref<HTMLButtonElement>;
  };
}

/** A step button with its tooltip, which teaches the key when there is one. */
function StepButton({ step, icon }: { readonly step: Step; readonly icon: 'chevron-left' | 'chevron-right' }) {
  const button = (
    <Button
      variant="ghost"
      icon={icon}
      label={step.label}
      onPress={step.onPress}
      {...(step.isDisabled === undefined ? {} : { isDisabled: step.isDisabled })}
    />
  );
  return step.kbd === undefined ? (
    <Tooltip content={step.label}>{button}</Tooltip>
  ) : (
    <ShortcutTooltip content={step.label} kbd={step.kbd}>
      {button}
    </ShortcutTooltip>
  );
}

/**
 * The date stepper every time grid leads its bar with (Bookings' Calendar and Roster): Today, then previous and next,
 * then Go to date when the screen has a month to open. The range it moves through is the bar's title (SectionBar's
 * `title`), so the order and the look are one wherever dates step.
 */
export function DateNav({ today, previous, next, jump }: DateNavProps) {
  const todayButton = (
    <Button
      variant="secondary"
      onPress={today.onPress}
      {...(today.isDisabled === undefined ? {} : { isDisabled: today.isDisabled })}
    >
      {today.label}
    </Button>
  );
  return (
    <>
      {today.kbd === undefined ? (
        <Tooltip content={today.hint}>{todayButton}</Tooltip>
      ) : (
        <ShortcutTooltip content={today.hint} kbd={today.kbd}>
          {todayButton}
        </ShortcutTooltip>
      )}
      <StepButton step={previous} icon="chevron-left" />
      <StepButton step={next} icon="chevron-right" />
      {jump !== undefined && (
        <Button
          {...(jump.ref === undefined ? {} : { ref: jump.ref })}
          variant="ghost"
          icon="calendar-days"
          label={jump.label}
          isExpanded={jump.isExpanded}
          onPress={jump.onPress}
        />
      )}
    </>
  );
}

/**
 * A week's dates in the one format every date bar uses: "2 – 8 November 2026", or "28 Dec 2026 – 3 Jan 2027" across
 * a year. `monday` is the week's first day as `YYYY-MM-DD`.
 */
export function weekRangeLabel(monday: string, locale: string): string {
  const [year = 1970, month = 1, day = 1] = monday.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(Date.UTC(year, month - 1, day + 6));
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: sameYear ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(start, end);
}
