import { isDataError, type HospitalityStore } from '@crm/data';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { qrLookOf, type QrLook } from '../features/menu-qr/look.ts';
import { QrScreen } from '../features/menu-qr/QrScreen.tsx';
import { strings } from '../features/menu-qr/strings.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the QR codes page opens on: the store with the business read, and the brand kit the codes wear. */
interface QrData {
  readonly isInstalled: boolean;
  readonly store?: HospitalityStore;
  readonly look: QrLook;
}

// QR codes, the Menu QR app's page (spec 0065, H2): shown only while Menu QR is installed, else not found. The
// loader reads the business (its places) and the brand kit the codes wear; each place's codes are read on the page.
export const Route = createFileRoute('/w/$slug/qr')({
  loader: async ({ context, params }): Promise<QrData> => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'qr');
    if (!isInstalled) return { isInstalled, look: {} };
    const [look, store] = await Promise.all([qrLookOf(context.data, params.slug), context.data.hospitality.load()]);
    await store.readBusiness(params.slug).catch(() => undefined);
    return { isInstalled, store, look };
  },
  pendingComponent: () => <WorkspacePage currentPage="qr" page={pendingPage()} />,
  errorComponent: QrError,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, store, look } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled || store === undefined) return <ComingScreen slug={slug} page="qr" isInstalled={false} />;
  return <QrScreen slug={slug} hospitality={store} look={look} toasts={toasts} />;
}

function QrError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="qr"
      page={{
        topBar: <TopBar title={strings.title} />,
        body: (
          <EmptyState tone="error" title={strings.failed} onRetry={() => void router.invalidate()}>
            {isDataError(error) ? error.message : strings.failed}
          </EmptyState>
        ),
      }}
    />
  );
}
