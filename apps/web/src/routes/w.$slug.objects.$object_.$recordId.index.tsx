import { createFileRoute, redirect } from '@tanstack/react-router';

// A record's address with no tab (spec 0017, AC-372) opens its Overview.
export const Route = createFileRoute('/w/$slug/objects/$object_/$recordId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug: params.slug, object: params.object, recordId: params.recordId, tab: 'overview' },
      replace: true,
    });
  },
});
