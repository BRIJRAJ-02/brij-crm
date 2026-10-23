import { createFileRoute, redirect } from '@tanstack/react-router';

// The trash's old address: Settings › Workspace › Trash now (A120, 23 October 2026: the settings sidebar stays
// beside it), kept for links and bookmarks, with its object filter.
export const Route = createFileRoute('/w/$slug/trash')({
  validateSearch: (search: Record<string, unknown>): { readonly object?: string } =>
    typeof search.object === 'string' && search.object !== '' ? { object: search.object } : {},
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/w/$slug/settings/trash', params, search, replace: true });
  },
});
