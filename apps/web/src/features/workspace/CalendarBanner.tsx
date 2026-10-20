// Brief
// Purpose: tell a member at once, on every page, that their calendar stopped syncing (spec 0024, AC-619, AC-620).
// Main task: Reconnect, which goes through Google's consent and back to Settings › Calendar.
// Leaves out: anyone else's calendars, the reason in detail (Settings › Calendar shows the last error), dismissing it.
import { needsReconnect, type DataLayer } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import { Button, Callout } from '@crm/ui';
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
  return (
    <Callout
      tone="warning"
      placement="banner"
      isAnnounced
      actions={
        state.enabled ? (
          <Button
            variant="ghost"
            onPress={() => {
              window.location.assign(data.calendar.connectUrl(slug));
            }}
          >
            {strings.reconnect}
          </Button>
        ) : undefined
      }
    >
      {stopped.status === 'failed' ? strings.failed(provider) : strings.disconnected(provider)}
    </Callout>
  );
}
