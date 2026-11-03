import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';

// Menus, the Menu app's page (spec 0065, AC-6510): shown only while Menu is installed, else not found.
export const Route = createFileRoute('/w/$slug/menus')({
  loader: async ({ context, params }) => ({ isInstalled: await isPageInstalled(context.data, params.slug, 'menus') }),
  pendingComponent: () => <WorkspacePage currentPage="menus" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ComingScreen slug={slug} page="menus" isInstalled={isInstalled} />;
}
