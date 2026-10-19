import { isDataError, type SubmissionState } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { FormScreen } from '../features/forms/FormScreen.tsx';
import { strings } from '../features/forms/strings.ts';
import { FORM_TABS, type FormTab } from '../features/settings/nav.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// One form (spec 0023): `?tab=build` (the builder, by default) or `?tab=submissions`, with `&state=` narrowing the
// submissions and `&submission=<id>` opening one beside them. The loader reads the form, the fields a question may
// fill and the members (owner), and on the Submissions tab its first page and the open submission, all through the
// data layer. The screen is keyed by the form's revision, so a save or publish starts it from what the server holds.
interface FormSearch {
  readonly tab: FormTab;
  readonly state?: SubmissionState;
  readonly submission?: string;
}

const STATES: readonly string[] = ['received', 'processing', 'processed', 'spam', 'held', 'needs_review', 'failed'];

export const Route = createFileRoute('/w/$slug/settings/forms/$formId')({
  validateSearch: (search: Record<string, unknown>): FormSearch => ({
    tab:
      typeof search.tab === 'string' && (FORM_TABS as readonly string[]).includes(search.tab)
        ? (search.tab as FormTab)
        : 'build',
    ...(typeof search.state === 'string' && STATES.includes(search.state)
      ? { state: search.state as SubmissionState }
      : {}),
    ...(typeof search.submission === 'string' && search.submission !== '' ? { submission: search.submission } : {}),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab, state: search.state, submission: search.submission }),
  loader: async ({ context, params, deps }) => {
    try {
      const [form, attributes, members, objects] = await Promise.all([
        context.data.forms.get(params.slug, params.formId),
        context.data.forms.attributes(params.slug, params.formId),
        context.data.members.list(params.slug),
        context.data.objects.list(params.slug),
      ]);
      const onSubmissions = deps.tab === 'submissions';
      const [submissions, openSubmission] = await Promise.all([
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
      return { page: { form, attributes, members, objects, submissions, openSubmission } };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <SettingsPage title={strings.forms} current="forms" isLoading>
      {null}
    </SettingsPage>
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
      <SettingsFailed
        title={strings.missingTitle}
        heading={strings.missingTitle}
        text={strings.missingText}
        onRetry={() => undefined}
        current="forms"
      />
    );
  }
  return (
    <FormScreen
      key={`${page.form.id}:${String(page.form.revision)}`}
      slug={slug}
      form={page.form}
      attributes={page.attributes}
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
    <SettingsFailed
      title={strings.forms}
      heading={strings.formFailedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
      current="forms"
    />
  );
}
