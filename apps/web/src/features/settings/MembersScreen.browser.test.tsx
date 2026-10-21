// The Members page's confirms in Chromium (the owner, 21 October 2026: anything that ends something asks first):
// Revoke on an invitation opens a danger confirm; Cancel revokes nothing, and the verb revokes once, busy while the
// server works, with the server's refusal inside the dialog, which stays open.
import type { DataLayer, InvitationView, MemberView, MyAccess } from '@crm/data';
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
import { page } from 'vitest/browser';
import { MembersScreen } from './MembersScreen.tsx';

const ADA: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'owner',
  joinedAt: '2026-10-01T09:00:00.000Z',
};
const GRACE: InvitationView = {
  id: '0199a6f2-0000-7000-8000-0000000000a1',
  kind: 'email',
  email: 'grace@example.com',
  role: 'member',
  invitedBy: 'Ada Lovelace',
  invitedAt: '2026-10-20T09:00:00.000Z',
  expiresAt: '2026-10-27T09:00:00.000Z',
  isExpired: false,
};
const ACCESS: MyAccess = {
  memberId: ADA.id,
  role: 'owner',
  roleLabel: 'Owner',
  permissions: ['members.invite', 'members.manage'],
};

// The frame reads the member's calendars for its banner: here none, still loading, so no banner shows.
const loading = { status: 'loading' as const };
const calendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
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

const LOADING = { status: 'loading' as const };
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
};

/** A data layer whose revoke is counted, answering with `answer` (a refusal when it rejects). */
function layerWith(answer: () => Promise<void>) {
  let revokes = 0;
  const layer = {
    calendar: { view: () => calendarView },
    // The frame's sidebar and Tasks badge (spec 0034), still loading.
    nav: { source: () => stillLoading, change: () => undefined },
    tasks: { due: () => stillLoading },
    members: { watch: () => () => undefined },
    invitations: {
      revoke: () => {
        revokes += 1;
        return answer();
      },
    },
  } as unknown as DataLayer;
  return { layer, revokes: () => revokes };
}

/** Renders the Members page at its address inside a memory router, as an owner with one open invitation. */
async function renderMembers(layer: DataLayer): Promise<Toasts> {
  const toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const members = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/members',
    component: () => (
      <MembersScreen data={layer} toasts={toasts} slug="acme" members={[ADA]} invitations={[GRACE]} access={ACCESS} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([members]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/settings/members'] }),
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

/** Opens the Invitations tab and picks Revoke on Grace's row. */
async function pickRevoke(): Promise<void> {
  await page.getByRole('tab', { name: /Invitations/ }).click();
  await page.getByRole('button', { name: 'Actions for the invitation to grace@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Revoke' }).click();
}

describe('revoking an invitation asks first', () => {
  it('names the address, and Cancel revokes nothing', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('The link in their email stops working at once.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.revokes()).toBe(0);
  });

  it('revokes once on the verb, busy while the server works', async () => {
    let release: () => void = () => undefined;
    const counted = layerWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    const commit = dialog.getByRole('button', { name: 'Revoke invitation' });
    await commit.click();
    await commit.click({ force: true });
    expect(counted.revokes()).toBe(1);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.revokes()).toBe(1);
  });

  it('shows a refusal inside the dialog, which stays open', async () => {
    const refusal = Object.assign(new Error('That invitation doesn’t exist.'), {
      name: 'DataError',
      code: 'NOT_FOUND',
    });
    const counted = layerWith(() => Promise.reject(refusal));
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    await dialog.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    await expect.element(dialog).toBeVisible();
    expect(counted.revokes()).toBe(1);
  });
});
