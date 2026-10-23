import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { HistoryPending, HistoryScreen } from '../features/settings/HistoryScreen.tsx';
import { SignInsPending, SignInsTab } from '../features/settings/SignInsTab.tsx';

// Settings › History › Your sign ins (spec 0046, AC-4619): every member's own sign ins, the list Account › Sign in
// and devices shows, started here as that route starts it and never waited for (its section shows its own loading
// rows, and a failed read shows there with a retry). The access says whether the page has tabs.
export const Route = createFileRoute('/w/$slug/settings/history/sign-ins')({
  loader: async ({ context, params }) => {
    const activity = context.data.account.activity().catch(() => undefined);
    const access = await context.data.access.mine(params.slug).catch(() => undefined);
    return { activity, canReadChanges: access?.permissions.includes('audit.read') === true };
  },
  pendingComponent: () => (
    <LoadingNow>
      <HistoryPending tab="sign-ins" body={<SignInsPending />} />
    </LoadingNow>
  ),
  component: SignInsRoute,
});

function SignInsRoute() {
  const { data } = Route.useRouteContext();
  const { activity, canReadChanges } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const router = useRouter();
  return (
    <HistoryScreen slug={slug} tab="sign-ins" canReadChanges={canReadChanges}>
      <SignInsTab
        data={data}
        first={activity}
        onRetry={() => void router.invalidate({ filter: (match) => match.routeId === Route.id })}
      />
    </HistoryScreen>
  );
}
