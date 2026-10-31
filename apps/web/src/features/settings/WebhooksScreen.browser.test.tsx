// Settings › Webhooks in Chromium (spec 0064, AC-6419, AC-6420, AC-6425): the endpoints table and its empty state,
// Add endpoint with its event chips and the secret shown once, an endpoint's Send test event result inline and its
// log with Resend, Delete asking first in one line, and the page with no sealing key; both themes pass axe.
import type { DataLayer, WebhookDelivery, WebhookEndpoint, WebhookList } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { SettingsTopBarSlot } from './topBarSlot.ts';
import { WebhooksScreen } from './WebhooksScreen.tsx';
import '@crm/ui/styles.css';

const ENDPOINT: WebhookEndpoint = {
  id: '0193a000-0000-7000-8000-000000000001',
  url: 'https://hooks.example.com/timefix',
  description: 'Zapier',
  events: ['booking.created', 'form.submitted'],
  status: 'active',
  secretHint: 'ab12',
  lastDelivery: { state: 'sent', responseStatus: 200, at: '2026-10-31T09:00:00.000Z' },
  createdAt: '2026-10-30T09:00:00.000Z',
};

const DELIVERY: WebhookDelivery = {
  id: '0193a000-0000-7000-8000-000000000002',
  eventId: '0193a000-0000-7000-8000-000000000003',
  eventType: 'booking.created',
  attempt: 1,
  state: 'failed',
  responseStatus: 500,
  responseMs: 120,
  responseExcerpt: 'Internal error',
  failure: 'status',
  createdAt: '2026-10-31T09:00:00.000Z',
};

