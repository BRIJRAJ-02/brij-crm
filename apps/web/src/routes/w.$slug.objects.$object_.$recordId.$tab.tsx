import { isDataError } from '@crm/data';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { detailAttributes, isRecordId, isRecordTab } from '../features/records/details.ts';
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
// with this route's component, outside the first load.
/** How long the route waits for the record before showing the page loading in place. */
const OPEN_GRACE_MS = 300;

export const Route = createFileRoute('/w/$slug/objects/$object_/$recordId/$tab')({
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
    const [attributes, members] = await Promise.all([
      context.data.attributes.list(params.slug, object.id),
      context.data.members.list(params.slug),
    ]);
    const shown = detailAttributes(attributes);
    // An address that can't be a record's id names no record: the page says so, as for a missing one.
    if (!isRecordId(params.recordId)) {
      return { page: { object, attributes: shown, members, record: undefined, feed: undefined, recent: undefined } };
    }
    const [record, feed, recent] = await Promise.all([
      context.data.records.one(
        params.slug,
        params.recordId,
        shown.map((attribute) => attribute.id),
      ),
      context.data.activity.forRecord(params.slug, params.recordId),
      context.data.activity.recent(params.slug, params.recordId),
    ]);
    // A quick load arrives with its record; a slow one shows the page loading in place.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([record.ready(), recent.ready()]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, OPEN_GRACE_MS);
      }),
    ]);
    clearTimeout(timer);
    return { page: { object, attributes: shown, members, record, feed, recent } };
  },
  pendingComponent: RecordPendingPage,
  errorComponent: RecordError,
  component: RecordRoute,
});

function RecordRoute() {
  const { page } = Route.useLoaderData();
  const params = Route.useParams();
  if (page === undefined || !isRecordTab(params.tab)) {
    return <WorkspacePage page={missingPage(strings.pageMissingTitle, strings.pageMissingText)} />;
  }
  return <RecordPage slug={params.slug} tab={params.tab} recordId={params.recordId} {...page} />;
}

function RecordError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} />;
}
