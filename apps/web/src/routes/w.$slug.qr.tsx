import { createFileRoute } from '@tanstack/react-router';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';

// QR codes, the Menu QR app's page (spec 0065, AC-6510): shown only while Menu QR is installed, else not found.
export const Route = createFileRoute('/w/$slug/qr')({
  loader: async ({ context, params }) => ({ isInstalled: await isPageInstalled(context.data, params.slug, 'qr') }),
  pendingComponent: () => <WorkspacePage currentPage="qr" page={pendingPage()} />,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ComingScreen slug={slug} page="qr" isInstalled={isInstalled} />;
}
