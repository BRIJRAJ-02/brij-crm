import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { FormsScreen } from '../features/forms/FormsScreen.tsx';
import { strings } from '../features/forms/strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings, Forms (spec 0023): the workspace's forms on objects the person can see, the active ones and the
// archived ones, and the objects (each form's tile, and a new form's choice), all through the data layer.
export const Route = createFileRoute('/w/$slug/settings/forms/')({
  loader: async ({ context, params }) => {
    try {
      const [forms, archived, objects] = await Promise.all([
        context.data.forms.list(params.slug),
        context.data.forms.list(params.slug, true),
        context.data.objects.list(params.slug),
      ]);
      return { page: { forms, archived, objects } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <SettingsPage title={strings.forms} current="forms" isLoading>
      {null}
    </SettingsPage>
  ),
  errorComponent: FormsError,
  component: FormsRoute,
});

function FormsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) return <SettingsMissing current="forms" />;
  return <FormsScreen slug={slug} {...page} />;
}

function FormsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.forms}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
      current="forms"
    />
  );
}
