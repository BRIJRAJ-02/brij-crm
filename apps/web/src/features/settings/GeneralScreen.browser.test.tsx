// Settings › Workspace › General in Chromium (SS-G1 to SS-G4, 23 October 2026): each change saves at once, with no
// SaveBar and no leave check. The name saves once its edit ends (leaving the field, or Enter), said with "Name
// changed." and Undo, and an empty name says so on the field and saves nothing. The address is a read only row whose
// Change opens a dialog holding the address field and its check. A member reads one Callout over locked fields.
import '@crm/ui/styles.css';
import type { DataLayer, WorkspaceSettings } from '@crm/data';
import { createToasts } from '@crm/ui';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { GeneralScreen } from './GeneralScreen.tsx';
import { strings } from './workspace-strings.ts';

const SAVED: WorkspaceSettings = {
  id: '0190f0f0-0000-7000-8000-0000000000a1',
  name: 'Acme',
  slug: 'acme',
  timeZone: 'Europe/London',
};

/** Addresses another workspace holds. */
const TAKEN = new Set(['acme-labs']);

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

/**
 * General as its route draws it, over a fake data layer that keeps what was saved: each landed change reads the
 * settings again (`onChanged`), as the route's invalidate does.
 */
async function renderGeneral({ mayManage = true, mayDelete = true } = {}) {
  let saved = SAVED;
  const update = vi.fn((_slug: string, change: Partial<WorkspaceSettings>) => {
    saved = { ...saved, ...change };
    return Promise.resolve(saved);
  });
  const slugAvailable = vi.fn((slug: string) => Promise.resolve(!TAKEN.has(slug)));
  const onMoved = vi.fn((_slug: string) => Promise.resolve());
  const toasts = createToasts();
  const data = {
    workspace: { update, delete: vi.fn() },
    workspaces: { slugAvailable },
  } as unknown as DataLayer;
  function General() {
    const [settings, setSettings] = useState(saved);
    return (
      <GeneralScreen
        data={data}
        toasts={toasts}
        slug="acme"
        settings={settings}
        mayManage={mayManage}
        mayDelete={mayDelete}
        origin="https://app.timefix.test"
        onChanged={() => {
          setSettings(saved);
          return Promise.resolve();
        }}
        onMoved={onMoved}
        onDeleted={() => undefined}
      />
    );
  }
  shown = await renderInApp(() => <General />, {
    data,
    toasts,
    pattern: '/w/$slug/settings/general',
    at: '/w/acme/settings/general',
    permissions: [...(mayManage ? ['workspace.manage'] : []), ...(mayDelete ? ['workspace.delete'] : [])],
  });
  await expect.element(page.getByRole('textbox', { name: strings.name })).toBeVisible();
  return { update, slugAvailable, onMoved };
}

const nameField = () => page.getByRole('textbox', { name: strings.name });

/**
 * Theme changes start colour transitions, and a dialog grows in from its centre; finish them so axe reads the final
 * colours and sizes (a spinner's endless turn is left alone).
 */
function settleTransitions() {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  }
}

