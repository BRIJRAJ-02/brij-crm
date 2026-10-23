// Brief
// Purpose: a booking page's own "Add bookings to" (spec 0024, AC-997) in its editor: which of the owner's calendars its new bookings go on.
// Main task: the owner picks one of their writable calendars, or their default; it saves at once, like the Live switch.
// Leaves out: the member's own default (Settings › Calendars), and calendar names for colleagues, who see "Owner’s default" only (spec 0037).
import type { CalendarListState, CalendarsHeld, PageDestinationState } from '@crm/data';
import { useCalendarList, usePageDestination } from '@crm/data/react';
import { Badge, ButtonLink, Card, FieldGroup, Select } from '@crm/ui';
import { calendarOptions } from '../calendars/calendar-options.ts';
import { DEFAULT_DESTINATION, destinationChoice, destinationHint } from './destination.ts';
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
  /** Settings › Calendars, where an owner with no calendar connects one. */
  readonly settingsHref: string;
}

const DEFAULT = DEFAULT_DESTINATION;

/**
 * The Meeting tab's Calendar section: "Add bookings to", a Select of the owner's writable calendars after their
 * default; colleagues read it only. An owner with no calendar connected gets the section's empty state, with
 * Connect calendar to Settings › Calendars.
 */
export function PageDestination({ destination, calendars, isReadOnly, onChange, settingsHref }: PageDestinationProps) {
  const held = usePageDestination(destination);
  const list = useCalendarList(calendars);
  if (held.status === 'ready' && held.destination.isOwner && list.status === 'ready' && list.accounts.length === 0) {
    return (
      <Card
        title={strings.calendarSection}
        description={strings.noCalendars}
        actions={
          <ButtonLink href={settingsHref} size="sm" icon="plus">
            {strings.connectCalendar}
          </ButtonLink>
        }
      />
    );
  }
  return <Card title={strings.calendarSection}>{destinationField(held, list, isReadOnly, onChange)}</Card>;
}

/** The section's one field, in each of its states. */
function destinationField(
  held: ReturnType<typeof usePageDestination>,
  list: ReturnType<typeof useCalendarList>,
  isReadOnly: boolean,
  onChange: (calendarId: string | null) => void,
) {
  // A failed read keeps the field in place, saying so, rather than leaving a gap.
  if (held.status === 'error' || (held.status === 'ready' && held.destination.isOwner && list.status === 'error')) {
    return <Select label={strings.addBookingsTo} items={[]} isDisabled error={strings.destinationFailed} />;
  }
  if (held.status === 'loading' || (held.destination.isOwner && list.status === 'loading')) {
    // Its place, while it reads: the card under it never moves.
    return <Select label={strings.addBookingsTo} items={[]} placeholder={strings.destinationLoading} isDisabled />;
  }
  const { calendarId, status, isOwner } = held.destination;
  const choice = destinationChoice(held.destination);
  const value = choice.value ?? DEFAULT;
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
  // An owner with no calendar has nowhere to choose: the section says so instead (above).
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
    // Listed but not choosable: the page's pick, while it can't take bookings now. It stays listed when not in use.
    include: (calendar) => calendar.canBeDestination || calendar.id === calendarId,
    chosen: calendarId,
    isDisabled: (calendar) => !calendar.canBeDestination,
  });
  return (
    <Select
      label={strings.addBookingsTo}
      items={items}
      optionStyle="dot"
      optionDescription="below"
      value={choice.value}
      // A pick that went shows the default as a placeholder, so choosing Default clears the note.
      {...(choice.value === null && items[0] !== undefined ? { placeholder: items[0].label } : {})}
      hint={destinationHint(held.destination, all)}
      isReadOnly={isReadOnly}
      onChange={(id) => {
        const sent = choice.send(id);
        if (sent !== undefined) onChange(sent);
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
  // A section of the Hours tab: Conflicts, with Manage (or Connect calendar) at its head, and the calendars as
  // Badges in one row.
  if (list.accounts.length === 0) {
    return (
      <Card
        title={strings.conflicts}
        description={strings.noCalendars}
        actions={
          <ButtonLink href={settingsHref} size="sm" icon="plus">
            {strings.connectCalendar}
          </ButtonLink>
        }
      />
    );
  }
  const checked = calendarOptions({ accounts: list.accounts, include: (calendar) => calendar.checkConflicts });
  return (
    <Card
      title={strings.conflicts}
      actions={
        <ButtonLink href={settingsHref} variant="ghost" size="sm" icon="settings">
          {strings.manage}
        </ButtonLink>
      }
    >
      <FieldGroup
        label={strings.checksConflictsIn}
        layout="row"
        {...(checked.length === 0 ? { hint: strings.noneChecked } : {})}
      >
        {checked.map((item) => (
          <Badge key={item.id} size="chip" text={item.label} dot={item.hue ?? 'gray'} />
        ))}
      </FieldGroup>
    </Card>
  );
}
