import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { backHref, safeSessionStorage } from '../features/settings/back.ts';
import { settingsPageOf } from '../features/settings/nav.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Settings (spec 0026): the settings sidebar in place of the app's, beside
// the settings page's own route. The frame stays mounted while the person
// moves between settings pages, so the sidebar keeps its place and focus; a
// page's own SettingsPage draws only its body inside it.
export const Route = createFileRoute('/w/$slug/settings')({
  component: SettingsRoute,
  // An address in Settings that names no page stays in Settings, its sidebar and the way back with it.
  notFoundComponent: SettingsNotFound,
});

function SettingsRoute() {
  return <SettingsFrame body={<Outlet />} />;
}

function SettingsNotFound() {
  return <SettingsFrame body={<SettingsMissing backTo="home" />} />;
}

/** The settings sidebar beside `body`. */
function SettingsFrame({ body }: { readonly body: ReactNode }) {
  const { slug } = Route.useParams();
  const current = useLocation({ select: (location) => settingsPageOf(location.pathname) });
  // The page Settings was opened from (main.tsx remembers it), else the workspace's home.
  const back = backHref(safeSessionStorage(window), slug);
  return (
    <WorkspacePage
      settings={{ backHref: back, ...(current === undefined ? {} : { current }) }}
      page={{ topBar: undefined, body }}
    />
  );
}
