import { isDataError } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback } from 'react';
import { isObjectTab } from '../features/settings/nav.ts';
import { ObjectSettingsPending, ObjectSettingsScreen } from '../features/settings/ObjectSettingsScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

/** `?attribute=<id>` on the Attributes tab (spec 0012, AC-231): the attribute whose dialog is open. */
interface ObjectSettingsSearch {
  readonly attribute?: string;
}

/** Reads `?attribute=` when it holds text, and drops anything else. */
function objectSettingsSearch(search: Record<string, unknown>): ObjectSettingsSearch {
  const { attribute } = search;
  return typeof attribute === 'string' && attribute !== '' && attribute.length <= 64 ? { attribute } : {};
}

// One object's settings tab (spec 0012, screens), by the object's API name, so
// links survive renames: the object from every object the person can see
// (archived ones too), and on the Attributes tab all its attributes (archived
// ones too), the usage for the meter and the members for a Member default.
// An unknown object or tab shows "not found" inside the frame.
export const Route = createFileRoute('/w/$slug/settings/objects/$object/$tab')({
  validateSearch: objectSettingsSearch,
  loader: async ({ context, params }) => {
    const objects = await context.data.objects.all(params.slug).catch((error: unknown) => {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return [];
      throw error;
    });
    const object = objects.find((each) => each.apiSlug === params.object);
    if (object === undefined || !isObjectTab(params.tab)) return { page: undefined };
    // An archived object's attributes aren't read: they come back with it.
    const attributesPage =
      params.tab === 'attributes' && !object.isArchived
        ? await Promise.all([
            context.data.attributes.all(params.slug, object.id),
            context.data.usage.get(params.slug),
            context.data.members.list(params.slug),
          ]).then(([attributes, usage, members]) => ({ attributes, usage, members }))
        : undefined;
    return { page: { object, objects, tab: params.tab, attributesPage } };
  },
  pendingComponent: ObjectSettingsPending,
  errorComponent: ObjectError,
  component: ObjectSettingsRoute,
});

function ObjectSettingsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { attribute } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Opening a row sets the param, so the dialog has an address; closing it (or a param naming nothing) removes it.
  const select = useCallback(
    (attributeId: string | undefined, replace = false) => {
      void navigate({ search: attributeId === undefined ? {} : { attribute: attributeId }, replace });
    },
    [navigate],
  );
  if (page === undefined) return <SettingsMissing />;
  return (
    <ObjectSettingsScreen
      slug={slug}
      {...page}
      selectedAttribute={page.tab === 'attributes' ? attribute : undefined}
      onSelectAttribute={select}
    />
  );
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
