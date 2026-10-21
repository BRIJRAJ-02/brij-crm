import { createFileRoute, redirect } from '@tanstack/react-router';
import { movedHref, movedPath } from '../features/workspace/moved.ts';

// Round 7's `/forms` address (spec 0034), its own page for a day: it redirects to its place inside Captures again
// (the owner, 22 October 2026), replacing the history entry and keeping the query.
export const Route = createFileRoute('/w/$slug/forms/$')({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: movedHref(params.slug, movedPath('forms', params._splat ?? ''), location.searchStr),
      replace: true,
    });
  },
});
