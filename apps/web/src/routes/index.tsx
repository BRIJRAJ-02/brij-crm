import { createFileRoute } from '@tanstack/react-router';
import { SystemStatusError, SystemStatusPending, SystemStatusScreen } from '../features/system/SystemStatusScreen.tsx';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.data.system.status(),
  pendingComponent: SystemStatusPending,
  errorComponent: SystemStatusError,
  component: IndexRoute,
});

function IndexRoute() {
  return <SystemStatusScreen status={Route.useLoaderData()} />;
}
