import { isDataError } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import { EmptyState, Link, PageColumn, TopBar, LoadingNow } from '@crm/ui';
import { createFileRoute, useParams, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { browserZone } from '../features/booking/hours.ts';
import { linksHref } from '../features/booking/links.ts';
import { CalendarNote, readDismissed } from '../features/booking/CalendarNote.tsx';
import { PageEditor } from '../features/booking/PageEditor.tsx';
import { EditorPending } from '../features/captures/EditorPending.tsx';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One booking page's editor (spec 0025, AC-623, AC-624): the page read through the data layer; one that was
// deleted or isn't the reader's answers NOT_FOUND, said in the page with the way back. It sits outside the
// Captures layout (`captures_`), as a form's editor does: it needs the whole width and its own TopBar. The owner's
// schedules load too (spec 0035, AC-965) when the reader may read them (their own page, or any with `booking.admin`):
// the Hours card picks one and says its week. The reader's own are read beside the page, since most pages are
// theirs; a colleague's, once the page names its owner. Either way the page shows: a failed read of the schedules
// leaves the card with the hours the page books by now.
export const Route = createFileRoute('/w/$slug/captures_/links/$pageId')({
  loader: async ({ context, params }) => {
    try {
      const [page, mine] = await Promise.all([
        context.data.bookingPages.get(params.slug, params.pageId),
        context.data.access.mine(params.slug),
        // The reader's calendars, primed so the editor's calendar note is in its first paint; a failed read just
        // leaves the note out.
        context.data.calendar
          .view(params.slug)
          .ready()
          .catch(() => undefined),
        context.data.schedules
          .view(params.slug, undefined, browserZone())
          .ready()
          .catch(() => undefined),
      ]);
      const isMine = page.ownerMemberId === mine.memberId;
      const ownerMember = isMine ? undefined : page.ownerMemberId;
      const mayRead = isMine || mine.permissions.includes('booking.admin');
      if (mayRead && !isMine) {
        await context.data.schedules
          .view(params.slug, ownerMember, browserZone())
          .ready()
          .catch(() => undefined);
      }
      return { page, mayRead, ownerMember };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        return { page: undefined, mayRead: false, ownerMember: undefined };
      }
      throw error;
    }
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <PageEditorPending />
    </LoadingNow>
  ),
  errorComponent: EditorError,
  component: EditorRoute,
});

/**
 * The editor while its page loads: its cards and preview, and the calendar note when the data layer already knows
 * it will show (the route primes the reader's calendars), so the cards stand where the editor's will.
 */
function PageEditorPending() {
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const calendar = useCalendar(data.calendar.view(slug));
  const hasNote = calendar.status === 'ready' && calendar.connections.length === 0 && !readDismissed(slug);
  return (
    <EditorPending
      title={strings.listLabel}
      icon="link"
      cards={[strings.page, strings.meeting, strings.hours, strings.limits]}
      {...(hasNote ? { notices: <CalendarNote slug={slug} canConnect={calendar.enabled} /> } : {})}
    />
  );
}

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
  const { page, mayRead, ownerMember } = Route.useLoaderData();
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
      {...(mayRead ? { schedules: data.schedules.view(slug, ownerMember, browserZone()) } : {})}
      {...(ownerMember === undefined ? {} : { ownerMember })}
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
