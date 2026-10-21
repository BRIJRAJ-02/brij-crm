import { createFileRoute, redirect } from '@tanstack/react-router';
import { capturesPath, movedHref } from '../features/workspace/moved.ts';

// Captures became Scheduling's Booking pages and Forms (spec 0034, AC-929): every old `/captures` address, the
// bare one included, redirects to its new page, replacing the history entry and keeping the query. One route for
// them all keeps the first load small.
export const Route = createFileRoute('/w/$slug/captures/$')({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: movedHref(params.slug, capturesPath(params._splat ?? ''), location.searchStr),
      replace: true,
    });
  },
});
