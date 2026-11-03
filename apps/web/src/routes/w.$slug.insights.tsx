import { createFileRoute, useRouteContext, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { InsightsScreen } from '../features/insights/InsightsScreen.tsx';
import { insightsSearch } from '../features/insights/search.ts';
import { strings } from '../features/insights/strings.ts';
import { failedPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Insights (spec 0067): the numbers for every public page the reader may see, filtered by `?range=`, `?kind=` and
// `?page=`. The screen holds its reads through the data layer, which reads them again when the person comes back;
// the loader starts nothing, so the page's frame shows at once and its numbers load in place.
export const Route = createFileRoute('/w/$slug/insights')({
  validateSearch: insightsSearch,
  pendingComponent: () => <WorkspacePage currentPage="insights" page={pendingPage()} />,
  errorComponent: InsightsError,
  component: InsightsRoute,
});

function InsightsRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { data } = useRouteContext({ from: '/w/$slug/insights' });
  return <InsightsScreen data={data} slug={slug} search={search} />;
}

function InsightsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="insights"
      page={failedPage(strings.insights, () => void router.invalidate(), error, strings.failedTitle)}
    />
  );
}
