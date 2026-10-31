import { createFileRoute, redirect } from '@tanstack/react-router';

// A list's settings opens on General (spec 0048, AC-4829).
export const Route = createFileRoute('/w/$slug/settings/lists/$list/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/settings/lists/$list/$tab',
      params: { slug: params.slug, list: params.list, tab: 'general' },
      replace: true,
    });
  },
});
