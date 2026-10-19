import { TopBar } from '@crm/ui';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { CapturesTabs } from '../features/captures/CapturesTabs.tsx';
import { strings } from '../features/captures/strings.ts';
import { captureTabOf } from '../features/captures/tabs.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Captures, after Bookings in the sidebar, as Timefix's rail has it: the
// booking links and the forms, one tab each (Links · Forms). This is the
// layout: the frame, the TopBar and the tab strip, with the tab's own route
// (`captures.links`, `captures.forms`) drawn in the chosen panel. Bare
// `/captures` goes to Links (`captures.index`).
export const Route = createFileRoute('/w/$slug/captures')({
  component: CapturesRoute,
});

function CapturesRoute() {
  const { slug } = Route.useParams();
  const tab = useLocation({ select: (location) => captureTabOf(location.pathname) });
  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: <TopBar title={strings.title} icon="link" />,
        body: (
          <CapturesTabs slug={slug} tab={tab}>
            <Outlet />
          </CapturesTabs>
        ),
      }}
    />
  );
}
