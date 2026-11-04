import { isDataError, type HospitalityStore } from '@crm/data';
import { Button, EmptyState } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { qrLookOf, qrPrintSearch, type QrLook } from '../features/menu-qr/look.ts';
import { QrPrintScreen } from '../features/menu-qr/QrPrintScreen.tsx';
import { strings } from '../features/menu-qr/strings.ts';

/** What the sheet opens on. */
interface PrintData {
  readonly store?: HospitalityStore;
  readonly placeId?: string;
  readonly venue: string;
  readonly look: QrLook;
}

// Menu QR's print sheet (spec 0065, H2): outside the app frame (as a form's preview is), so only the sheets print.
// Shown only while Menu QR is installed; the place comes from `?place=`, else the first.
export const Route = createFileRoute('/w/$slug/qr_/print')({
  validateSearch: qrPrintSearch,
  loaderDeps: ({ search }) => ({ place: search.place }),
  loader: async ({ context, params, deps }): Promise<PrintData> => {
    if (!(await isPageInstalled(context.data, params.slug, 'qr'))) return { venue: '', look: {} };
    const [look, store] = await Promise.all([qrLookOf(context.data, params.slug), context.data.hospitality.load()]);
    const business = await store.readBusiness(params.slug);
    const place = business.places.find((each) => each.id === deps.place) ?? business.places[0];
    if (place === undefined) return { venue: '', look };
    await store.readQrCodes(params.slug, place.id);
    return { store, placeId: place.id, venue: business.profile?.name ?? place.name, look };
  },
  errorComponent: PrintError,
  component: PrintRoute,
});

function PrintRoute() {
  const { store, placeId, venue, look } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (store === undefined || placeId === undefined) {
    return (
      <main>
        <EmptyState icon="qr-code" title={strings.noTables}>
          {strings.noTablesText}
        </EmptyState>
      </main>
    );
  }
  return <QrPrintScreen slug={slug} placeId={placeId} hospitality={store} venue={venue} look={look} />;
}

function PrintError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main>
      <EmptyState
        tone="error"
        title={strings.failed}
        actions={<Button onPress={() => void router.invalidate()}>{strings.back}</Button>}
      >
        {isDataError(error) ? error.message : strings.failed}
      </EmptyState>
    </main>
  );
}
