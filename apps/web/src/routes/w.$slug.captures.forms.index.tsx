import { isDataError } from '@crm/data';
import { EmptyState, PageColumn, LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { FormsPending, FormsScreen } from '../features/forms/FormsScreen.tsx';
import { strings } from '../features/forms/strings.ts';

// Captures › Forms (spec 0023): the workspace's forms on objects the person can see, from the data layer's held list
// (`forms.view`), which every form write patches (a create, the builder's rename and publish, a pause, a copy, a
// delete), so the list shows them without a refresh. The loader waits for the first read only; coming back, the held
// rows show at once and are read again behind them. The Captures layout draws the frame, the TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/captures/forms/')({
  loader: async ({ context, params }) => {
    try {
      await context.data.forms.view(params.slug).ready();
      return { isMissing: false };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { isMissing: true };
      throw error;
    }
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <FormsPending />
    </LoadingNow>
  ),
  errorComponent: FormsError,
  component: FormsRoute,
});

function FormsRoute() {
  const { isMissing } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (isMissing) return <EmptyState title={strings.missingTitle}>{strings.failedText}</EmptyState>;
  return <FormsScreen slug={slug} />;
}

function FormsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
