// Sign out everyone's step up in Chromium (spec 0033, AC-896; the owner's bug, 22 Oct): when the code email
// can't go, or too many were sent, the confirm says so in plain words inside the dialog, which stays open with
// "Email me a code" ready to try again, never "Something went wrong"; the next send that works asks for the code.
import type { AccountSecurityState, AccountSecurityView, DataLayer, StepUpResult } from '@crm/data';
import { isSessionFresh } from '@crm/data';
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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { WorkspaceSecurityScreen } from './WorkspaceSecurityScreen.tsx';

/** The api's words for a code email that didn't send (CODE_NOT_SENT_MESSAGE in apps/api's account router). */
const NOT_SENT = 'We couldn’t send the code just now. Try again in a few minutes.';
const GENERIC = 'Something went wrong';

/** Two factor off and this session not checked lately: signing everyone out asks for an emailed code first. */
const STALE: AccountSecurityState = {
  status: 'ready',
  twoFactor: { on: false },
  passkeys: [],
  session: { withSecondFactor: false },
  requiredBy: [],
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

/** A data layer whose step up sends answer `answers` in turn, counting each send; `checked` answers each code. */
function layerWith(answers: readonly StepUpResult[], checked: StepUpResult = { ok: true }) {
  const sends: number[] = [];
  const view: AccountSecurityView = {
    subscribe: () => () => undefined,
    getSnapshot: () => STALE,
    retain: () => () => undefined,
    reload: () => Promise.resolve(),
  };
  const layer = {
    calendar: { view: () => stillLoading },
    nav: { source: () => stillLoading, change: () => undefined },
    tasks: { due: () => stillLoading },
    account: {
      security: () => view,
      isFresh: isSessionFresh,
      stepUp: {
        sendCode: () => {
          sends.push(sends.length);
          return Promise.resolve(answers[Math.min(sends.length - 1, answers.length - 1)] ?? { ok: true });
        },
        verify: () => Promise.resolve(checked),
        passkey: () => Promise.resolve({ ok: false, code: 'CANCELLED' }),
      },
    },
    workspaceSecurity: { signOutEveryone: () => Promise.reject(new Error('not reached')) },
  } as unknown as DataLayer;
  return { layer, sends };
}

async function renderScreen(layer: DataLayer): Promise<Toasts> {
  const toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const security = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/workspace/security',
    component: () => (
      <WorkspaceSecurityScreen
        data={layer}
        toasts={toasts}
        slug="acme"
        workspaceName="Acme"
        initial={{ requireTwoFactor: false, membersWithout: 0, youHaveTwoFactor: false }}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([security]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/settings/workspace/security'] }),
    context: { data: layer, toasts },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
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

/** Opens Sign out everyone's confirm. */
async function openConfirm() {
  await page.getByRole('button', { name: 'Sign out everyone' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Sign out everyone?' });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

describe('sign out everyone’s step up, when the code can’t be sent', () => {
  it('says the code couldn’t be sent, keeps the dialog open, and sends on the next try', async () => {
    const { layer, sends } = layerWith([{ ok: false, code: 'API_UNAVAILABLE', message: NOT_SENT }, { ok: true }]);
    await renderScreen(layer);
    const dialog = await openConfirm();
    expect(dialog.element().textContent).toContain('First we’ll email you a 6 digit code.');
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await expect.element(dialog.getByText(NOT_SENT)).toBeVisible();
    expect(dialog.element().textContent).not.toContain(GENERIC);
    expect(sends).toHaveLength(1);
    // Still open, the same button ready to try again.
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await expect.element(dialog.getByText('Code sent. Check your email.')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Send a new code' })).toBeVisible();
    expect(dialog.element().textContent).not.toContain(NOT_SENT);
    expect(sends).toHaveLength(2);
  });

  it('says how long to wait after too many codes', async () => {
    const limited = 'Too many codes sent. Wait 7 minutes, then try again.';
    const { layer } = layerWith([{ ok: false, code: 'RATE_LIMITED', message: limited }]);
    await renderScreen(layer);
    const dialog = await openConfirm();
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await expect.element(dialog.getByText(limited)).toBeVisible();
    expect(dialog.element().textContent).not.toContain(GENERIC);
  });

  it('says a new code that didn’t go in an alert, leaving the code field as it was', async () => {
    const { layer } = layerWith([{ ok: true }, { ok: false, code: 'API_UNAVAILABLE', message: NOT_SENT }]);
    await renderScreen(layer);
    const dialog = await openConfirm();
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    await dialog.getByRole('button', { name: 'Send a new code' }).click();
    await expect.element(dialog.getByRole('alert')).toHaveTextContent(NOT_SENT);
    expect(dialog.element().querySelector('[aria-invalid="true"]')).toBeNull();
    await expect.element(dialog.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('says a code that ran out on the code field, beside Send a new code', async () => {
    const expired = 'That code has expired. Send a new code.';
    const { layer } = layerWith([{ ok: true }], { ok: false, code: 'CODE_INVALID', message: expired });
    await renderScreen(layer);
    const dialog = await openConfirm();
    await dialog.getByRole('button', { name: 'Email me a code' }).click();
    // A code just sent puts focus in the code's boxes; six digits commit it.
    await expect.element(dialog.getByText('Code sent. Check your email.')).toBeVisible();
    await userEvent.keyboard('123456');
    await expect.element(dialog.getByText(expired)).toBeVisible();
    expect(dialog.element().querySelector('[aria-invalid="true"]')).not.toBeNull();
    await expect.element(dialog.getByRole('button', { name: 'Send a new code' })).toBeVisible();
  });
});
