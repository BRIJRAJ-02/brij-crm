import { createFileRoute, redirect } from '@tanstack/react-router';
import { FORM_TABS, type FormTab } from '../features/forms/paths.ts';

// One form's builder under Settings (spec 0023's first address) moved to Captures › Forms: the old address opens the
// same form's editor there, on the same tab and with the same submission open.
export const Route = createFileRoute('/w/$slug/settings/forms/$formId')({
  beforeLoad: ({ params, search }) => {
    const { tab, submission } = search as Readonly<Record<string, unknown>>;
    throw redirect({
      to: '/w/$slug/captures/forms/$formId',
      params: { slug: params.slug, formId: params.formId },
      search: {
        tab: typeof tab === 'string' && (FORM_TABS as readonly string[]).includes(tab) ? (tab as FormTab) : 'form',
        ...(typeof submission === 'string' ? { submission } : {}),
      },
      replace: true,
    });
  },
});
