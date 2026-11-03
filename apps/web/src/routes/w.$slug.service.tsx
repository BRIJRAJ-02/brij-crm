import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { ServiceScreen } from '../features/tables/ServiceScreen.tsx';

// Service, Table seating's host stand (spec 0066 B7 lite): shown only while Table seating is installed.
export const Route = createFileRoute('/w/$slug/service')({
  loader: async ({ context, params }) => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'service');
    const [hospitality, tables] = await Promise.all([context.data.hospitality.load(), context.data.tables.load()]);
    return { isInstalled, hospitality, tables };
  },
  pendingComponent: () => <WorkspacePage currentPage="service" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, hospitality, tables } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled) return <ComingScreen slug={slug} page="service" isInstalled={false} />;
  return <ServiceScreen slug={slug} tables={tables} hospitality={hospitality} toasts={toasts} />;
}
