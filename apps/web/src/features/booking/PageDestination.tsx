// Brief
// Purpose: a booking page's own "Add bookings to" (spec 0024, AC-997) in its editor: which of the owner's calendars its new bookings go on.
// Main task: the owner picks one of their writable calendars, or their default; it saves at once, like the Live switch.
// Leaves out: the member's own default (Settings › Calendars), and calendar names for colleagues, who see "Owner’s default" only (spec 0037).
import type { CalendarListState, CalendarsHeld, PageDestinationState } from '@crm/data';
import { useCalendarList, usePageDestination } from '@crm/data/react';
import { Badge, ButtonLink, FieldGroup, Select } from '@crm/ui';
import { calendarOptions } from '../calendars/calendar-options.ts';
import { destinationHint } from './destination.ts';
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
}

/** The value meaning "the owner's own destination". */
const DEFAULT = 'default';

/** "Add bookings to": a Select of the owner's writable calendars after their default; colleagues read it only. */
export function PageDestination({ destination, calendars, isReadOnly, onChange }: PageDestinationProps) {
  const held = usePageDestination(destination);
  const list = useCalendarList(calendars);
  // A failed read keeps the field in place, saying so, rather than leaving a gap.
  if (held.status === 'error' || (held.status === 'ready' && held.destination.isOwner && list.status === 'error')) {
    return <Select label={strings.addBookingsTo} items={[]} isDisabled error={strings.destinationFailed} />;
  }
  if (held.status === 'loading' || (held.destination.isOwner && list.status === 'loading')) {
    // Its place, while it reads: the card under it never moves.
    return <Select label={strings.addBookingsTo} items={[]} placeholder={strings.destinationLoading} isDisabled />;
  }
  const { calendarId, status, isOwner } = held.destination;
  // A pick that can't take bookings now shows as the default, which is where bookings go (AC-997): the page falls
  // back rather than staying pinned, and goes back to its pick once that calendar can take bookings again.
  const value = status === 'page' && calendarId !== undefined ? calendarId : DEFAULT;
  if (!isOwner) {
    return (
      <Select
        label={strings.addBookingsTo}
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
  // The default first, its note a muted line under it; then the calendars, an account with one listed flat.
  const items = calendarOptions({
    accounts,
    lead: [
      {
        id: DEFAULT,
        label: current === undefined ? strings.myDefaultCalendar : strings.yourDefault(current.name),
        description: strings.followsDefault,
        ...(current === undefined ? {} : { hue: current.hue }),
      },
    ],
    // Listed but not choosable: the page's pick, while it can't take bookings now.
    include: (calendar) => calendar.canBeDestination || calendar.id === calendarId,
    isDisabled: (calendar) => !calendar.canBeDestination,
  });
  return (
    <Select
      label={strings.addBookingsTo}
      items={items}
      optionStyle="dot"
      optionDescription="below"
      value={value}
      hint={destinationHint(held.destination, all)}
      isReadOnly={isReadOnly}
      onChange={(id) => {
        // Against the stored pick: choosing the default while it only stands in for a stopped pick clears it.
        const stored = status === 'default' || calendarId === undefined ? DEFAULT : calendarId;
        if (id === null || id === stored) return;
        onChange(id === DEFAULT ? null : id);
      }}
    />
  );
}

/** Props for PageConflicts. */
export interface PageConflictsProps {
  readonly destination: CalendarsHeld<PageDestinationState>;
  readonly calendars: CalendarsHeld<CalendarListState>;
  /** Settings › Calendars, where each calendar's Check for conflicts lives. */
  readonly settingsHref: string;
}

/**
 * "Checks for conflicts in": the owner's calendars that hold this page's times back, each a Badge in its own colour,
 * with Manage to Settings › Calendars, where that switch lives (never per page). With none connected, it says so and
 * offers to connect one. Colleagues see none of the owner's calendars, so it shows to the owner only.
 */
export function PageConflicts({ destination, calendars, settingsHref }: PageConflictsProps) {
  const held = usePageDestination(destination);
  const list = useCalendarList(calendars);
  if (held.status !== 'ready' || !held.destination.isOwner || list.status !== 'ready') return null;
  if (list.accounts.length === 0) {
    return (
      <FieldGroup label={strings.checksConflictsIn} hint={strings.noCalendars} layout="row">
        <ButtonLink href={settingsHref} size="sm" icon="plus">
          {strings.connectCalendar}
        </ButtonLink>
      </FieldGroup>
    );
  }
  const checked = calendarOptions({ accounts: list.accounts, include: (calendar) => calendar.checkConflicts });
  return (
    <FieldGroup
      label={strings.checksConflictsIn}
      layout="row"
      action={
        <ButtonLink href={settingsHref} variant="ghost" size="sm" icon="settings">
          {strings.manage}
        </ButtonLink>
      }
      {...(checked.length === 0 ? { hint: strings.noneChecked } : {})}
    >
      {checked.map((item) => (
        <Badge key={item.id} size="chip" text={item.label} dot={item.hue ?? 'gray'} />
      ))}
    </FieldGroup>
  );
}
