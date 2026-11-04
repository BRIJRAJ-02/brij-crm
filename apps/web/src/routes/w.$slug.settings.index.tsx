import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';

// Settings opens on its first entry, Account › Profile (5 November 2026; it opened on Preferences before). On a phone
// (under 480px) this address is the list of every setting instead: the frame shows the settings sidebar alone, the
// whole width (AppShell's `phoneSidebar="full"`), and each entry pushes into its page, whose TopBar chevron comes back.

/** A phone, as AppShell measures it (`bp-container-md`). */
const PHONE = '(width < 480px)';
const isPhoneNow = () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches;
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

export const Route = createFileRoute('/w/$slug/settings/')({
  beforeLoad: ({ params }) => {
    if (isPhoneNow()) return;
    throw redirect({ to: '/w/$slug/settings/account/profile', params: { slug: params.slug }, replace: true });
  },
  component: SettingsHome,
});

/** The phone's list is the frame's sidebar; the page itself is empty, and grows into Profile if the window widens. */
function SettingsHome() {
  const { slug } = Route.useParams();
  const isPhone = useSyncExternalStore(subscribe, isPhoneNow, () => false);
  if (!isPhone) return <Navigate to="/w/$slug/settings/account/profile" params={{ slug }} replace />;
  return null;
}
