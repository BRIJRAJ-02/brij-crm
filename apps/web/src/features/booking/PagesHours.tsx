// Brief
// Purpose: Bookings › Availability's list of the member's own pages with the hours each books on, as timefix shows them.
// Main task: see at a glance which pages follow these hours and which keep their own, and open one to change it.
// Leaves out: changing a page's hours here (its editor does), and pages someone else owns.
import type { BookingAvailability, BookingPageView } from '@crm/data';
import { Card, LinkList, type LinkRow } from '@crm/ui';
import { weekSummary } from './hours.ts';
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
  if (status === 'ready' && pages.length === 0) return null;
  const rows: readonly LinkRow[] = pages.map((page) => {
    const follows = page.hoursMode === 'mine';
    const hours = follows ? mine : page.availability;
    return {
      id: page.id,
      title: page.title,
      address: `/${slug}/${page.slug}`,
      description: weekSummary(hours, locale).join(' · '),
      chips: [follows ? strings.followsYou : strings.ownHours, hours.timeZone.replaceAll('_', ' ')],
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
