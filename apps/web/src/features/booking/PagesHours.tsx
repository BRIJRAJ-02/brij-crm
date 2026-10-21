// Brief
// Purpose: Bookings › Availability's list of the member's own pages with the hours each books on, as timefix shows them.
// Main task: see at a glance which pages follow the default schedule and which name another, and open one to change it.
// Leaves out: changing a page's schedule here (its editor does), and pages someone else owns.
import type { BookingAvailability, BookingPageView, ScheduleView } from '@crm/data';
import { Card, Link, LinkList, type LinkRow } from '@crm/ui';
import { weekSummary, zoneLabel, zoneOffset } from './hours.ts';
import { linksHref } from './links.ts';
import { strings } from './strings.ts';

/** Props for PagesHours. */
export interface PagesHoursProps {
  readonly slug: string;
  /** The member's own pages. */
  readonly pages: readonly BookingPageView[];
  /** `error` when they didn't load: the list's own failure state, with Try again. */
  readonly status: 'ready' | 'error';
  readonly onRetry: () => void;
  /** The default schedule's week as it stands on the screen, unsaved changes included: a page that follows it shows them. */
  readonly mine: BookingAvailability;
  /** The member's schedules (spec 0035): a page naming one shows its name and its hours as they stand. */
  readonly schedules: readonly ScheduleView[];
  readonly locale: string;
  /** Opens a page's editor. */
  readonly onOpen: (pageId: string) => void;
}

/** The member's pages, each with the hours it books on: the default schedule's, or the schedule it names. */
export function PagesHours({ slug, pages, status, onRetry, mine, schedules, locale, onOpen }: PagesHoursProps) {
  // None yet: the card says so in its header and offers the way to make one, sized to that (no tall empty
  // state framed inside the card).
  if (status === 'ready' && pages.length === 0) {
    return (
      <Card title={strings.yourPages} description={strings.noPagesText}>
        <Link href={linksHref(slug)}>{strings.goToPages}</Link>
      </Card>
    );
  }
  const now = new Date();
  const fallback = schedules.find((each) => each.isDefault);
  const rows: readonly LinkRow[] = pages.map((page) => {
    // Null follows the default (spec 0035, AC-965), as does a page naming a schedule deleted meanwhile; a page
    // naming the default by its id shows the week being edited too.
    const named = page.scheduleId === null ? undefined : schedules.find((each) => each.id === page.scheduleId);
    const hours = named === undefined || named.isDefault ? mine : named.availability;
    return {
      id: page.id,
      title: page.title,
      // The hours are what this list is for, so they take the muted line after the title (the address is the
      // editor's business here).
      address: weekSummary(hours, locale).join(' · '),
      // The zone only where it isn't the one beside the week (a page with hours of its own, kept in another zone).
      chips: [
        (named ?? fallback)?.name ?? strings.followsYou,
        ...(hours.timeZone === mine.timeZone
          ? []
          : [`${zoneLabel(hours.timeZone)} ${zoneOffset(hours.timeZone, now)}`]),
      ],
      // Off shows in the muted title; the badge is for what it can't say.
      ...(page.isPrivate ? { badge: strings.private } : {}),
      isOff: page.status === 'paused',
    };
  });
  return (
    <Card title={strings.yourPages} description={strings.yourPagesText}>
      <LinkList
        density="compact"
        placement="card"
        label={strings.yourPages}
        rows={rows}
        onOpen={onOpen}
        searchLabel={strings.yourPages}
        isToolbarHidden
        status={status}
        onRetry={onRetry}
        errorTitle={strings.pagesFailed}
      />
    </Card>
  );
}
