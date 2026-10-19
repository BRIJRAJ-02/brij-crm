import { isDataError } from '@crm/data';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { FormsScreen } from '../features/forms/FormsScreen.tsx';
import { strings } from '../features/forms/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// Captures, Forms (spec 0023): the workspace's forms on objects the person can see, through the data layer.
export const Route = createFileRoute('/w/$slug/captures/forms/')({
  loader: async ({ context, params }) => {
    try {
      return { forms: await context.data.forms.list(params.slug) };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { forms: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <WorkspacePage page={{ topBar: <TopBar title={strings.forms} icon="clipboard-list" isLoading />, body: null }} />
  ),
  errorComponent: FormsError,
  component: FormsRoute,
});

function FormsRoute() {
  const { forms } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (forms === undefined) {
    return (
      <WorkspacePage isFailed page={{ topBar: <TopBar title={strings.forms} icon="clipboard-list" />, body: null }} />
    );
  }
  return <FormsScreen slug={slug} forms={forms} />;
}

function FormsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={strings.forms} icon="clipboard-list" />,
        body: (
          <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
            {isDataError(error) ? error.message : strings.failedText}
          </EmptyState>
        ),
      }}
    />
  );
}
