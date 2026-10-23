import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { HistoryPending, HistoryScreen } from '../features/settings/HistoryScreen.tsx';
import { strings as nav } from '../features/settings/history-nav-strings.ts';
import { strings } from '../features/settings/history-strings.ts';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { WorkspaceChangesPending, WorkspaceChangesTab } from '../features/settings/WorkspaceChangesTab.tsx';

// Settings › History › Workspace changes (spec 0046, AC-4601, AC-4603): owners and admins only (`audit.read`). Anyone
// else is sent on to Your sign ins (hidden means absent, never shown locked). The loader opens the log, which starts
// its first page at once without waiting for it, so the table shows its own loading rows; each visit reads afresh.
export const Route = createFileRoute('/w/$slug/settings/history/changes')({
  beforeLoad: async ({ context, params }) => {
    const access = await context.data.access.mine(params.slug);
    if (!access.permissions.includes('audit.read')) {
      throw redirect({ to: '/w/$slug/settings/history/sign-ins', params: { slug: params.slug }, replace: true });
    }
  },
  loader: async ({ context, params }) => ({ log: await context.data.audit.openLog(params.slug) }),
  // Only a holder of `audit.read` gets this far, so the pending page has the tab bar.
  pendingComponent: () => (
    <LoadingNow>
      <HistoryPending tab="changes" canReadChanges body={<WorkspaceChangesPending />} />
    </LoadingNow>
  ),
  errorComponent: HistoryError,
  component: WorkspaceChangesRoute,
});

function WorkspaceChangesRoute() {
  const { log } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <HistoryScreen slug={slug} tab="changes" canReadChanges>
      <WorkspaceChangesTab log={log} />
    </HistoryScreen>
  );
}

function HistoryError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={nav.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
