import { isDataError } from '@crm/data';
import { EmptyState, PageColumn, LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinksPending, LinksScreen } from '../features/booking/LinksScreen.tsx';
import { strings } from '../features/booking/strings.ts';

// Captures › Links (spec 0025): the member's booking pages, everyone's with `booking.admin`, from the data layer's
// held list (`bookingPages.view`), which every page write patches, so a create, a copy, a pause or a rename in the
// editor shows here without a refresh. The loader waits for the first read only; coming back, the held rows show at
// once and are read again behind them. The Captures layout draws the frame, the TopBar and the Links · Forms strip.
export const Route = createFileRoute('/w/$slug/captures/links/')({
  loader: async ({ context, params }) => {
    try {
      await context.data.bookingPages.view(params.slug).ready();
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return;
      throw error;
    }
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <LinksPending />
    </LoadingNow>
  ),
  errorComponent: LinksError,
  component: LinksRoute,
});

function LinksRoute() {
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return <LinksScreen data={data} slug={slug} />;
}

function LinksError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