/** The page's WCAG A and AA violations, as `rule: elements` lines. */
async function violations(): Promise<string[]> {
  settleTransitions();
  // React Aria's live announcer can still hold an earlier test's announcement, naming an element gone since.
  const results = await axe.run(
    { include: [document.body], exclude: [['[data-live-announcer]']] },
    {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    },
  );
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

describe('General’s name', () => {
  it('saves a new name on leaving the field, says so with Undo, and Undo puts the old one back', async () => {
    await page.viewport(1280, 800);
    const { update } = await renderGeneral();
    await userEvent.fill(nameField(), '  Acme Labs ');
    expect(update).not.toHaveBeenCalled();
    await userEvent.keyboard('{Tab}');
    await expect.poll(() => update.mock.calls).toEqual([['acme', { name: 'Acme Labs' }]]);
    const toast = page.getByRole('alertdialog').filter({ hasText: strings.nameChanged });
    await expect.element(toast).toBeVisible();
    await expect.element(nameField()).toHaveValue('Acme Labs');
    await toast.getByRole('button', { name: strings.undo }).click();
    await expect.poll(() => update.mock.calls.at(-1)).toEqual(['acme', { name: 'Acme' }]);
    await expect.element(nameField()).toHaveValue('Acme');
  });

  it('saves once on Enter, not again when focus then leaves', async () => {
    await page.viewport(1280, 800);
    const { update } = await renderGeneral();
    await userEvent.fill(nameField(), 'Halcyon');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Tab}');
    await expect.poll(() => update.mock.calls).toEqual([['acme', { name: 'Halcyon' }]]);
    // Leaving an unchanged name sends nothing more.
    await userEvent.click(nameField());
    await userEvent.keyboard('{Tab}');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('says an empty name is missing on the field and saves nothing; Esc puts the saved name back', async () => {
    await page.viewport(1280, 800);
    const { update } = await renderGeneral();
    await userEvent.fill(nameField(), '   ');
    await userEvent.keyboard('{Tab}');
    await expect.element(page.getByText(strings.nameMissing)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(nameField());
    await userEvent.keyboard('{Escape}');
    await expect.element(nameField()).toHaveValue('Acme');
    expect(page.getByText(strings.nameMissing).elements()).toEqual([]);
  });
});

describe('General’s web address', () => {
  it('is a read only row whose Change opens the dialog, with the field and its check', async () => {
    await page.viewport(1280, 800);
    const { update, slugAvailable, onMoved } = await renderGeneral();
    // The whole link, Copy and Change; no address field on the page.
    await expect.element(page.getByText('https://app.timefix.test/w/acme')).toBeVisible();
    await expect.element(page.getByRole('button', { name: strings.copyAddress })).toBeVisible();
    expect(page.getByRole('textbox', { name: strings.webAddress }).elements()).toEqual([]);
    await page.getByRole('button', { name: strings.changeAddress, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    await expect.element(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', { name: strings.webAddress });
    await expect.element(field).toHaveValue('acme');
    const move = dialog.getByRole('button', { name: strings.moveAction });
    await expect.element(move).toBeDisabled();
    await expect.element(dialog.getByText(strings.moveKept('acme'))).toBeVisible();
    // A taken address says so, offers free ones, and can't be used.
    await userEvent.fill(field, 'acme-labs');
    await expect.element(dialog.getByText(strings.addressTaken, { exact: true })).toBeVisible();
    await expect.element(move).toBeDisabled();
    // A free one turns Change address on, and the sentence names the move.
    await userEvent.fill(field, 'halcyon');
    await expect.element(dialog.getByText(strings.addressFree, { exact: true })).toBeVisible();
    expect(slugAvailable).toHaveBeenCalledWith('halcyon');
    await expect.element(dialog.getByText(strings.moveText('acme', 'halcyon'))).toBeVisible();
    await expect.element(move).toBeEnabled();
    await move.click();
    await expect.poll(() => update.mock.calls).toEqual([['acme', { slug: 'halcyon' }]]);
    await expect.poll(() => onMoved.mock.calls).toEqual([['halcyon']]);
  });

  it('starts afresh each time Change opens it', async () => {
    await page.viewport(1280, 800);
    await renderGeneral();
    await page.getByRole('button', { name: strings.changeAddress, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    await userEvent.fill(dialog.getByRole('textbox', { name: strings.webAddress }), 'halcyon');
    await dialog.getByRole('button', { name: strings.cancel }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await page.getByRole('button', { name: strings.changeAddress, exact: true }).click();
    await expect.element(dialog.getByRole('textbox', { name: strings.webAddress })).toHaveValue('acme');
  });
});

describe('General saves at once', () => {
  it('has no SaveBar and never asks the browser to confirm leaving', async () => {
    await page.viewport(1280, 800);
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await renderGeneral();
    await userEvent.fill(nameField(), 'Acme Labs');
    expect(page.getByRole('button', { name: /^Save/ }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Discard/ }).elements()).toEqual([]);
    await shown?.router.navigate({ to: '/w/$slug/settings/general', params: { slug: 'other' } });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('General for a member', () => {
  it('says once why it is locked, over locked fields, with Copy and no Change', async () => {
    await page.viewport(1280, 800);
    await renderGeneral({ mayManage: false, mayDelete: false });
    expect(page.getByText(strings.readOnly).elements()).toHaveLength(1);
    await expect.element(nameField()).toHaveAttribute('readonly');
    await expect.element(page.getByRole('button', { name: strings.copyAddress })).toBeVisible();
    expect(page.getByRole('button', { name: strings.changeAddress, exact: true }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: strings.deleteAction }).elements()).toEqual([]);
  });
});

describe.each(['light', 'dark'] as const)('General at 390 in %s', (theme) => {
  it.each([
    ['an owner', true],
    ['a member', false],
  ] as const)('passes axe for %s', async (_who, mayManage) => {
    await page.viewport(390, 800);
    document.documentElement.dataset.theme = theme;
    await renderGeneral({ mayManage, mayDelete: mayManage });
    expect(await violations()).toEqual([]);
    // Nothing runs off the side of a phone.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('passes axe with the address dialog open', async () => {
    await page.viewport(390, 800);
    document.documentElement.dataset.theme = theme;
    await renderGeneral();
    await page.getByRole('button', { name: strings.changeAddress, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    await userEvent.fill(dialog.getByRole('textbox', { name: strings.webAddress }), 'acme-labs');
    await expect.element(dialog.getByText(strings.addressTaken, { exact: true })).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});
