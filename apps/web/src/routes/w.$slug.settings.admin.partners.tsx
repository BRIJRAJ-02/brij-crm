import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { navStrings as strings } from '../features/admin/nav-strings.ts';
import { PartnersPending, PartnersScreen } from '../features/partners/PartnersScreen.tsx';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';

// Settings › Super admin › Partners (spec 0070, AC-7010): the partner registry. The screen reads the list itself, so
// a refusal (not a super admin, two factor missing, an old sign in) shows in place with its way on, as the console's
// other pages do; the server checks every call.
export const Route = createFileRoute('/w/$slug/settings/admin/partners')({
  pendingComponent: () => (
    <LoadingNow>
      <PartnersPending title={strings.partners} />
    </LoadingNow>
  ),
  errorComponent: ConsoleError,
  component: PartnersRoute,
});

function PartnersRoute() {
  const { data, toasts } = Route.useRouteContext();
  return <PartnersScreen data={data} toasts={toasts} title={strings.partners} />;
}

/** Anything unexpected while drawing the page: the frame stays, with Retry. */
function ConsoleError() {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.partners}
      heading={strings.failedTitle}
      text={strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
