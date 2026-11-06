// Brief
// Purpose: a business page whose app an owner or admin switched off (spec 0065, AC-6510), or one this reader's role
// doesn't reach, which is simply not there.
// Main task: say the app is off and, for those who may, open Settings › Apps to turn it on.
// Leaves out: switching it here (Apps owns the switch and what it needs).
import { ButtonLink, EmptyState, TopBar } from '@crm/ui';
import { appsSettingsHref } from '../settings/nav.ts';
import { missingPage } from '../workspace/ObjectScreen.tsx';
import { strings as workspace } from '../workspace/strings.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import type { HospitalityPage } from './pages.ts';
import { strings } from './strings.ts';

const TITLES: Readonly<Record<HospitalityPage, string>> = {
  menus: workspace.menus,
  qr: workspace.qrCodes,
  reservations: workspace.reservations,
};

/** The app each page belongs to, by the name its card in Apps has. */
const APP_NAMES: Readonly<Record<HospitalityPage, string>> = {
  menus: strings.appNames.menu,
  qr: strings.appNames.menu_qr,
  reservations: strings.appNames.table_seating,
};

const ICONS = { menus: 'utensils', qr: 'qr-code', reservations: 'calendar-check' } as const;

/** Whether the reader's role reaches the business pages at all: Manage hospitality or Run service. */
export function useReachesBusinessPages(): boolean {
  const canManage = useCan('hospitality.manage');
  const canServe = useCan('hospitality.service');
  return canManage || canServe;
}

/** The page: its title in the bar and "off" with the way to Apps; for a role it doesn't reach, not found. */
export function AppOffScreen({ slug, page }: { readonly slug: string; readonly page: HospitalityPage }) {
  const reaches = useReachesBusinessPages();
  const canSwitch = useCan('workspace.manage');
  if (!reaches) return <WorkspacePage page={missingPage(TITLES[page], strings.pageMissing)} />;
  return (
    <WorkspacePage
      currentPage={page}
      page={{
        topBar: <TopBar title={TITLES[page]} />,
        body: (
          <EmptyState
            layout="block"
            icon={ICONS[page]}
            title={strings.appIsOff(APP_NAMES[page])}
            {...(canSwitch
              ? {
                  actions: (
                    <ButtonLink href={appsSettingsHref(slug)} variant="primary" icon="blocks">
                      {strings.openApps}
                    </ButtonLink>
                  ),
                }
              : {})}
          >
            {canSwitch ? strings.appIsOffText : strings.appIsOffAsk}
          </EmptyState>
        ),
      }}
    />
  );
}
