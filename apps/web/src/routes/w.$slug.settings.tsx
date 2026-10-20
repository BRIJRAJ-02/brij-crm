import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { backHref, safeSessionStorage } from '../features/settings/back.ts';
import { settingsPageOf } from '../features/settings/nav.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Settings (spec 0026): the settings sidebar in place of the app's, beside
// the settings page's own route. The frame stays mounted while the person
// moves between settings pages, so the sidebar keeps its place and focus; a
// page's own SettingsPage draws only its body inside it.
export const Route = createFileRoute('/w/$slug/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { slug } = Route.useParams();
  const current = useLocation({ select: (location) => settingsPageOf(location.pathname) });
  // The page Settings was opened from (main.tsx remembers it), else the workspace's home.
  const back = backHref(safeSessionStorage(window), slug);
  return (
    <WorkspacePage
      settings={{ backHref: back, ...(current === undefined ? {} : { current }) }}
      page={{ topBar: undefined, body: <Outlet /> }}
    />
  );
}