beforeAll(async () => {
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;
afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/** A data layer whose webhooks answer as given. */
function layerWith(overrides: Partial<DataLayer['webhooks']> = {}) {
  const webhooks = {
    list: vi.fn(),
    create: vi.fn(() =>
      Promise.resolve({
        endpoint: { ...ENDPOINT, id: '0193a000-0000-7000-8000-000000000009' },
        secret: 'whsec_shown_once',
      }),
    ),
    update: vi.fn((_slug: string, _id: string, change: Partial<WebhookEndpoint>) =>
      Promise.resolve({ ...ENDPOINT, ...change }),
    ),
    rotateSecret: vi.fn(() => Promise.resolve({ endpoint: ENDPOINT, secret: 'whsec_rotated' })),
    remove: vi.fn(() => Promise.resolve()),
    test: vi.fn(() =>
      Promise.resolve<WebhookDelivery>({
        ...DELIVERY,
        id: '0193a000-0000-7000-8000-000000000004',
        eventType: 'ping',
        state: 'sent',
        responseStatus: 204,
        failure: undefined,
      } as WebhookDelivery),
    ),
    deliveries: vi.fn(() => Promise.resolve({ deliveries: [DELIVERY] })),
    resend: vi.fn(() => Promise.resolve({ ...DELIVERY, state: 'sent' as const, responseStatus: 200, attempt: 2 })),
    ...overrides,
  };
  return { layer: { webhooks } as unknown as DataLayer, webhooks };
}

async function renderScreen(layer: DataLayer, initial: WebhookList): Promise<Toasts> {
  const toasts = createToasts();
  const bar = document.createElement('div');
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/webhooks',
    component: () => (
      <SettingsTopBarSlot value={bar}>
        <WebhooksScreen data={layer} toasts={toasts} slug="acme" initial={initial} />
      </SettingsTopBarSlot>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/settings/webhooks'] }),
    context: { data: layer, toasts },
  });
  const frame = document.createElement('div');
  const host = document.createElement('div');
  frame.append(bar, host);
  document.body.append(frame);
  const root = createRoot(host);
  mounted = { root, host: frame };
  await act(async () => {
    root.render(
      <UiProvider
        locale="en-GB"
        timeZone="UTC"
        toasts={toasts}
        navigate={(href) => {
          router.history.push(href);
        }}
        useHref={(href) => router.history.createHref(href)}
      >
        <RouterProvider router={router} />
      </UiProvider>,
    );
    await router.load();
  });
  return toasts;
}

describe('the endpoints (AC-6419)', () => {
  it('lists each endpoint with its events, status and last delivery, and passes axe in both themes', async () => {
    const { layer } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [ENDPOINT] });
    await expect.element(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeInTheDocument();
    await expect.element(page.getByRole('rowheader', { name: /Zapier/ })).toBeVisible();
    expect(document.body.textContent).toContain('Booking made, Form submitted');
    expect(document.body.textContent).toContain('Active');
    expect(document.body.textContent).toContain('Delivered');
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    resetTheme();
  });

  it('says what to do with none, and that webhooks aren’t set up without a key', async () => {
    const { layer } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [] });
    await expect.element(page.getByText('No endpoints yet')).toBeVisible();
    act(() => {
      mounted?.root.unmount();
    });
    mounted?.host.remove();
    mounted = undefined;
    await renderScreen(layer, { available: false, endpoints: [] });
    await expect.element(page.getByText('Webhooks aren’t set up here yet')).toBeVisible();
    expect(page.getByRole('button', { name: 'Add endpoint' }).elements()).toHaveLength(0);
  });

  it('adds one with its events, then shows its secret once with Copy', async () => {
    const { layer, webhooks } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [] });
    await page.getByRole('button', { name: 'Add endpoint' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    await dialog.getByRole('textbox', { name: 'Endpoint URL' }).fill('https://hooks.example.com/new');
    await dialog.getByRole('button', { name: 'Form submitted' }).click();
    await dialog.getByRole('button', { name: 'Add endpoint' }).click();
    expect(webhooks.create).toHaveBeenCalledWith('acme', {
      url: 'https://hooks.example.com/new',
      description: '',
      events: ['booking.created', 'form.submitted'],
    });
    const secret = page.getByRole('dialog', { name: 'Copy your signing secret' });
    await expect.element(secret.getByText('whsec_shown_once')).toBeVisible();
    await expect.element(secret.getByRole('button', { name: 'Copy secret' })).toBeVisible();
    await secret.getByRole('button', { name: 'Done' }).click();
    expect(document.body.textContent).not.toContain('whsec_shown_once');
  });

  it('shows a refused address on its field', async () => {
    const refusal = Object.assign(new Error('That address points to a private network. Use a public one.'), {
      name: 'DataError',
      code: 'CONFIG_INVALID',
      data: {
        refusals: [
          {
            code: 'CONFIG_INVALID',
            message: 'That address points to a private network. Use a public one.',
            field: 'url',
          },
        ],
      },
    });
    const { layer } = layerWith({ create: vi.fn(() => Promise.reject(refusal)) });
    await renderScreen(layer, { available: true, endpoints: [] });
    await page.getByRole('button', { name: 'Add endpoint' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    await dialog.getByRole('textbox', { name: 'Endpoint URL' }).fill('https://inside.example.com');
    await dialog.getByRole('button', { name: 'Add endpoint' }).click();
    await expect.element(dialog.getByText('That address points to a private network. Use a public one.')).toBeVisible();
  });
});

describe('one endpoint (AC-6420, AC-6425)', () => {
  it('sends a test event and shows the result inline, lists the log and resends', async () => {
    const { layer, webhooks } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [ENDPOINT] });
    await page.getByRole('rowheader', { name: /Zapier/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Zapier' });
    await expect.element(dialog.getByText('Ends in ab12')).toBeVisible();
    await expect.element(dialog.getByText(/Internal error/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Send test event' }).click();
    await expect.element(dialog.getByText('Delivered', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Resend' }).first().click();
    expect(webhooks.resend).toHaveBeenCalledWith('acme', DELIVERY.id);
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    resetTheme();
  });

  it('asks first, in one line, before deleting', async () => {
    const { layer, webhooks } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [ENDPOINT] });
    await page.getByRole('rowheader', { name: /Zapier/ }).click();
    await page.getByRole('button', { name: 'Delete endpoint' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this endpoint?' });
    await expect.element(confirm.getByText('It stops getting events, and its log goes with it.')).toBeVisible();
    expect(webhooks.remove).not.toHaveBeenCalled();
    await confirm.getByRole('button', { name: 'Delete endpoint' }).click();
    expect(webhooks.remove).toHaveBeenCalledWith('acme', ENDPOINT.id);
    await userEvent.keyboard('{Escape}');
  });
});
