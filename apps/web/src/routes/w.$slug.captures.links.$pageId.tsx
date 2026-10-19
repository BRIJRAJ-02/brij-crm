import { isDataError } from '@crm/data';
import { EmptyState, Link, PageColumn, TopBar } from '@crm/ui';
import { createFileRoute, useParams, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { linksHref } from '../features/booking/links.ts';
import { PageEditor, PageEditorPending } from '../features/booking/PageEditor.tsx';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One booking page's editor (spec 0025, AC-623, AC-624): the page read through the data layer; one that was
// deleted or isn't the reader's answers NOT_FOUND, said in the page with the way back.
export const Route = createFileRoute('/w/$slug/captures/links/$pageId')({
  loader: async ({ context, params }) => {
    try {
      return { page: await context.data.bookingPages.get(params.slug, params.pageId) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: PageEditorPending,
  errorComponent: EditorError,
  component: EditorRoute,
});

/** Not found or failed, inside the frame, with the way back to Links. */
function Missing({
  title,
  text,
  onRetry,
}: {
  readonly title: string;
  readonly text: string;
  readonly onRetry?: () => void;
}) {
  const { slug = '' } = useParams({ strict: false });
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar
            title={strings.listLabel}
            icon="link"
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
          />
        ),
        body: (
          <PageColumn>
            <EmptyState
              tone={onRetry === undefined ? 'empty' : 'error'}
              title={title}
              {...(onRetry === undefined ? {} : { onRetry })}
              actions={<Link href={linksHref(slug)}>{strings.linksTitle}</Link>}
            >
              {text}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}

function EditorRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (page === undefined) return <Missing title={strings.notFoundTitle} text={strings.notFoundText} />;
  // A page of its own per id, so its draft starts afresh.
  return <PageEditor key={page.id} data={data} slug={slug} page={page} />;
}

function EditorError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Missing
      title={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
