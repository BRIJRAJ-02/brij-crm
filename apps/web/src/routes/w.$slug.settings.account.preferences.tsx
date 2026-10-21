import { usePreferences } from '@crm/data/react';
import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import { PreferencesScreen } from '../features/settings/PreferencesScreen.tsx';
import { CustomiseSidebarButton } from '../features/workspace/CustomiseSidebarButton.tsx';

// Settings › Account › Preferences (spec 0026): the interface theme, kept in this browser, the member's own time
// zone, date format, week start and start page, kept for them in this workspace, and the way into Customise sidebar
// (spec 0034; every setting lives in Settings). The workspace frame read the preferences, the objects and the sidebar
// already; the page holds the one copy the data layer keeps.
export const Route = createFileRoute('/w/$slug/settings/account/preferences')({
  component: PreferencesRoute,
});

const workspace = getRouteApi('/w/$slug');

function PreferencesRoute() {
  const { slug } = Route.useParams();
  const { theme, data, toasts } = Route.useRouteContext();
  const { objects } = workspace.useLoaderData();
  const preferences = usePreferences(data.preferences.of(slug));
  return (
    <PreferencesScreen
      theme={theme}
      preferences={preferences}
      objects={objects ?? []}
      onChange={(change) => data.preferences.change(slug, change)}
      toasts={toasts}
      customiseSidebar={<CustomiseSidebarButton data={data} slug={slug} objects={objects ?? []} />}
    />
  );
}
