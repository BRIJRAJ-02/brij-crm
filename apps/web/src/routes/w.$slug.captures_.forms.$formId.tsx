import { isDataError, type SubmissionState } from '@crm/data';
import { EmptyState, LoadingNow, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { EditorPending } from '../features/captures/EditorPending.tsx';
import { FormEditor } from '../features/forms/FormEditor.tsx';
import { FORM_TABS, type FormTab } from '../features/forms/paths.ts';
import { strings } from '../features/forms/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One form's editor (spec 0023): `?tab=` form (by default), settings, install or submissions, with `&state=`
// narrowing the submissions and `&submission=<id>` opening one beside them. The loader reads the form, its target's
// attributes, the members and the objects, and on Submissions its first page and the open one, all through the data
// layer. The screen is keyed by the form, so it keeps its draft across tab changes. It sits outside the Captures
// layout (`captures_`): the editor needs the page's whole width and its own TopBar, so no Links · Forms strip.
interface FormSearch {
  readonly tab: FormTab;
  readonly state?: SubmissionState;
  readonly submission?: string;
}

const STATES: readonly string[] = ['received', 'processing', 'processed', 'spam', 'held', 'needs_review', 'failed'];

export const Route = createFileRoute('/w/$slug/captures_/forms/$formId')({
  validateSearch: (search: Record<string, unknown>): FormSearch => ({
    tab:
      typeof search.tab === 'string' && (FORM_TABS as readonly string[]).includes(search.tab)
        ? (search.tab as FormTab)
        : 'form',
    ...(typeof search.state === 'string' && STATES.includes(search.state)
      ? { state: search.state as SubmissionState }
      : {}),
    ...(typeof search.submission === 'string' && search.submission !== '' ? { submission: search.submission } : {}),
  }),
  // Only Submissions reads anything of its own, so Form, Settings and Install share one match: moving between them
  // runs no loader and never shows the pending page; the editor stays as it is.
  loaderDeps: ({ search }) =>
    search.tab === 'submissions'
      ? { tab: search.tab, state: search.state, submission: search.submission }
      : { tab: 'form' as const, state: undefined, submission: undefined },
  loader: async ({ context, params, deps }) => {
    try {
      const onSubmissions = deps.tab === 'submissions';
      // Every read at once: one round trip, not the form first and then its submissions.
      const [form, target, members, objects, submissions, openSubmission] = await Promise.all([
        context.data.forms.get(params.slug, params.formId),
        context.data.forms.attributes(params.slug, params.formId),
        context.data.members.list(params.slug),
        context.data.objects.list(params.slug),
        onSubmissions
          ? context.data.submissions.list(
              params.slug,
              params.formId,
              deps.state === undefined ? {} : { state: deps.state },
            )
          : Promise.resolve(undefined),
        onSubmissions && deps.submission !== undefined
          ? context.data.submissions.get(params.slug, deps.submission).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      return { page: { form, target, members, objects, submissions, openSubmission } };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  // Shown only once the loading delay passed: its skeletons show at once.
  pendingComponent: () => (
    <LoadingNow>
      <EditorPending title={strings.forms} icon="clipboard-list" cards={[strings.name]} />
    </LoadingNow>
  ),
  errorComponent: FormError,
  component: FormRoute,
});

function FormRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  if (page === undefined) {
    return (
      <WorkspacePage
        currentPage="captures"
        page={{
          topBar: <TopBar title={strings.missingTitle} icon="clipboard-list" />,
          body: <EmptyState title={strings.missingTitle}>{strings.missingText}</EmptyState>,
        }}
      />
    );
  }
  return (
    <FormEditor
      key={page.form.id}
      slug={slug}
      form={page.form}
      target={page.target}
      members={page.members}
      objects={page.objects}
      tab={search.tab}
      submissions={page.submissions}
      state={search.state}
      openSubmission={page.openSubmission}
    />
  );
}

function FormError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: <TopBar title={strings.forms} icon="clipboard-list" />,
        body: (
          <EmptyState tone="error" title={strings.formFailedTitle} onRetry={() => void router.invalidate()}>
            {isDataError(error) ? error.message : strings.failedText}
          </EmptyState>
        ),
      }}
    />
  );
}
