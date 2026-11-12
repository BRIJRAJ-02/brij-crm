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
import '@crm/ui/app.css';

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

// The frame around the page (sidebar, Tasks badge, calendar banner), all still loading.
const LOADING = { status: 'loading' as const };
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
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

/** A target-size line whose every target is a grid cell holding a button: the Table's own nesting. */
function nestedInCell(line: string): boolean {
  if (!line.startsWith('target-size')) return false;
  const ids = line.match(/#[\w-]+/g) ?? [];
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const cell = document.querySelector(id);
      return cell?.getAttribute('role') === 'gridcell' && cell.querySelector('button') !== null;
    })
  );
}

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
  const layer = {
    // The frame around the screen reads these (spec 0034): its sidebar, logo, Tasks badge and Inbox badge, all
    // still loading. A source the frame reads and this fake leaves out throws inside the frame, not the screen.
    calendar: { view: () => stillLoading },
    nav: { source: () => stillLoading, change: () => undefined },
    workspaceLogo: { subscribe: () => () => undefined, src: () => undefined },
    tasks: { due: () => stillLoading },
    inbox: { unread: () => stillLoading },
    webhooks,
  };
  return { layer: layer as unknown as DataLayer, webhooks };
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
    // Paused rather than broken, with the variable named, since the person who can fix it runs the server.
    await expect.element(page.getByText('Webhooks are paused')).toBeVisible();
    expect(document.body.textContent).toContain('WEBHOOK_SECRET_KEY');
    // Add is there but refuses: the api answers 503, so offering it would only fail.
    await expect.element(page.getByRole('button', { name: 'Add endpoint' }).first()).toBeDisabled();
  });

  it('keeps the endpoints readable while webhooks are paused, rather than hiding the whole page', async () => {
    // What both productions show today. An admin must still be able to open an endpoint, read its log and delete
    // it; replacing the page made a workspace's existing setup look as though it had never been made (UX review).
    const { layer } = layerWith();
    await renderScreen(layer, { available: false, endpoints: [ENDPOINT] });
    await expect.element(page.getByRole('rowheader', { name: /Zapier/ })).toBeVisible();
    expect(document.body.textContent).toContain('Webhooks are paused');
    expect(document.body.textContent).toContain('WEBHOOK_SECRET_KEY');
    // Add is there but refuses, since every write answers 503 without the key.
    await expect.element(page.getByRole('button', { name: 'Add endpoint' }).first()).toBeDisabled();
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    resetTheme();
  });

  it('shows an endpoint turned off by three days of failures, and how to bring it back', async () => {
    const { layer } = layerWith();
    const failing: WebhookEndpoint = { ...ENDPOINT, status: 'off', offReason: 'failing' };
    await renderScreen(layer, { available: true, endpoints: [failing] });
    expect(document.body.textContent).toContain('Off, failing');
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    resetTheme();
    // The panel says what happened and that one switch brings it back. (Its own axe pass is the panel test's,
    // which opens the dialog and lets it settle; a theme applied mid animation leaves axe no background to read.)
    await page.getByRole('rowheader', { name: /Zapier/ }).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    expect(document.body.textContent).toContain('failed');
    await userEvent.keyboard('{Escape}');
  });

  it('adds one with its events, then shows its secret once with Copy', async () => {
    const { layer, webhooks } = layerWith();
    await renderScreen(layer, { available: true, endpoints: [] });
    await page.getByRole('button', { name: 'Add endpoint' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    await dialog.getByRole('textbox', { name: 'Endpoint URL' }).fill('https://hooks.example.com/new');
    await dialog.getByRole('button', { name: 'Form submitted' }).click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    expect(webhooks.create).toHaveBeenCalledWith('acme', {
      url: 'https://hooks.example.com/new',
      description: '',
      events: ['booking.created', 'form.submitted'],
    });
    const secret = page.getByRole('dialog', { name: 'Copy your signing secret' });
    await expect.element(secret.getByText('whsec_shown_once')).toBeVisible();
    await expect.element(secret.getByRole('button', { name: 'Copy secret' })).toBeVisible();
    await secret.getByRole('button', { name: 'Done' }).click();
    // Gone once its exit has run, and nowhere else on the page.
    await expect.element(secret).not.toBeInTheDocument();
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
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
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
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.element(dialog.getByText('Delivered', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Resend' }).first().click();
    expect(webhooks.resend).toHaveBeenCalledWith('acme', DELIVERY.id);
    for (const theme of THEMES) {
      applyTheme(theme);
      // React Aria's grid makes each cell focusable, so a cell holding a button (the log's Resend) reads to axe as a
      // target nested in a target. That is the library Table's own shape, reported to it, and not this screen's.
      expect((await axeViolations()).filter((line) => !nestedInCell(line))).toEqual([]);
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

describe('screenshots', () => {
  /**
   * The webhook screens in light and dark, for the lane's own eyes before it lands. Off unless
   * `VITE_WEBHOOK_SHOTS=1`, as the other screens' shot tests are, so CI never draws them.
   */
  it.runIf(import.meta.env.VITE_WEBHOOK_SHOTS === '1')('saves each webhook screen, light and dark', async () => {
    const dir = 'webhook-shots';
    const clear = () => {
      act(() => {
        mounted?.root.unmount();
      });
      mounted?.host.remove();
      mounted = undefined;
      resetTheme();
    };
    await page.viewport(1280, 900);
    for (const theme of THEMES) {
      // The list with an endpoint, one off after failing, and one the reader switched off.
      const { layer } = layerWith();
      await renderScreen(layer, {
        available: true,
        endpoints: [
          ENDPOINT,
          {
            ...ENDPOINT,
            id: `${ENDPOINT.id.slice(0, -1)}2`,
            url: 'https://hooks.zapier.example/catch/1',
            description: 'Make',
            status: 'off',
            offReason: 'failing',
          },
          {
            ...ENDPOINT,
            id: `${ENDPOINT.id.slice(0, -1)}3`,
            url: 'https://n8n.example.com/webhook/x',
            description: 'n8n',
            status: 'off',
            offReason: 'turned_off',
          },
        ],
      });
      applyTheme(theme);
      await page.screenshot({ path: `${dir}/list-${theme}.png` });
      clear();

      // The empty state.
      const empty = layerWith();
      await renderScreen(empty.layer, { available: true, endpoints: [] });
      applyTheme(theme);
      await page.screenshot({ path: `${dir}/empty-${theme}.png` });
      clear();

      // Paused: no signing key on this server, with the variable named.
      const paused = layerWith();
      await renderScreen(paused.layer, { available: false, endpoints: [ENDPOINT] });
      applyTheme(theme);
      await page.screenshot({ path: `${dir}/paused-${theme}.png` });
      clear();

      // One endpoint's panel, with its delivery log.
      const open = layerWith();
      await renderScreen(open.layer, { available: true, endpoints: [ENDPOINT] });
      await page.getByRole('rowheader', { name: /Zapier/ }).click();
      await expect.element(page.getByRole('dialog')).toBeVisible();
      applyTheme(theme);
      await page.screenshot({ path: `${dir}/panel-${theme}.png` });
      await userEvent.keyboard('{Escape}');
      clear();

      // Add endpoint, with its event chips.
      const adding = layerWith();
      await renderScreen(adding.layer, { available: true, endpoints: [] });
      await page.getByRole('button', { name: 'Add endpoint' }).first().click();
      await expect.element(page.getByRole('dialog', { name: 'Add endpoint' })).toBeVisible();
      applyTheme(theme);
      await page.screenshot({ path: `${dir}/add-${theme}.png` });
      await userEvent.keyboard('{Escape}');
      clear();
    }
  });
});
