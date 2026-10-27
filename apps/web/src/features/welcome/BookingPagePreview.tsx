// Brief
// Purpose: the page beside first run's Your booking page (27 October 2026): the booking page as a visitor will
// see it, drawn from what the step has typed.
// Main task: show the meeting's name and its length on the page that will carry them, so the thing being made is
// on screen while it is made.
// Leaves out: real times (the hours aren't set yet), the location, the questions and the Book bar: it is a sketch
// of the page, inert, and nothing here books anything.
import { BookingFrame, MonthTiles, PhonePreview, SlotList } from '@crm/ui';
import { useMemo } from 'react';
import { strings } from './strings.ts';

/** The sample times the sketch shows: a working morning, so the pane reads as a real day's. */
const SAMPLE_TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] as const;

/** `YYYY-MM-DD` for a date, in its own zone: the month's tiles are named this way. */
function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** Props for the booking page beside the step. */
export interface BookingPagePreviewProps {
  /** The host at the head of the page. */
  readonly name: string;
  /** The meeting as typed; the placeholder stands in until it has a name. */
  readonly title: string;
  /** How long it is, in minutes. */
  readonly minutes: number;
  /** The host's account photo, when they have one: the page shows it in place of the initials. */
  readonly image?: string;
}

/**
 * The booking page as it stands: the host, the meeting and its length, and a
 * month of weekdays with a morning's times. Inert: a sketch of the page, not
 * the page, since its hours and its address don't exist yet.
 */
export function BookingPagePreview({ name, title, minutes, image }: BookingPagePreviewProps) {
  // The weekdays of the month showing, so the tiles read as a working week rather than an empty grid.
  const { month, today, openDays } = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const days = new Set<string>();
    for (let date = new Date(first); date.getMonth() === first.getMonth(); date.setDate(date.getDate() + 1)) {
      const weekday = date.getDay();
      if (weekday !== 0 && weekday !== 6 && date >= now) days.add(dayOf(date));
    }
    return {
      month: dayOf(first).slice(0, 7),
      today: dayOf(now),
      openDays: days,
    };
  }, []);
  const chosen = [...openDays][0];
  // The times' heading is the day they are on, as the real page says it ("Wed 28 Oct"), not a word about weekdays.
  const chosenLabel =
    chosen === undefined
      ? ''
      : new Date(`${chosen}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
  const shown = title.trim() === '' ? strings.bookingNamePlaceholder : title.trim();
  return (
    // The editors' own phone, so the page lays itself out as it does on a phone (the rail over the card) instead
    // of being squeezed into half a panel. Decoration, like the workspace sketch beside the other steps: nothing
    // in it is pressable or focusable, and it is out of the accessibility tree, since the frame draws a `main` of
    // its own and the page already has one.
    <PhonePreview>
      <div inert aria-hidden="true">
        <BookingFrame
          isCompact
          host={{ name, ...(image === undefined ? {} : { image }) }}
          title={shown}
          facts={[{ id: 'length', icon: 'clock', children: strings.bookingLengthLabel(minutes) }]}
          heading={strings.previewChooseTime}
          aside={
            <SlotList
              heading={chosenLabel}
              slots={SAMPLE_TIMES.map((time) => ({ id: time, label: time, name: time }))}
              value={undefined}
              onChange={() => undefined}
            />
          }
        >
          <MonthTiles
            month={month}
            today={today}
            openDays={openDays}
            value={chosen}
            onChange={() => undefined}
            onMonthChange={() => undefined}
            canPrevious={false}
            canNext={false}
          />
        </BookingFrame>
      </div>
    </PhonePreview>
  );
}
