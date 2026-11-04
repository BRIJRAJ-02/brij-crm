import { isDataError } from '@crm/data';
import { previewOf } from '@crm/data/forms';
import { Callout, EmptyState, HostedFormPreview } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { BrandedFormPreview } from '../features/forms/FormBrand.tsx';
import { strings } from '../features/forms/strings.ts';

// A draft opened in a new tab to try (spec 0023, The editor: layout): the hosted page's own renderer, marked
// "Preview, not live", checking answers and sending nothing. Outside the app frame, as a visitor would see it.
export const Route = createFileRoute('/w/$slug/captures_/forms/$formId_/preview')({
  loader: async ({ context, params }) => {
    try {
      // The kit the draft wears while its look is Brand (spec 0063, AC-6327), so the tab shows what goes live. A
      // store or a read that fails leaves the preview the product's accent and nothing else changes.
      const [form, brand] = await Promise.all([
        context.data.forms.get(params.slug, params.formId),
        context.data.brand
          .load()
          .then(async (store) => {
            await store.readKit(params.slug);
            return store;
          })
          .catch(() => undefined),
      ]);
      return { form, brand };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { form: undefined, brand: undefined };
      throw error;
    }
  },
  component: PreviewRoute,
});

function PreviewRoute() {
  const { form, brand } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (form === undefined)
    return (
      <EmptyState layout="block" title={strings.missingTitle}>
        {strings.missingText}
      </EmptyState>
    );
  return (
    <main>
      <Callout placement="banner" tone="info">
        {strings.previewNotLive}
      </Callout>
      {form.draft.look.theme === 'brand' && brand !== undefined ? (
        <BrandedFormPreview
          brand={brand}
          slug={slug}
          form={previewOf(form.draft, { key: form.publicKey })}
          mode="page"
        />
      ) : (
        <HostedFormPreview form={previewOf(form.draft, { key: form.publicKey })} mode="page" />
      )}
    </main>
  );
}
