import type { ViewRequest } from '../features/command/commands.ts';
import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import {
  farAttributesUnchecked,
  runningQuery,
  savedQuery,
  throughTargets,
  toViewQuery,
} from '../features/views/query.ts';
import { ViewScreen } from '../features/views/ViewScreen.tsx';
import { isPeekTab, isRecordParam, type PeekTab } from '../features/records/params.ts';
import { ArchivedObjectScreen } from '../features/workspace/ArchivedObjectScreen.tsx';
import { viewColumns, viewReadIds } from '../features/views/layout.ts';
import { failedPage, missingPage, ObjectPendingPage, viewNotFoundPage } from '../features/workspace/ObjectScreen.tsx';
import { navObjects } from '../features/workspace/objects.ts';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One view of an object (spec 0020): `/w/$slug/objects/$object/views/$viewId`,
// with the unsaved filter and sorts in `?draft=` (base64url of their
// canonical JSON, AC-466). The trailing underscore keeps it out of the
// object address's own route. The loader reads the view and the object's
// views, checks a link's draft (loading the schemas lazily), and for a table
// warms the records the view runs (its count and first block, reading only
// the columns the table shows, waiting at most OPEN_GRACE_MS), all through the data
// layer; the screen reads them itself. A view the person can't see shows the
// not found state, never saying why (AC-463). Only the view's id reloads it:
// a draft changes on the screen, which keeps the rows it has until the next
// ones are in. `?record=` (and `?panelTab=`) opens a record in the panel over
// the table or board (spec 0017, AC-384), so a reload or a shared link opens
// it again; changing it never reloads the view.
/** How long the route waits for the first rows before showing the table loading in place. */
const OPEN_GRACE_MS = 300;

/** The search the route takes: a draft, as text; checking it waits for the loader and the screen. */
interface ViewSearch {
  readonly draft?: string;
  /** Open the new record dialog once the table shows (the command menu's Create a <object>, spec 0039). */
  readonly new?: true;
  /** The name the new record dialog starts with (the command menu's Create <object> named …). */
  readonly name?: string;
  /** Export this view, open Create view (the command menu's actions), or Rename (a duplicate just made), once it shows. */
  readonly do?: ViewRequest;
  /** The record the panel shows (spec 0017, AC-384). */
  readonly record?: string;
  /** The panel's tab, `details` when left out. */
  readonly panelTab?: PeekTab;
}

/** The panel's part of the address, kept when the draft or a request changes it. */
const peekOf = (search: ViewSearch) => ({
  ...(search.record === undefined ? {} : { record: search.record }),
  ...(search.panelTab === undefined ? {} : { panelTab: search.panelTab }),
});

export const Route = createFileRoute('/w/$slug/objects/$object_/views/$viewId')({
  validateSearch: (search: Record<string, unknown>): ViewSearch => ({
    ...(typeof search.draft === 'string' && search.draft !== '' ? { draft: search.draft } : {}),
    ...(search.new === true || search.new === 1 || search.new === '1' || search.new === 'true' ? { new: true } : {}),
    ...(typeof search.name === 'string' && search.name.trim() !== '' ? { name: search.name.slice(0, 200) } : {}),
    ...(search.do === 'export' || search.do === 'new-view' || search.do === 'rename' ? { do: search.do } : {}),
    ...(isRecordParam(search.record) ? { record: search.record } : {}),
    ...(isRecordParam(search.record) && isPeekTab(search.panelTab) && search.panelTab !== 'details'
      ? { panelTab: search.panelTab }
      : {}),
  }),
  loaderDeps: () => ({}),
  // Entering the view (again) reads it afresh: the records a cached match held are let go 30 seconds after
  // the screen leaves. A draft changing on the screen ('stay') never reloads it.
  shouldReload: ({ cause }) => cause === 'enter',
  loader: async ({ context, params, location }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined) return { kind: 'missing' as const };
    if (object.isArchived) {
      const [firstLive] = navObjects(objects);
      return { kind: 'archived' as const, archived: { object, firstLive } };
    }
    const view = context.data.views.get(params.slug, params.viewId);
    const views = context.data.views.list(params.slug, object.id);
    const membersLoading = context.data.members.list(params.slug);
    const [attributes] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      view.ready(),
      views.ready(),
    ]);
    const body = view.getSnapshot();
    if (body.status === 'not-found' || body.view === undefined || body.view.objectId !== object.id) {
      if (body.status === 'error') throw body.error ?? new Error('The view did not load.');
      const list = views.getSnapshot();
      const defaultName = list.views.find((each) => each.id === list.defaultViewId)?.name;
      return { kind: 'not-found' as const, object, defaultName };
    }
    // A link's draft, checked; one that doesn't read is dropped with a toast (AC-467).
    const search = location.search as ViewSearch;
    const linked = search.draft === undefined ? undefined : await context.data.views.readDraft(search.draft);
    // No draft in the address: the one this tab kept for the view, which the screen brings back, read through the
    // same check as a link's (one too long for a link is the tab's own and runs as kept). One that no longer reads
    // is dropped with the same toast; one naming a field archived since drops that condition with the dropped notice,
    // as a link's does, never reaching the server as FILTER_INVALID.
    const keptRaw = search.draft === undefined ? context.data.views.keptDraft(params.slug, params.viewId) : undefined;
    const keptText = keptRaw === undefined ? undefined : context.data.views.draftParam(keptRaw.query);
    const kept =
      keptRaw === undefined
        ? undefined
        : keptText === undefined
          ? keptRaw.query
          : await context.data.views.readDraft(keptText);
    const opened = linked ?? kept;
    const query = opened ?? savedQuery(body.view);
    // A through condition's far attributes are read first, so one the reader can't use drops out before it runs;
    // past the first hop, or when that read fails, it is kept unchecked for the server (late trap #45): the first
    // rows are the view's, never every record.
    const targets = [
      ...new Set([...throughTargets(query, attributes), ...throughTargets(savedQuery(body.view), attributes)]),
    ];
    const farLists = new Map(
      await Promise.all(
        targets.map(async (target) => {
          const list = await context.data.attributes.list(params.slug, target).catch(() => undefined);
          return [target, list] as const;
        }),
      ),
    );
    const far = farAttributesUnchecked(attributes, (id) => farLists.get(id) ?? undefined);
    const effective = runningQuery(query, attributes, far);
    const running = effective.status === 'ready' ? effective : runningQuery(savedQuery(body.view), attributes, far);
    // The archived ones the reader may see, so the view can say which it runs without (spec 0020, AC-480): the live
    // list leaves them out, so they read as unknown rather than archived. Read only when the view or its draft leaves
    // something out, so a schema change reloads the table with one read, not two. The same list settings reads, held
    // apart; a failed read only leaves the view unexplained, never unopened.
    const savedRun = runningQuery(savedQuery(body.view), attributes, far);
    // A board grouped by a field no longer live may be grouped by an archived one, which the board says and offers
    // to restore (late trap #14): read for that too.
    const storedGroup = body.view.kind === 'board' ? body.view.config.board?.groupByAttributeId : undefined;
    const isGroupGone = storedGroup !== undefined && !attributes.some((attribute) => attribute.id === storedGroup);
    const archivedAttributes =
      isGroupGone || [effective, savedRun].some((run) => run.status === 'ready' && run.dropped)
        ? await context.data.attributes
            .all(params.slug, object.id)
            .then((all) => all.filter((attribute) => attribute.isArchived))
            .catch(() => [])
        : [];
    const recordsQuery = running.status === 'ready' ? toViewQuery(running) : {};
    const [members, records] = await Promise.all([
      membersLoading,
      // A quick load arrives with its rows; a slow one shows the table's own loading rows under its header.
      // A board view warms no table: its columns load their own first cards (spec 0021).
      body.view.kind === 'board'
        ? undefined
        : context.data.records.open(
            params.slug,
            object.id,
            recordsQuery,
            viewReadIds(viewColumns(body.view, object, attributes), object, attributes),
            OPEN_GRACE_MS,
          ),
    ]);
    return {
      kind: 'view' as const,
      screen: {
        object,
        attributes,
        archivedAttributes,
        members,
        view,
        views,
        records,
        recordsQuery,
        opened: {
          query: opened,
          unreadable:
            (search.draft !== undefined && linked === undefined) || (keptRaw !== undefined && kept === undefined),
          dropped: opened !== undefined && effective.status === 'ready' && effective.dropped,
        },
      },
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectPendingPage />
    </LoadingNow>
  ),
  errorComponent: ViewError,
  component: ViewRoute,
});

