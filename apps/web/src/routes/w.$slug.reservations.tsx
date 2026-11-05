import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { reservationsSearch } from '../features/tables/search.ts';
import { ReservationsScreen } from '../features/tables/ReservationsScreen.tsx';

// Reservations, Table seating's one page (spec 0066 B7 lite, after checklabs' Reservations page): the day, live, with
// Online booking in a sheet from its bar; shown only while Table seating is installed. `?date=` names the day and
// `?place=` the place, so a link (the new reservation email's) opens them. A day or place picked changes only the address (the router keeps the loader's answer, its deps unchanged).
export const Route = createFileRoute('/w/$slug/reservations')({
  validateSearch: reservationsSearch,
  loader: async ({ context, params }) => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'reservations');
    return { isInstalled, tables: await context.data.tables.load() };
  },
  pendingComponent: () => <WorkspacePage currentPage="reservations" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, tables } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  if (!isInstalled) return <ComingScreen slug={slug} page="reservations" isInstalled={false} />;
  return (
    <ReservationsScreen
      slug={slug}
      tables={tables}
      toasts={toasts}
      search={search}
      // A day picked replaces the address rather than adding to history: Back leaves the page, not the days.
      onSearch={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
