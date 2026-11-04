import { AppShellContext } from '@crm/ui';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useContext } from 'react';

// Settings' own address (5 November 2026), where the sidebar's Settings, the workspace menu and ⌘, go. On a phone it
// is the list of every setting: the frame shows the settings sidebar alone, the whole width (AppShell's
// `phoneSidebar="full"`), and each entry pushes into its page, whose TopBar chevron comes back. On a wider screen it
// opens the first entry, Account › Profile (it opened on Preferences before). The shell measures the phone, so the
// breakpoint is the design system's, never a number here.
export const Route = createFileRoute('/w/$slug/settings/')({
  component: SettingsHome,
});

/** The phone's list is the frame's sidebar, so the page itself is empty; anywhere wider, Profile. */
function SettingsHome() {
  const { slug } = Route.useParams();
  const { isPhone } = useContext(AppShellContext);
  if (!isPhone) return <Navigate to="/w/$slug/settings/account/profile" params={{ slug }} replace />;
  return null;
}
