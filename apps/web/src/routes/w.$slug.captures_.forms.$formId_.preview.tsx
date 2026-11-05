import { isDataError } from '@crm/data';
import { previewOf } from '@crm/data/forms';
import {
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  HostedFormPreview,
  PreviewPage,
  SectionBar,
  SegmentedControl,
} from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { BrandedFormPreview } from '../features/forms/FormBrand.tsx';
import { formHref, formsHref } from '../features/forms/paths.ts';
import { strings } from '../features/forms/strings.ts';

// A draft opened in a new tab to try (spec 0023, The editor: layout): the hosted page's own renderer, checking answers
// and sending nothing. Outside the app frame, as a visitor would see it, under one bar (lane 3c): Back to editor, the
// form's name, and Desktop or Phone; then "Preview · nothing is sent", and the page in the height left, so its foot
// ("Powered by") is never cut off.
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

/** The two ways to look at it: the window's width, or a phone's. */
type Device = 'desktop' | 'phone';

function PreviewRoute() {
  const { form, brand } = Route.useLoaderData();
  const { slug, formId } = Route.useParams();
  const [device, setDevice] = useState<Device>('desktop');
  // Whether the editor opened this tab (its Preview), read once: then Back closes the tab.
  const [opener] = useState(() => globalThis.opener !== null && globalThis.opener !== undefined);
  if (form === undefined)
    return (
      <EmptyState
        layout="block"
        title={strings.missingTitle}
        // A dead end gets a way back.
        actions={
          <ButtonLink href={formsHref(slug)} variant="secondary">
            {strings.backToForms}
          </ButtonLink>
        }
      >
        {strings.missingText}
      </EmptyState>
    );
  const shown = previewOf(form.draft, { key: form.publicKey });
  return (
    <main>
      <PreviewPage
        device={device}
        bar={
          <SectionBar
            variant="bar"
            isTitleQuiet
            start={
              // Opened from the editor's Preview, this tab closes back to it: a link here would open a second
              // editor on the same draft. Reached any other way, it is a link to the editor.
              opener ? (
                <Button
                  variant="ghost"
                  icon="arrow-left"
                  onPress={() => {
                    globalThis.close();
                  }}
                >
                  {strings.backToEditor}
                </Button>
              ) : (
                <ButtonLink variant="ghost" icon="arrow-left" href={formHref(slug, formId)}>
                  {strings.backToEditor}
                </ButtonLink>
              )
            }
            title={form.name}
            end={
              <SegmentedControl
                label={strings.previewDevice}
                size="compact"
                value={device}
                onChange={(next) => {
                  if (next === 'desktop' || next === 'phone') setDevice(next);
                }}
                segments={[
                  { value: 'desktop', label: strings.previewDesktop, icon: 'monitor' },
                  { value: 'phone', label: strings.previewPhone, icon: 'smartphone' },
                ]}
              />
            }
          />
        }
        banner={
          <Callout placement="banner" tone="info">
            {strings.previewNotLive}
          </Callout>
        }
      >
        {form.draft.look.theme === 'brand' && brand !== undefined ? (
          <BrandedFormPreview brand={brand} slug={slug} form={shown} mode="page" />
        ) : (
          <HostedFormPreview form={shown} mode="page" />
        )}
      </PreviewPage>
    </main>
  );
}
