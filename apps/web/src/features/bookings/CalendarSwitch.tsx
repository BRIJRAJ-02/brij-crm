// Brief
// Purpose: the Bookings week's calendar switch (the owner, 22 October 2026): one calendar at a time, or all of them,
// in the week's own controls bar, in place of the Calendars panel's boxes.
// Main task: pick All calendars or one connected calendar; bookings always show, and the pick filters only the
// calendars' events and busy time (the owner, 22 October 2026: "the tab should be only for no of calendar connected").
// Leaves out: several calendars at once (the List tab's panel still does that), and the calendars' own settings
// (Settings › Calendars).
import type { CalendarAccountView } from '@crm/data';
import { Button, Menu, MenuItem, MenuTrigger, SegmentedControl, type Hue, type Segment } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** All calendars: the week shows bookings and every calendar's events. */
export const ALL_CALENDARS = 'all';

/** The fewest calendars there is a choice between: with one or none the switch is hidden. */
const FEWEST_TO_SWITCH = 2;

/** The most segments a SegmentedControl holds; the rest of the calendars fold into More. */
const MOST_SEGMENTS = 5;

/** Where the choice is kept, per workspace, in this browser. */
const keyOf = (slug: string) => `crm.bookings.weekCalendar.${slug}`;

/** The member's choice in this browser; storage may be blocked, and then it is All calendars. */
function readChoice(slug: string): string {
  try {
    return globalThis.localStorage.getItem(keyOf(slug)) ?? ALL_CALENDARS;
  } catch {
    return ALL_CALENDARS;
  }
}

/** Keeps the choice in this browser, where storage allows. */
function writeChoice(slug: string, choice: string): void {
  try {
    globalThis.localStorage.setItem(keyOf(slug), choice);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/** One calendar the switch offers: the member's, shown on their week. */
export interface SwitchCalendar {
  readonly id: string;
  readonly name: string;
  readonly hue: Hue;
  /** Its account's address, which tells two calendars of the same name apart in More. */
  readonly account: string;
}

/** The calendars the week may show, in the order the switch lists them. */
export function switchCalendars(accounts: readonly CalendarAccountView[]): readonly SwitchCalendar[] {
  return accounts.flatMap((account) =>
    account.calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      hue: calendar.hue,
      account: account.accountEmail,
    })),
  );
}

/**
 * The week's calendar choice, kept per workspace in this browser. A kept calendar counts only once the calendars
 * are read, it is still on the week, and there are two or more (so the switch shows): while they load, or when
 * they fail, or once it was disconnected or hidden in Settings, the week shows All calendars, so it never hides
 * events behind a switch that isn't there. A choice kept as the old "bookings" segment reads as All calendars too.
 */
export function useCalendarChoice(slug: string, calendars: readonly SwitchCalendar[] | undefined) {
  const [kept, setKept] = useState(() => ({ slug, value: readChoice(slug) }));
  // Another workspace: its own choice.
  if (kept.slug !== slug) setKept({ slug, value: readChoice(slug) });
  const value = kept.slug === slug ? kept.value : readChoice(slug);
  const isKnown =
    value === ALL_CALENDARS ||
    (calendars !== undefined &&
      calendars.length >= FEWEST_TO_SWITCH &&
      calendars.some((calendar) => calendar.id === value));
  return {
    choice: isKnown ? value : ALL_CALENDARS,
    choose: (next: string) => {
      writeChoice(slug, next);
      setKept({ slug, value: next });
    },
  };
}

/** What the choice shows: bookings always, and which calendars' events and busy time. */
export function showsOf(choice: string): {
  readonly bookings: boolean;
  readonly calendar: (calendarId: string) => boolean;
} {
  if (choice === ALL_CALENDARS) return { bookings: true, calendar: () => true };
  return { bookings: true, calendar: (calendarId) => calendarId === choice };
}

/**
 * All calendars, then each connected calendar by its name in its colour, as one SegmentedControl (arrow keys move
 * and choose), each segment as wide as its name. With one calendar or none there is nothing to choose, and it draws
 * nothing. Past five segments the rest fold into a More menu, which marks the chosen one and names it on its button;
 * the segments never move, so nothing jumps under the pointer.
 */
export function CalendarSwitch({
  calendars,
  choice,
  onChoose,
}: {
  readonly calendars: readonly SwitchCalendar[];
  readonly choice: string;
  readonly onChoose: (next: string) => void;
}) {
  if (calendars.length < FEWEST_TO_SWITCH) return undefined;
  const room = MOST_SEGMENTS - 1;
  const shown = calendars.length <= room ? calendars : calendars.slice(0, room - 1);
  const folded = calendars.slice(shown.length);
  const chosenFolded = folded.find((calendar) => calendar.id === choice);
  const segments: Segment[] = [
    { value: ALL_CALENDARS, label: strings.allCalendars },
    ...shown.map((calendar) => ({ value: calendar.id, label: calendar.name, hue: calendar.hue })),
  ];
  return (
    <>
      <SegmentedControl
        label={strings.calendars}
        size="compact"
        isFitted
        segments={segments}
        value={choice}
        onChange={onChoose}
      />
      {folded.length > 0 && (
        <MenuTrigger>
          {/* Its name is its words: the chosen calendar's, else how many more there are. */}
          <Button variant={chosenFolded === undefined ? 'ghost' : 'secondary'} iconRight="chevron-down">
            {chosenFolded === undefined ? strings.moreCount(folded.length) : chosenFolded.name}
          </Button>
          <Menu
            label={strings.moreCalendars}
            selectionMode="single"
            selectedKeys={chosenFolded === undefined ? [] : [chosenFolded.id]}
            onAction={(key) => onChoose(String(key))}
          >
            {folded.map((calendar) => (
              <MenuItem key={calendar.id} id={calendar.id} description={calendar.account}>
                {calendar.name}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      )}
    </>
  );
}
