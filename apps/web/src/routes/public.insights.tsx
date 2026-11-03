import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import {
  SharedInsightsError,
  SharedInsightsPending,
  SharedInsightsScreen,
} from '../features/insights/SharedInsightsScreen.tsx';

// An Insights share link (spec 0067, AC-6720): no session, only the link's token, carried in the fragment (`#t=`)
// so no request, log or Referer holds it. The data layer sends it to the API in a header. A link that opens
// nothing (revoked, expired, wrong) says so, the same for each.
export const Route = createFileRoute('/public/insights')({
  loader: async ({ context, location }) => {
    const token = new URLSearchParams(location.hash).get('t') ?? '';
    return { shared: await context.data.insights.shared(token) };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SharedInsightsPending />
    </LoadingNow>
  ),
  errorComponent: ({ error }) => <SharedInsightsError error={isDataError(error) ? error : undefined} />,
  component: SharedInsightsRoute,
});

function SharedInsightsRoute() {
  const { shared } = Route.useLoaderData();
  return <SharedInsightsScreen shared={shared} />;
}
