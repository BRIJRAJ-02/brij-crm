import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { useShownBusiness } from '../features/hospitality/shown-business.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { AppOffScreen, useReachesBusinessPages } from '../features/hospitality/AppOffScreen.tsx';
import { reservationsSearch } from '../features/tables/search.ts';
import { ReservationsScreen } from '../features/tables/ReservationsScreen.tsx';

// Reservations, Table seating's one page (spec 0066 B7 lite, after checklabs' Reservations page): the day, live, with
// Online booking in a sheet from its bar; shown only while Table seating is on. `?date=` names the day and
// `?place=` the place, so a link (the new reservation email's) opens them. A day or place picked changes only the address (the router keeps the loader's answer, its deps unchanged).
export const Route = createFileRoute('/w/$slug/reservations')({
  validateSearch: reservationsSearch,
  loader: async ({ context, params }) => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'reservations');
    // The businesses come first, so the places listed are the chosen one's (spec 0065 H7); a switch reads this again.
    const hospitality = await context.data.hospitality.load();
    await hospitality.readProperties(params.slug).catch(() => undefined);
    return {
      isInstalled,
      tables: await context.data.tables.load(),
      hospitality,
      property: hospitality.current(params.slug),
    };
  },
  pendingComponent: () => <WorkspacePage currentPage="reservations" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, tables, hospitality, property: fromLoader } = Route.useLoaderData();
  // A switch remounts the page at once on the chosen business's places (spec 0065 H7).
  const property = useShownBusiness(hospitality, Route.useParams().slug, fromLoader);
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const reaches = useReachesBusinessPages();
  if (!reaches || !isInstalled) return <AppOffScreen slug={slug} page="reservations" />;
  return (
    <ReservationsScreen
      // Another business starts the page afresh (spec 0065 H7).
      key={property ?? ''}
      slug={slug}
      tables={tables}
      toasts={toasts}
      search={search}
      // A day picked replaces the address rather than adding to history: Back leaves the page, not the days.
      onSearch={(next) => void navigate({ search: next, replace: true })}
      onOtherBusiness={(other) => void hospitality.requestChoice(slug, other)}
    />
  );
}
