import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { isObjectTab } from '../features/settings/nav.ts';
import { ObjectSettingsScreen } from '../features/settings/ObjectSettingsScreen.tsx';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

// One object's settings tab (spec 0012, screens), by the object's API name, so
// links survive renames: the object from every object the person can see
// (archived ones too), and on the Attributes tab its live attributes. An
// unknown object or tab shows "not found" inside the frame.
export const Route = createFileRoute('/w/$slug/settings/objects/$object/$tab')({
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined || !isObjectTab(params.tab)) return { page: undefined };
    // An archived object's attributes aren't read: they come back with it.
    const attributes =
      params.tab === 'attributes' && !object.isArchived
        ? await context.data.attributes.list(params.slug, object.id)
        : undefined;
    return { page: { object, tab: params.tab, attributes } };
  },
  pendingComponent: () => (
    <SettingsPage title={strings.objects} isLoading>
      {null}
    </SettingsPage>
  ),
  errorComponent: ObjectError,
  component: ObjectSettingsRoute,
});

function ObjectSettingsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) return <SettingsMissing />;
  return <ObjectSettingsScreen slug={slug} {...page} />;
}

function ObjectError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.objects}
      heading={strings.loadFailedObject}
      text={isDataError(error) ? error.message : strings.somethingWrong}
      onRetry={() => void router.invalidate()}
    />
  );
}
