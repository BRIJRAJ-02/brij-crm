import { isDataError } from '@crm/data';
import { previewOf } from '@crm/data/forms';
import { Callout, EmptyState, HostedFormPreview } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { strings } from '../features/forms/strings.ts';

// A draft opened in a new tab to try (spec 0023, The editor: layout): the hosted page's own renderer, marked
// "Preview, not live", checking answers and sending nothing. Outside the app frame, as a visitor would see it.
export const Route = createFileRoute('/w/$slug/captures_/forms/$formId_/preview')({
  loader: async ({ context, params }) => {
    try {
      return { form: await context.data.forms.get(params.slug, params.formId) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { form: undefined };
      throw error;
    }
  },
  component: PreviewRoute,
});

function PreviewRoute() {
  const { form } = Route.useLoaderData();
  if (form === undefined) return <EmptyState title={strings.missingTitle}>{strings.missingText}</EmptyState>;
  return (
    <main>
      <Callout placement="bar" tone="info">
        {strings.previewNotLive}
      </Callout>
      <HostedFormPreview form={previewOf(form.draft, { key: form.publicKey })} mode="page" />
    </main>
  );
}
