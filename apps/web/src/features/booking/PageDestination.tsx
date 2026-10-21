// Brief
// Purpose: a booking page's own "Add events to" (spec 0024, AC-997) in its editor: which of the owner's calendars its new bookings go on.
// Main task: the owner picks one of their writable calendars, or their default; it saves at once, like the Live switch.
// Leaves out: the member's own default (Settings › Calendars), and calendar names for colleagues, who see "Owner’s default" only (spec 0037).
import type { CalendarItem, CalendarListState, CalendarsHeld, PageDestinationState } from '@crm/data';
import { useCalendarList, usePageDestination } from '@crm/data/react';
import { DescriptionList, Link, Select, type SelectItem } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for PageDestination. */
export interface PageDestinationProps {
  /** The page's own destination, held while the editor shows it. */
  readonly destination: CalendarsHeld<PageDestinationState>;
  /** The reader's own accounts and calendars: their names, when the reader owns the page. */
  readonly calendars: CalendarsHeld<CalendarListState>;
  /** The reader can't change the page. */
  readonly isReadOnly: boolean;
  /** Sets it (`null`: the owner's default): at once, put back with a toast if refused. */
  readonly onChange: (calendarId: string | null) => void;
  /** Settings › Calendars, where each calendar's Check for conflicts lives. */
  readonly settingsHref: string;
}

/** The value meaning "the owner's own destination". */
const DEFAULT = 'default';

/** "Add events to": a Select of the owner's writable calendars after their default; colleagues read it only. */
export function PageDestination({ destination, calendars, isReadOnly, onChange, settingsHref }: PageDestinationProps) {
  const held = usePageDestination(destination);
  const list = useCalendarList(calendars);
  // A failed read keeps the field in place, saying so, rather than leaving a gap.
  if (held.status === 'error' || (held.status === 'ready' && held.destination.isOwner && list.status === 'error')) {
    return <Select label={strings.addEventsTo} items={[]} isDisabled error={strings.destinationFailed} />;
  }
  if (held.status === 'loading' || (held.destination.isOwner && list.status === 'loading')) {
    // Its place, while it reads: the card under it never moves.
    return <Select label={strings.addEventsTo} items={[]} placeholder={strings.destinationLoading} isDisabled />;
  }
  const { calendarId, status, isOwner } = held.destination;
  // A pick that can't take bookings now shows as the default, which is where bookings go (AC-997): the page falls
  // back rather than staying pinned, and goes back to its pick once that calendar can take bookings again.
  const value = status === 'page' && calendarId !== undefined ? calendarId : DEFAULT;
  if (!isOwner) {
    return (
      <Select
        label={strings.addEventsTo}
        items={[{ id: value, label: value === DEFAULT ? strings.ownersDefault : strings.ownersPick }]}
        value={value}
        isReadOnly
        // A read only Select shows its reason in place of a hint or an error: the unusable pick matters more.
        readOnlyReason={status === 'unusable' ? strings.destinationUnusableColleague : strings.destinationOwnerOnly}
      />
    );
  }
  const accounts = list.status === 'ready' ? list.accounts : [];
  // An owner with no calendar has nowhere to choose: the editor's calendar note says how to connect one.
  if (accounts.length === 0) return null;
  const all = accounts.flatMap((account) => account.calendars);
  const current = all.find((calendar) => calendar.isDestination);
  // With two or more accounts, each account's calendars under its address, as the Bookings panel lists them.
  const isGrouped = accounts.length > 1;
  const option = (calendar: CalendarItem, email: string): SelectItem => ({
    id: calendar.id,
    label: calendar.name,
    hue: calendar.hue,
    ...(isGrouped ? { group: email } : {}),
    // Listed but not choosable: the page's pick, while it can't take bookings now.
    ...(calendar.canBeDestination ? {} : { isDisabled: true }),
  });
  const items: SelectItem[] = [
    {
      id: DEFAULT,
      label: current === undefined ? strings.myDefaultCalendar : strings.yourDefault(current.name),
      description: strings.followsDefault,
      ...(current === undefined ? {} : { hue: current.hue }),
    },
    ...accounts.flatMap((account) =>
      account.calendars
        .filter((calendar) => calendar.canBeDestination || calendar.id === calendarId)
        .map((calendar) => option(calendar, account.accountEmail)),
    ),
  ];
  const conflicts = all.filter((calendar) => calendar.checkConflicts).length;
  return (
    <>
      <Select
        label={strings.addEventsTo}
        items={items}
        optionStyle="dot"
        value={value}
        hint={
          status === 'unusable'
            ? strings.destinationFellBack(all.find((calendar) => calendar.id === calendarId)?.name)
            : strings.addEventsHint
        }
        isReadOnly={isReadOnly}
        onChange={(id) => {
          // Against the stored pick: choosing the default while it only stands in for a stopped pick clears it.
          const stored = status === 'default' || calendarId === undefined ? DEFAULT : calendarId;
          if (id === null || id === stored) return;
          onChange(id === DEFAULT ? null : id);
        }}
      />
      {/* Which calendars hold this page's times back: set in Settings, never per page. */}
      <DescriptionList
        items={[
          {
            term: strings.conflicts,
            description: (
              <>
                {strings.checksCalendars(conflicts)} <Link href={settingsHref}>{strings.calendarSettings}</Link>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
