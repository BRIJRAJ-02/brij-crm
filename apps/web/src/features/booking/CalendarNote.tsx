// Brief
// Purpose: the booking page editor's "No calendar connected" note, shared by the editor and its loading state.
// Main task: say that without a calendar a page offers the member's hours minus bookings only, with the way to connect one or Not now.
// Leaves out: connecting a calendar (Settings › Calendars) and the editor itself.
import { Button, Callout, Link } from '@crm/ui';
import { calendarSettingsHref } from '../settings/nav.ts';
import { strings } from './strings.ts';

/** Where the calendar note's "Not now" is kept, for this tab's session. */
const dismissedKey = (slug: string) => `crm.booking.calendarNote.${slug}`;

/** Whether the calendar note was put away in this tab's session (storage may be blocked: then it shows). */
export function readDismissed(slug: string): boolean {
  try {
    return globalThis.sessionStorage.getItem(dismissedKey(slug)) === '1';
  } catch {
    return false;
  }
}

/** Puts the calendar note away for this tab's session, where storage allows. */
export function writeDismissed(slug: string): void {
  try {
    globalThis.sessionStorage.setItem(dismissedKey(slug), '1');
  } catch {
    // Blocked storage: the note stays away until the page reloads.
  }
}

/** Props for CalendarNote. */
export interface CalendarNoteProps {
  readonly slug: string;
  /** Calendar sync is on, so Connect a calendar leads somewhere. */
  readonly canConnect: boolean;
  /** Not now; left out while the editor loads, when the note only holds its place. */
  readonly onDismiss?: () => void;
}

/** The note itself: the same in the editor and in its loading state, so the cards under it never move. */
export function CalendarNote({ slug, canConnect, onDismiss }: CalendarNoteProps) {
  return (
    <Callout
      tone="info"
      title={strings.noCalendarTitle}
      actions={
        <>
          {canConnect && <Link href={calendarSettingsHref(slug)}>{strings.connectCalendar}</Link>}
          <Button
            variant="ghost"
            isDisabled={onDismiss === undefined}
            {...(onDismiss === undefined ? {} : { onPress: onDismiss })}
          >
            {strings.notNow}
          </Button>
        </>
      }
    >
      {strings.noCalendar}
    </Callout>
  );
}
