// The form's full screen preview in Chromium (spec 0071, AC-6): a visitor's view shown inside the app draws at full
// size while it is open, as the hosted page does, and the app's density comes back when it closes.
import '@crm/ui/app.css';
import type { DataLayer, FormDocument, FormView } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import { applyScaleForPath } from '@crm/ui/theme';
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { Route as PreviewRoute } from '../../routes/w.$slug.captures_.forms.$formId_.preview.tsx';

const DRAFT = {
  questions: [{ id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true }],
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
} as unknown as FormDocument;

const FORM = {
  id: '0199f0a0-0000-7000-8000-0000000000f1',
  name: 'Contact us',
  publicKey: 'contact-us',
  status: 'live',
  draft: DRAFT,
  live: DRAFT,
} as unknown as FormView;

const AT = `/w/acme/captures/forms/${FORM.id}/preview`;

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted !== undefined) {
    const { root, host } = mounted;
    act(() => {
      root.unmount();
    });
    host.remove();
  }
  mounted = undefined;
});

/** The real preview route under a bare root, at a form's preview address, drawn as the app draws it. */
async function openPreview(): Promise<void> {
  // The app's density, as theme-boot.js and main.tsx set it for an app path.
  applyScaleForPath(document.documentElement, AT);
  expect(document.documentElement.dataset.scale).toBe('app');
  const data = {
    forms: { get: () => Promise.resolve(FORM) },
    // No brand store: the preview wears the product's accent.
    brand: { load: () => Promise.reject(new Error('no brand')) },
  } as unknown as DataLayer;
  const toasts: Toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const route = PreviewRoute.update({
    id: '/w/$slug/captures_/forms/$formId_/preview',
    path: '/w/$slug/captures/forms/$formId/preview',
    getParentRoute: () => rootRoute,
  } as Parameters<typeof PreviewRoute.update>[0]);
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [AT] }),
    context: { data, toasts },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-GB" timeZone="UTC" toasts={toasts} navigate={() => undefined} useHref={(href) => href}>
        <RouterProvider router={router} />
      </UiProvider>,
    );
    await router.load();
  });
}

/** The 16 step of the spacing scale as the document draws it now: 16px at full size, 14px at the app's density. (Not
 * `--text-body`: a form page sets its own on the root.) */
function space16(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--space-16').trim();
}

it('draws the visitor’s form at full size while open, and gives the app its density back on close', async () => {
  await openPreview();
  await expect.element(page.getByText('Talk to us')).toBeVisible();
  expect(document.documentElement.dataset.scale).toBeUndefined();
  expect(space16()).toBe('16px');

  const { root, host } = mounted ?? { root: undefined, host: undefined };
  act(() => {
    root?.unmount();
  });
  host?.remove();
  mounted = undefined;
  expect(document.documentElement.dataset.scale).toBe('app');
  expect(space16()).toBe('14px');
});
