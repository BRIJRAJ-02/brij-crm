import type { InboxSettings } from '@crm/data';
import { usePreferences } from '@crm/data/react';
import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PreferencesScreen } from '../features/settings/PreferencesScreen.tsx';
import { strings } from '../features/settings/preferences-strings.ts';
import { CustomiseSidebarButton } from '../features/workspace/CustomiseSidebarButton.tsx';

// Settings › Account › Preferences (spec 0026): the interface theme, kept in this browser, the member's own time
// zone, date format, week start and start page, kept for them in this workspace, the way into Customise sidebar
// (spec 0034; every setting lives in Settings), and what reaches them (spec 0038's notification switches, folded in
// here by the simplify pass, 2 November 2026). The workspace frame read the preferences, the objects and the sidebar
// already; the page holds the one copy the data layer keeps. The notification settings are read when the page opens
// rather than in the loader, so the theme is there at once and the inbox's own chunk never holds the page up; their
// sections show their own loading rows, and a failed read says so with Try again in their place rather than failing
// the page.
export const Route = createFileRoute('/w/$slug/settings/account/preferences')({
  component: PreferencesRoute,
});

const workspace = getRouteApi('/w/$slug');

/** The notification settings as they were read, and the workspace they belong to. */
interface Read {
  readonly slug: string;
  readonly settings: InboxSettings | 'failed';
}

function PreferencesRoute() {
  const { slug } = Route.useParams();
  const { theme, data, toasts } = Route.useRouteContext();
  const { objects } = workspace.useLoaderData();
  const preferences = usePreferences(data.preferences.of(slug));
  // What was read, and for which workspace: another workspace's settings must never be shown, or written to, under
  // this slug, and the page stays mounted when the slug changes.
  const [read, setRead] = useState<Read | undefined>(undefined);
  // Moves on Try again after a failed read.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isLive = true;
    data.inbox.settings(slug).then(
      (settings) => {
        if (isLive) setRead({ slug, settings });
      },
      () => {
        if (isLive) setRead({ slug, settings: 'failed' });
      },
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, attempt]);
  const notifications = read?.slug === slug ? read.settings : undefined;
  return (
    <PreferencesScreen
      slug={slug}
      theme={theme}
      preferences={preferences}
      objects={objects ?? []}
      onChange={(change) => data.preferences.change(slug, change)}
      toasts={toasts}
      onRetry={() => void data.preferences.load(slug).catch(() => undefined)}
      isLoadingNotifications={notifications === undefined}
      {...(notifications === 'failed'
        ? {
            onRetryNotifications: () => {
              setAttempt((at) => at + 1);
            },
          }
        : {})}
      {...(notifications === undefined || notifications === 'failed' ? {} : { notifications })}
      customiseSidebar={
        <CustomiseSidebarButton data={data} slug={slug} objects={objects ?? []} text={strings.customiseAction} />
      }
    />
  );
}
