import { createFileRoute } from '@tanstack/react-router';
import { SystemStatusError, SystemStatusPending, SystemStatusScreen } from '../features/system/SystemStatusScreen.tsx';

// The stack check, moved here from `/` (spec 0005): open to anyone.
export const Route = createFileRoute('/status')({
  loader: ({ context }) => context.data.system.status(),
  pendingComponent: SystemStatusPending,
  errorComponent: SystemStatusError,
  component: StatusRoute,
});

function StatusRoute() {
  return <SystemStatusScreen status={Route.useLoaderData()} />;
}
