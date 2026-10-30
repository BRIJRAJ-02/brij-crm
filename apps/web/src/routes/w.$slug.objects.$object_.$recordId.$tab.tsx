import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import {
  isLogParam,
  isNoteParam,
  isRecordId,
  isRecordTab,
  isTaskParam,
  isThreadParam,
} from '../features/records/params.ts';
import { RecordPage, RecordPendingPage } from '../features/records/RecordPage.tsx';
import { failedPage, missingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// A record's page (spec 0017): `/w/$slug/objects/$object/$recordId/$tab`,
// the object by its address and the tab Overview or Activity (anything else
// goes to Overview). The trailing underscore keeps it out of the table's
// layout. The loader warms the record (the attributes Details lists, through
// `records.one`) and its timeline's first page, waiting at most OPEN_GRACE_MS
// for them, and hands the screen subscriptions, never rows. The screen loads
// with this route's component, outside the first load. Spec 0019 adds the
// Tasks tab and `?task=<id>` (or `new`), the task dialog over any tab; the
// loader starts the record's open tasks (the tab's count and Overview's block)
// and reads the person's member id (a new task is theirs). Spec 0017
// milestone 3 starts each side that holds many as a section source (the
// sidebar's section and Overview's card share it), never waiting for them.
/**
 * `?task=<id>` or `?task=new`: the task dialog; `?note=<id>` or `?note=new`: the note window; `?log=<id>`, `?log=new`,
 * `?log=call` or `?log=meeting`: the Log activity dialog. Anything else is dropped.
 */
interface RecordSearch {
  readonly task?: string;
  readonly note?: string;
  readonly log?: string;
  readonly thread?: string;
}

/** Reads `?task=` and `?note=` when they name one or a new one, and `?thread=` when it names a thread. */
function recordSearch(search: Record<string, unknown>): RecordSearch {
  return {
    ...(isTaskParam(search.task) ? { task: search.task } : {}),
    ...(isNoteParam(search.note) ? { note: search.note } : {}),
    ...(isLogParam(search.log) ? { log: search.log } : {}),
    ...(isThreadParam(search.thread) ? { thread: search.thread } : {}),
  };
}

/** How long the route waits for the record before showing the page loading in place. */
const OPEN_GRACE_MS = 300;

export const Route = createFileRoute('/w/$slug/objects/$object_/$recordId/$tab')({
  validateSearch: recordSearch,
  beforeLoad: ({ params }) => {
    if (!isRecordTab(params.tab)) {
      throw redirect({
        to: '/w/$slug/objects/$object/$recordId/$tab',
        params: { slug: params.slug, object: params.object, recordId: params.recordId, tab: 'overview' },
        replace: true,
      });
    }
  },
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.list(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { page: undefined };
    const [attributes, members, access] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
      context.data.access.mine(params.slug).catch(() => undefined),
    ]);
    const meId = access?.memberId;
    // Loaded here rather than imported, so the first load doesn't carry the record page's helpers (and the words
    // that share their chunk); the route's component chunk, started beside this loader, holds it already.
    const { detailAttributes, relatedSides } = await import('../features/records/details.ts');
    const shown = detailAttributes(attributes);
    const sides = relatedSides(attributes, objects);
    // An address that can't be a record's id names no record: the page says so, as for a missing one.
    if (!isRecordId(params.recordId)) {
      return {
        page: {
          object,
          objects,
          attributes: shown,
          related: undefined,
          members,
          meId,
          record: undefined,
          feed: undefined,
          recent: undefined,
          open: undefined,
          notes: undefined,
          comments: undefined,
        },
      };
    }
    const [record, feed, recent, open, notes, comments, sections] = await Promise.all([
      context.data.records.one(
        params.slug,
        params.recordId,
        shown.map((attribute) => attribute.id),
      ),
      context.data.activity.forRecord(params.slug, params.recordId, object.id),
      context.data.activity.recent(params.slug, params.recordId, object.id),
      // With the record's object, so a background job on another object's records leaves them alone (spec 0022).
      context.data.tasks.forRecord(params.slug, params.recordId, 'open', object.id),
      context.data.notes.forRecord(params.slug, params.recordId, object.id),
      // Comments (spec 0038): the store loads in its own chunk, and the tab's count arrives with the page.
      context.data.comments.forRecord(params.slug, params.recordId),
      // The related sections (spec 0017, milestone 3): one source per side, its first page read now.
      Promise.all(
        sides.map((side) =>
          context.data.links.section(params.slug, {
            recordId: params.recordId,
            objectId: object.id,
            attributeId: side.attribute.id,
            farObjectIds: side.attribute.relationship?.targetObjectIds ?? [side.farObject.id],
            // The rows show names only: a far record reads again when its name changes, not with each edit.
            ...(side.farObject.primaryAttributeId === undefined
              ? {}
              : { farNameAttributeIds: [side.farObject.primaryAttributeId] }),
          }),
        ),
      ),
    ]);
    const related = sides.flatMap((side, index) => {
      const section = sections[index];
      return section === undefined ? [] : [{ ...side, section }];
    });
    // The open tasks start loading now; the page draws them (and the tab's count) as they arrive.
    void open.ready();
    // The notes too (spec 0019): the Notes tab's count arrives with the page.
    void notes.ready();
    // A quick load arrives with its record; a slow one shows the page loading in place.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([record.ready(), recent.ready()]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, OPEN_GRACE_MS);
      }),
    ]);
    clearTimeout(timer);
    return {
      page: { object, objects, attributes: shown, related, members, meId, record, feed, recent, open, notes, comments },
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <RecordPendingPage />
    </LoadingNow>
  ),
  errorComponent: RecordError,
  component: RecordRoute,
});

function RecordRoute() {
  const { page } = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  if (page === undefined || !isRecordTab(params.tab)) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return (
    <RecordPage
      slug={params.slug}
      tab={params.tab}
      recordId={params.recordId}
      {...(search.task === undefined ? {} : { task: search.task })}
      {...(search.note === undefined ? {} : { note: search.note })}
      {...(search.log === undefined ? {} : { log: search.log })}
      {...(search.thread === undefined ? {} : { thread: search.thread })}
      {...page}
    />
  );
}

function RecordError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
