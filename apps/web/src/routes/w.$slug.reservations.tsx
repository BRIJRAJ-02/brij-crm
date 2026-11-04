import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';

// Reservations, Table seating's page (spec 0065, AC-6510): shown only while Table seating is installed.
export const Route = createFileRoute('/w/$slug/reservations')({
  loader: async ({ context, params }) => ({
    isInstalled: await isPageInstalled(context.data, params.slug, 'reservations'),
  }),
  pendingComponent: () => <WorkspacePage currentPage="reservations" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ComingScreen slug={slug} page="reservations" isInstalled={isInstalled} />;
}
