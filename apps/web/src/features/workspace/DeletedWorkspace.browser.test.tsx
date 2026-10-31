// A deleted workspace's page (spec 0031, AC-823) in Chromium: Restore and the way back. When it was the person's
// last workspace, Settings opens nowhere, so the page offers Start a new workspace and Delete your account, whose
// confirm opens here (QA, 22 October 2026: the account's confirm says to delete the workspace first, and the person
// was then stuck on this page).
import type { AccountSecurityState, DataLayer, DeletedWorkspace } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { deletedPage } from './DeletedWorkspace.tsx';

const DELETED: DeletedWorkspace = { name: 'Gone’s workspace', slug: 'gone', purgeAfter: '2026-11-21T10:00:00.000Z' };

/** A stand in data layer: who is signed in, the deletion check, and a security state still loading. */
function fakeData(): DataLayer {
  const security: AccountSecurityState = { status: 'loading' };
  return {
    me: {
      get: () =>
        Promise.resolve({ user: { id: '0199a6f2-0000-7000-8000-000000000001', name: 'Gone', email: 'gone@acme.com' } }),
    },
    account: {
      security: () => ({
        retain: () => () => undefined,
        subscribe: () => () => undefined,
        getSnapshot: () => security,
      }),
      isFresh: () => false,
      deletion: { check: () => Promise.resolve({ blockers: [], lost: [] }) },
    },
  } as unknown as DataLayer;
}

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

/** The page at the deleted workspace's address, inside a memory router. */
async function renderDeleted(hasOther: boolean) {
  const data = fakeData();
  const rootRoute = createRootRoute();
  const deleted = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug',
    component: () => deletedPage(DELETED, () => Promise.resolve(), { data, hasOther }).body,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([deleted]),
    history: createMemoryHistory({ initialEntries: ['/w/gone'] }),
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
        toasts={createToasts()}
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
}

describe('a deleted workspace’s page', () => {
  it('offers Restore and the way back to the other workspaces, and nothing about the account', async () => {
    await renderDeleted(true);
    await expect.element(page.getByText('Gone’s workspace is deleted')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Restore workspace' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Back to your workspaces' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Delete your account' }).query()).toBeNull();
  });

  it('when it was the last, starts a new workspace or deletes the account through the same confirm', async () => {
    await renderDeleted(false);
    await expect.element(page.getByRole('link', { name: 'Start a new workspace' })).toHaveAttribute('href', '/');
    await page.getByRole('button', { name: 'Delete your account' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    await expect.element(dialog).toBeVisible();
    // Nothing stands in the way: the confirm asks for the email, as Profile's does, and says first that the deleted
    // workspace can't be restored by them afterwards.
    await expect.element(dialog.getByRole('textbox', { name: 'Type gone@acme.com to confirm' })).toBeVisible();
    await expect
      .element(dialog.getByText('Gone’s workspace can’t be restored after this.', { exact: false }))
      .toBeVisible();
  });
});
