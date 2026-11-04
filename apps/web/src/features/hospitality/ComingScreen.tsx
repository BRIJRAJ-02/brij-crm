// Brief
// Purpose: an installed Hospitality app's own page until the app itself arrives (spec 0065, AC-6510): Menus, QR
// codes, Reservations and Service each say they are on their way.
// Main task: point the person at what they can do now, the places and tables in Settings › Business.
// Leaves out: the apps themselves (H1 to H4). A page whose app isn't installed is not found, never shown locked.
import { ButtonLink, EmptyState, TopBar } from '@crm/ui';
import { businessSettingsHref } from '../settings/nav.ts';
import { missingPage } from '../workspace/ObjectScreen.tsx';
import { strings as workspace } from '../workspace/strings.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import type { HospitalityPage } from './pages.ts';
import { strings } from './strings.ts';

const TITLES: Readonly<Record<HospitalityPage, string>> = {
  menus: workspace.menus,
  qr: workspace.qrCodes,
  reservations: workspace.reservations,
  service: workspace.service,
};

const ICONS = { menus: 'utensils', qr: 'qr-code', reservations: 'calendar-check', service: 'table' } as const;

/** The page: its title in the bar, and the app's "on its way" with the way to Business. */
export function ComingScreen({
  slug,
  page,
  isInstalled,
}: {
  readonly slug: string;
  readonly page: HospitalityPage;
  readonly isInstalled: boolean;
}) {
  // Only those who set the apps up get the way to Business; floor staff see the page alone.
  const canSetUp = useCan('hospitality.manage');
  if (!isInstalled) {
    return <WorkspacePage page={missingPage(TITLES[page], strings.notInstalled)} />;
  }
  return (
    <WorkspacePage
      currentPage={page}
      page={{
        topBar: <TopBar title={TITLES[page]} />,
        body: (
          <EmptyState
            icon={ICONS[page]}
            title={strings.comingTitle[page]}
            {...(canSetUp
              ? {
                  actions: (
                    <ButtonLink href={businessSettingsHref(slug)} variant="primary" icon="store">
                      {strings.openBusiness}
                    </ButtonLink>
                  ),
                }
              : {})}
          >
            {canSetUp ? strings.comingText : undefined}
          </EmptyState>
        ),
      }}
    />
  );
}
