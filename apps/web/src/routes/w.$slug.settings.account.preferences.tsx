import { createFileRoute } from '@tanstack/react-router';
import { PreferencesScreen } from '../features/settings/PreferencesScreen.tsx';
import { CustomiseSidebarButton } from '../features/workspace/CustomiseSidebarButton.tsx';
import { useWorkspaceObjects } from '../features/workspace/WorkspacePage.tsx';

// Settings › Account › Preferences (spec 0026): the interface theme, kept in this browser (the theme controller in
// router context holds the choice), and the way into Customise sidebar (spec 0034; every setting lives in Settings),
// over the sidebar the workspace route already loaded.
export const Route = createFileRoute('/w/$slug/settings/account/preferences')({
  component: PreferencesRoute,
});

function PreferencesRoute() {
  const { theme, data } = Route.useRouteContext();
  const { slug } = Route.useParams();
  const objects = useWorkspaceObjects();
  return (
    <PreferencesScreen
      theme={theme}
      customiseSidebar={<CustomiseSidebarButton data={data} slug={slug} objects={objects} />}
    />
  );
}
