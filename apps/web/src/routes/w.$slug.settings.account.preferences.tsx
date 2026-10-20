import { createFileRoute } from '@tanstack/react-router';
import { PreferencesScreen } from '../features/settings/PreferencesScreen.tsx';

// Settings › Account › Preferences (spec 0026): the interface theme, kept in this browser. Nothing to load: the
// theme controller in router context holds the choice.
export const Route = createFileRoute('/w/$slug/settings/account/preferences')({
  component: PreferencesRoute,
});

function PreferencesRoute() {
  const { theme } = Route.useRouteContext();
  return <PreferencesScreen theme={theme} />;
}
