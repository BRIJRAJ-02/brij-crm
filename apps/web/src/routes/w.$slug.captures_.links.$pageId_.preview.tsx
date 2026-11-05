import { isDataError } from '@crm/data';
import { Callout, EmptyState, PreviewFrame } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { publishStrings } from '../features/booking/publish-strings.ts';

// A booking page's draft as a guest would see it (spec 0068, AC-6811), opened from Preview in the editor's publish
// bar into a new tab. Signed in only: the page is read through the data layer as its editor reads it, and the draft
// reaches the guest page in the frame by a message from this tab alone (the page takes it only from its own origin's
// parent), so a guest at /b/<key> only ever sees what is published. Outside the app frame, at the page's own size.
export const Route = createFileRoute('/w/$slug/captures_/links/$pageId_/preview')({
  loader: async ({ context, params }) => {
    try {
      return { page: await context.data.bookingPages.get(params.slug, params.pageId) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  component: PreviewRoute,
});

function PreviewRoute() {
  const { page } = Route.useLoaderData();
  if (page === undefined || !page.canChange) {
    return (
      <EmptyState layout="block" title={publishStrings.previewMissingTitle}>
        {publishStrings.previewMissing}
      </EmptyState>
    );
  }
  return (
    <main>
      <Callout placement="banner" tone="info">
        {publishStrings.previewBanner}
      </Callout>
      <PreviewFrame
        src={`/b/${page.publicKey}`}
        title={page.title}
        version={page.updatedAt}
        size="page"
        // The saved draft over the published page: what Publish would put live.
        draft={{
          title: page.title,
          description: page.description,
          durations: page.durations,
          location: page.location,
          defaultView: page.defaultView,
        }}
      />
    </main>
  );
}
