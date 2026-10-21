import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { GeneralPending, GeneralScreen } from '../features/settings/GeneralScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/workspace-strings.ts';

// Settings › Workspace › General (spec 0031, AC-822, AC-823): every member reads the workspace's name, time zone
// and address; `workspace.manage` changes them, and owners (`workspace.delete`) get the danger zone.
export const Route = createFileRoute('/w/$slug/settings/general')({
  loader: async ({ context, params }) => {
    try {
      const [access, settings] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.workspace.get(params.slug),
      ]);
      return { screen: { access, settings } };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <GeneralPending />
    </LoadingNow>
  ),
  errorComponent: GeneralError,
  component: GeneralRoute,
});

function GeneralRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  if (screen === undefined) return <SettingsMissing backTo="home" />;
  const { permissions } = screen.access;
  return (
    <GeneralScreen
      key={`${screen.settings.name}:${screen.settings.timeZone}`}
      data={data}
      toasts={toasts}
      slug={slug}
      settings={screen.settings}
      mayManage={permissions.includes('workspace.manage')}
      mayDelete={permissions.includes('workspace.delete')}
      origin={window.location.origin}
      onChanged={() => router.invalidate()}
      onDeleted={(name) => {
        // Restore stays one click away (Undo), then the workspace's address works again.
        toasts.toast({
          tone: 'success',
          message: strings.deleted(name),
          action: {
            label: strings.restore,
            onAction: () => {
              data.workspace.restore(slug).then(
                () => {
                  toasts.toast({ tone: 'success', message: strings.restored(name) });
                  void navigate({ to: '/w/$slug/settings/general', params: { slug } });
                },
                (error: unknown) => {
                  toasts.toast({
                    tone: 'danger',
                    message: isDataError(error) ? error.message : strings.somethingWrong,
                  });
                },
              );
            },
          },
        });
        void navigate({ to: '/', replace: true });
      }}
    />
  );
}

function GeneralError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.generalTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
