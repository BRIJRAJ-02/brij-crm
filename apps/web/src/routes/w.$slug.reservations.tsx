import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { ReservationsScreen } from '../features/tables/ReservationsScreen.tsx';

// Reservations, Table seating's setup (spec 0066 B7 lite): shown only while Table seating is installed. The loader
// opens both stores, so the screen holds the business and the place's setup with nothing more to load.
export const Route = createFileRoute('/w/$slug/reservations')({
  loader: async ({ context, params }) => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'reservations');
    const [hospitality, tables] = await Promise.all([context.data.hospitality.load(), context.data.tables.load()]);
    return { isInstalled, hospitality, tables };
  },
  pendingComponent: () => <WorkspacePage currentPage="reservations" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, hospitality, tables } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled) return <ComingScreen slug={slug} page="reservations" isInstalled={false} />;
  return <ReservationsScreen slug={slug} tables={tables} hospitality={hospitality} toasts={toasts} />;
}