function ViewRoute() {
  const loaded = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  if (loaded.kind === 'archived') return <ArchivedObjectScreen slug={params.slug} {...loaded.archived} />;
  if (loaded.kind === 'missing') {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  if (loaded.kind === 'not-found') {
    return (
      <WorkspacePage
        currentObject={loaded.object.apiSlug}
        page={viewNotFoundPage(loaded.object, params.slug, loaded.defaultName)}
      />
    );
  }
  // The record panel (spec 0017, AC-384): opening it is one step in the history; stepping, tabs and closing replace.
  const toPeek = (next: ViewSearch, replace = true) => {
    void navigate({
      to: '/w/$slug/objects/$object/views/$viewId',
      params: { slug: params.slug, object: params.object, viewId: params.viewId },
      search: next,
      replace,
    });
  };
  const { record: _record, panelTab: _tab, ...withoutPeek } = search;
  return (
    <ViewScreen
      peek={{
        recordId: search.record,
        tab: search.panelTab ?? 'details',
        open: (recordId) => {
          // Opening pushes, so Back closes the panel; a step or another row replaces it.
          toPeek({ ...search, record: recordId }, search.record !== undefined);
        },
        setTab: (tab) => {
          toPeek({
            ...withoutPeek,
            ...(search.record === undefined ? {} : { record: search.record }),
            ...(tab === 'details' ? {} : { panelTab: tab }),
          });
        },
        close: () => {
          toPeek(withoutPeek);
        },
      }}
      // Another view is another screen: its draft, Popovers and dialogs start afresh.
      key={params.viewId}
      slug={params.slug}
      {...loaded.screen}
      param={search.draft}
      {...(search.do === undefined ? {} : { request: search.do })}
      onRequestTaken={() => {
        void navigate({
          to: '/w/$slug/objects/$object/views/$viewId',
          params: { slug: params.slug, object: params.object, viewId: params.viewId },
          search: { ...peekOf(search), ...(search.draft === undefined ? {} : { draft: search.draft }) },
          replace: true,
        });
      }}
      isCreateRequested={search.new === true}
      {...(search.new === true && search.name !== undefined ? { createName: search.name } : {})}
      onCreateRequestTaken={() => {
        void navigate({
          to: '/w/$slug/objects/$object/views/$viewId',
          params: { slug: params.slug, object: params.object, viewId: params.viewId },
          search: { ...peekOf(search), ...(search.draft === undefined ? {} : { draft: search.draft }) },
          replace: true,
        });
      }}
      writeParam={(draft, replace) => {
        void navigate({
          to: '/w/$slug/objects/$object/views/$viewId',
          params: { slug: params.slug, object: params.object, viewId: params.viewId },
          search: { ...peekOf(search), ...(draft === undefined ? {} : { draft }) },
          replace,
        });
      }}
    />
  );
}

function ViewError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
