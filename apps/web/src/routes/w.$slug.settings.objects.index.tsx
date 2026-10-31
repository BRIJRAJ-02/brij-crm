import { isDataError } from '@crm/data';
import { LoadingNow, sharedStrings } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ObjectsPending, ObjectsScreen } from '../features/settings/ObjectsScreen.tsx';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

// Settings, Objects (spec 0012, AC-222): every object the person can see,
// archived ones too, in the workspace's order, with the record counts (one
// read), the attribute counts and the custom object meter from usage.get, all
// through the data layer. The
// screen loads with this route's component, outside the first load.
export const Route = createFileRoute('/w/$slug/settings/objects/')({
  loader: async ({ context, params }) => {
    const [objects, usage, recordCounts] = await Promise.all([
      context.data.objects.all(params.slug),
      context.data.usage.get(params.slug),
      // The Records column, one read for every object; a failure leaves the column blank, never the page.
      context.data.records.objectCounts(params.slug).catch(() => undefined),
    ]).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [undefined, undefined, undefined] as const;
      throw error;
    });
    return { objects, usage, recordCounts };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ObjectsPending />
    </LoadingNow>
  ),
  errorComponent: ObjectsError,
  component: ObjectsRoute,
});

function ObjectsRoute() {
  const { objects, usage, recordCounts } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (objects === undefined || usage === undefined) return null;
  return <ObjectsScreen slug={slug} objects={objects} usage={usage} recordCounts={recordCounts} />;
}

function ObjectsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.objects}
      heading={strings.loadFailed}
      text={isDataError(error) ? error.message : sharedStrings.couldntDoThat}
      onRetry={() => void router.invalidate()}
    />
  );
}
