import { isDataError } from '@crm/data';
import { EmptyState, PageColumn } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinksPending, LinksScreen } from '../features/booking/LinksScreen.tsx';
import { strings } from '../features/booking/strings.ts';

// Captures › Links (spec 0025): the member's booking pages, everyone's with `booking.admin`, read through the data
// layer. The Captures layout draws the frame, the TopBar and the Links · Forms strip; this route fills Links.
export const Route = createFileRoute('/w/$slug/captures/links/')({
  loader: async ({ context, params }) => {
    try {
      return { pages: await context.data.bookingPages.list(params.slug) };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { pages: [] };
      throw error;
    }
  },
  pendingComponent: LinksPending,
  errorComponent: LinksError,
  component: LinksRoute,
});

function LinksRoute() {
  const { pages } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return <LinksScreen data={data} slug={slug} pages={pages} />;
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
