import { createFileRoute, redirect } from '@tanstack/react-router';

// An object's settings open on its Attributes tab (spec 0012, screens).
export const Route = createFileRoute('/w/$slug/settings/objects/$object/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/settings/objects/$object/$tab',
      params: { slug: params.slug, object: params.object, tab: 'attributes' },
      replace: true,
    });
  },
});
