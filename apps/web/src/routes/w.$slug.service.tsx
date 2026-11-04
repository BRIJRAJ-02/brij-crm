import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';

// Service, Table seating's host stand (spec 0065, AC-6510): shown only while Table seating is installed.
export const Route = createFileRoute('/w/$slug/service')({
  loader: async ({ context, params }) => ({ isInstalled: await isPageInstalled(context.data, params.slug, 'service') }),
  pendingComponent: () => <WorkspacePage currentPage="service" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ComingScreen slug={slug} page="service" isInstalled={isInstalled} />;
}
