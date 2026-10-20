import { isDataError } from '@crm/data';
import { EmptyState, Link, PageColumn, TopBar } from '@crm/ui';
import { createFileRoute, useParams, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { linksHref } from '../features/booking/links.ts';
import { PageEditor, PageEditorPending } from '../features/booking/PageEditor.tsx';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One booking page's editor (spec 0025, AC-623, AC-624): the page read through the data layer; one that was
// deleted or isn't the reader's answers NOT_FOUND, said in the page with the way back. It sits outside the
// Captures layout (`captures_`), as a form's editor does: it needs the whole width and its own TopBar. On the reader's own page
// their hours load too, so "Follow my hours" shows the week it follows.
export const Route = createFileRoute('/w/$slug/captures_/links/$pageId')({
  loader: async ({ context, params }) => {
    try {
      const [page, mine] = await Promise.all([
        context.data.bookingPages.get(params.slug, params.pageId),
        context.data.access.mine(params.slug),
      ]);
      const myHours =
        page.ownerMemberId === mine.memberId
          ? (await context.data.bookings.hours(params.slug, page.availability.timeZone)).availability
          : undefined;
      return { page, myHours };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined, myHours: undefined };
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
      currentPage="captures"
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
  const { page, myHours } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (page === undefined) return <Missing title={strings.notFoundTitle} text={strings.notFoundText} />;
  // A page of its own per id, so its draft starts afresh.
  return (
    <PageEditor
      key={page.id}
      data={data}
      slug={slug}
      page={page}
      locale={navigator.languages[0] ?? 'en-US'}
      {...(myHours === undefined ? {} : { myHours })}
    />
  );
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
