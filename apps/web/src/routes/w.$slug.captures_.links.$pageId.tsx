import { isDataError } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import { EmptyState, Link, PageColumn, TopBar, LoadingNow } from '@crm/ui';
import { createFileRoute, useParams, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { memberZone } from '../features/booking/zone.ts';
import { linksHref, pageTabOf, type PageTab } from '../features/booking/links.ts';
import { CalendarNote, readDismissed } from '../features/booking/CalendarNote.tsx';
import { PageEditor, PageEditorPending as TabsPending } from '../features/booking/PageEditor.tsx';
import { readRecordFields } from '../features/routing/record-fields.ts';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One booking page's editor (spec 0025, AC-623, AC-624), its tab in `?tab=`: the page read through the data layer; one that was
// deleted or isn't the reader's answers NOT_FOUND, said in the page with the way back. It sits outside the
// Captures layout (`captures_`), as a form's editor does: it needs the whole width and its own TopBar. The owner's
// schedules load too (spec 0035, AC-965) when the reader may read them (their own page, or any with `booking.admin`):
// the Hours card picks one and says its week. The reader's own are read beside the page, since most pages are
// theirs; a colleague's, once the page names its owner. Either way the page shows: a failed read of the schedules
// leaves the card with the hours the page books by now.
export const Route = createFileRoute('/w/$slug/captures_/links/$pageId')({
  // The tab shown (22 Oct 2026): Page unless `?tab=` names another.
  validateSearch: (search: Record<string, unknown>): { readonly tab?: PageTab } => {
    const tab = pageTabOf(search.tab);
    return tab === 'page' ? {} : { tab };
  },
  // Moving between tabs keeps the page as it is: the loader runs on arriving, not on each tab.
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ context, params }) => {
    try {
      const [page, mine, targets, objects] = await Promise.all([
        context.data.bookingPages.get(params.slug, params.pageId),
        context.data.access.mine(params.slug),
        // Where its questions' answers may be filed (spec 0057): the page's object and its attributes, beside the page rather
        // than after it; a failed read (a page the reader can't change) leaves none.
        context.data.bookingPages.attributes(params.slug, params.pageId).catch(() => undefined),
        // The objects the Questions tab's "Where the answers go" picker offers; a failed read leaves it out.
        context.data.objects.list(params.slug).catch(() => []),
        // The reader's calendars, primed so the editor's calendar note is in its first paint; a failed read just
        // leaves the note out.
        context.data.calendar
          .view(params.slug)
          .ready()
          .catch(() => undefined),
        context.data.schedules
          .view(params.slug, undefined, memberZone(context.data, params.slug))
          .ready()
          .catch(() => undefined),
      ]);
      const isMine = page.ownerMemberId === mine.memberId;
      const ownerMember = isMine ? undefined : page.ownerMemberId;
      const mayRead = isMine || mine.permissions.includes('booking.admin');
      if (mayRead && !isMine) {
        await context.data.schedules
          .view(params.slug, ownerMember, memberZone(context.data, params.slug))
          .ready()
          .catch(() => undefined);
      }
      // A round robin page's Hosts card: the members it can seat, and the rotations it can book from.
      const people =
        page.kind === 'round_robin'
          ? (await Promise.all([context.data.members.list(params.slug), context.data.rotations.held(params.slug)]))[0]
          : undefined;
      // Its Routing card (spec 0043): the person's and company's fields rules may read; a failed read leaves none.
      const fields =
        page.kind === 'round_robin' && page.canChange
          ? await readRecordFields(context.data, params.slug).catch(() => undefined)
          : undefined;
      return { page, mayRead, ownerMember, people, fields, targets, objects };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        return {
          page: undefined,
          mayRead: false,
          ownerMember: undefined,
          people: undefined,
          fields: undefined,
          targets: undefined,
          objects: [],
        };
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
  const { tab = 'page' } = Route.useSearch();
  const { data } = Route.useRouteContext();
  const calendar = useCalendar(data.calendar.view(slug));
  const hasNote = calendar.status === 'ready' && calendar.connections.length === 0 && !readDismissed(slug);
  return (
    <TabsPending
      tab={tab}
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
  const { page, mayRead, ownerMember, people, fields, targets, objects } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { tab = 'page' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, toasts } = Route.useRouteContext();
  if (page === undefined) return <Missing title={strings.notFoundTitle} text={strings.notFoundText} />;
  // A page of its own per id, so its draft starts afresh.
  return (
    <PageEditor
      key={page.id}
      data={data}
      slug={slug}
      page={page}
      locale={navigator.languages[0] ?? 'en-US'}
      {...(mayRead ? { schedules: data.schedules.view(slug, ownerMember, memberZone(data, slug)) } : {})}
      {...(ownerMember === undefined ? {} : { ownerMember })}
      {...(people === undefined ? {} : { people })}
      {...(fields === undefined ? {} : { recordFields: fields })}
      {...(targets === undefined ? {} : { targets })}
      objects={objects}
      onNotice={(message) => toasts.toast({ tone: 'success', message })}
      tab={tab}
      // A tab change replaces the entry: Back leaves the editor rather than stepping through its tabs.
      onTabChange={(next) => void navigate({ search: next === 'page' ? {} : { tab: next }, replace: true })}
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
