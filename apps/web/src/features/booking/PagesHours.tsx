// Brief
// Purpose: Bookings › Availability's list of the member's own pages with the hours each books on, as timefix shows them.
// Main task: see at a glance which pages follow these hours and which keep their own, and open one to change it.
// Leaves out: changing a page's hours here (its editor does), and pages someone else owns.
import type { BookingAvailability, BookingPageView } from '@crm/data';
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
  /** The week as it stands on the screen, unsaved changes included: a page that follows it shows them. */
  readonly mine: BookingAvailability;
  readonly locale: string;
  /** Opens a page's editor. */
  readonly onOpen: (pageId: string) => void;
}

/** The member's pages, each with the hours it books on: these, or its own. */
export function PagesHours({ slug, pages, status, onRetry, mine, locale, onOpen }: PagesHoursProps) {
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
  const rows: readonly LinkRow[] = pages.map((page) => {
    const follows = page.hoursMode === 'mine';
    const hours = follows ? mine : page.availability;
    return {
      id: page.id,
      title: page.title,
      address: `/${slug}/${page.slug}`,
      description: weekSummary(hours, locale).join(' · '),
      // The zone only where it isn't the one beside the week (a page with hours of its own, kept in another zone).
      chips: [
        follows ? strings.followsYou : strings.ownHours,
        ...(hours.timeZone === mine.timeZone
          ? []
          : [`${zoneLabel(hours.timeZone)} ${zoneOffset(hours.timeZone, now)}`]),
      ],
      ...(page.status === 'paused' ? { badge: strings.offTag } : page.isPrivate ? { badge: strings.private } : {}),
      isOff: page.status === 'paused',
    };
  });
  return (
    <Card title={strings.yourPages} description={strings.yourPagesText}>
      <LinkList
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
