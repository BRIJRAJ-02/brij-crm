import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { CapturesTabs } from '../features/captures/CapturesTabs.tsx';
import { CapturesTopBar } from '../features/captures/CapturesTopBar.tsx';
import { CapturesCreateProvider } from '../features/captures/create.tsx';
import { captureTabOf } from '../features/captures/tabs.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Captures, after Bookings in the sidebar, as Timefix's rail has it: the
// booking links and the forms, one tab each (Links · Forms). This is the
// layout: the frame, the TopBar (the tile, the count and New, as People's)
// and the tab strip in the row People's ViewBar takes, with the tab's own
// route (`captures.links`, `captures.forms`) drawn in the chosen panel. The
// layout owns New, so it never moves or remounts as the tabs change. Bare
// `/captures` goes to Links (`captures.index`).
export const Route = createFileRoute('/w/$slug/captures')({
  component: CapturesRoute,
});

function CapturesRoute() {
  const { slug } = Route.useParams();
  const tab = useLocation({ select: (location) => captureTabOf(location.pathname) });
  return (
    <CapturesCreateProvider slug={slug} tab={tab}>
      <WorkspacePage
        currentPage="captures"
        page={{
          topBar: <CapturesTopBar slug={slug} tab={tab} />,
          body: (
            <CapturesTabs slug={slug} tab={tab}>
              <Outlet />
            </CapturesTabs>
          ),
        }}
      />
    </CapturesCreateProvider>
  );
}
