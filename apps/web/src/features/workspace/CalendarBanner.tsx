// Brief
// Purpose: tell a member at once, on every page, that their calendar stopped syncing (spec 0024, AC-619, AC-620).
// Main task: Reconnect, through the stopped calendar's own provider (Google or Microsoft) and back to Calendars; where
// that can't work here, Open calendars, where it can be removed. Always one action, never none.
// Leaves out: anyone else's calendars, the reason in detail (Calendars shows the last error), dismissing it.
import { needsReconnect, type DataLayer } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import { Button, ButtonLink, Callout } from '@crm/ui';
import { calendarsHref } from '../booking/links.ts';
import { useEffect } from 'react';
import { strings } from './calendar-banner-strings.ts';

/** The least time between two reads when the tab comes back into view. */
const RELOAD_MS = 60_000;

/** Props for CalendarBanner. */
export interface CalendarBannerProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/**
 * The disconnected calendar banner: shown while one of the member's own
 * connections is expired, revoked or failed, until they reconnect it or
 * remove it. The list is read when the frame mounts and again whenever the
 * tab comes back into view, since a connection's state changes in the worker
 * with no event of its own.
 */
export function CalendarBanner({ data, slug }: CalendarBannerProps) {
  const view = data.calendar.view(slug);
  const state = useCalendar(view);
  useEffect(() => {
    // At most once a minute: switching tabs back and forth reads it once.
    let readAt = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - readAt < RELOAD_MS) return;
      readAt = Date.now();
      view.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [view]);
  if (state.status !== 'ready') return null;
  const stopped = state.connections.find(needsReconnect);
  if (stopped === undefined) return null;
  const provider = stopped.provider === 'google' ? strings.google : strings.outlook;
  // Reconnect only where it can work: sync on here, and this calendar's provider offered (Outlook can be off).
  const canReconnect = state.enabled && state.providers.includes(stopped.provider);
  return (
    <Callout
      tone="warning"
      placement="banner"
      isAnnounced
      actions={
        canReconnect ? (
          <Button
            variant="ghost"
            onPress={() => {
              window.location.assign(data.calendar.connectUrl(slug, 'settings', stopped.provider));
            }}
          >
            {strings.reconnect}
          </Button>
        ) : (
          <ButtonLink variant="ghost" href={calendarsHref(slug)}>
            {strings.openCalendars}
          </ButtonLink>
        )
      }
    >
      {strings.stopped(provider)}
    </Callout>
  );
}
