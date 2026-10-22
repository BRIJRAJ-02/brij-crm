import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Rotations address: Round robin now (the owner, 22 October 2026), kept for links.
export const Route = createFileRoute('/w/$slug/settings/scheduling/rotations')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/scheduling/round-robin', params, replace: true });
  },
});
