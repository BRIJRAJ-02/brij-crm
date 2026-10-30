import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback } from 'react';
import { strings as listStrings } from '../features/lists/strings.ts';
import { isListTab } from '../features/settings/list-tabs.ts';
import { ListSettingsScreen } from '../features/settings/ListSettingsScreen.tsx';
import { ListsPending } from '../features/settings/ListsScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

/** `?attribute=<id>` on the Fields tab: the field whose dialog is open. */
interface ListSettingsSearch {
  readonly attribute?: string;
}

/** Reads `?attribute=` when it holds text, and drops anything else. */
function listSettingsSearch(search: Record<string, unknown>): ListSettingsSearch {
  const { attribute } = search;
  return typeof attribute === 'string' && attribute !== '' && attribute.length <= 64 ? { attribute } : {};
}

// One list's settings tab (spec 0048, AC-4829), by the list's API name: the list from every list the person may
// read (an unknown one, or one whose object they can't read, is "not found" inside the frame), its object, the
// members, and on the Fields tab the list's fields with the archived ones.
export const Route = createFileRoute('/w/$slug/settings/lists/$list/$tab')({
  validateSearch: listSettingsSearch,
  loader: async ({ context, params }) => {
    const [lists, objects, members] = await Promise.all([
      context.data.lists.all(params.slug),
      context.data.objects.all(params.slug),
      context.data.members.list(params.slug).catch(() => []),
    ]).catch((error: unknown) => {
      if (isDataError(error) && error.code === 'NOT_FOUND') return [[], [], []] as const;
      throw error;
    });
    const list = lists.find((each) => each.apiSlug === params.list);
    const object = list === undefined ? undefined : objects.find((each) => each.id === list.objectId);
    if (list === undefined || object === undefined || !isListTab(params.tab)) return { page: undefined };
    const fields =
      params.tab === 'fields' && !list.isArchived ? await context.data.lists.allFields(params.slug, list) : undefined;
    return { page: { list, object, objects, members, tab: params.tab, fields } };
  },
  pendingComponent: () => (
    <LoadingNow>
      <ListsPending />
    </LoadingNow>
  ),
  errorComponent: ListError,
  component: ListSettingsRoute,
});

function ListSettingsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { attribute } = Route.useSearch();
  const { data, toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  // Opening a row sets the param, so the dialog has an address; closing it removes it (replacing the entry).
  const select = useCallback(
    (attributeId: string | undefined) => {
      void navigate({ search: attributeId === undefined ? {} : { attribute: attributeId }, replace: true });
    },
    [navigate],
  );
  if (page === undefined) return <SettingsMissing />;
  return (
    <ListSettingsScreen
      key={page.list.id}
      data={data}
      toasts={toasts}
      slug={slug}
      {...page}
      selectedField={page.tab === 'fields' ? attribute : undefined}
      onSelectField={select}
    />
  );
}

function ListError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={listStrings.settingsTitle}
      heading={listStrings.failed}
      text={isDataError(error) ? error.message : strings.somethingWrong}
      onRetry={() => void router.invalidate()}
    />
  );
}
