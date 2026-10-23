// Settings › General in Chromium, saving at once (SS-G1 to SS-G4): a rename saves when the field is left (once, even
// after Enter) with "Name changed." and Undo; an empty name is refused on the field and nothing is sent; Change opens
// the address dialog with its field, checked as typed, and Change address waits for a free one; there is no Save bar
// and no browser confirm on leaving; a member reads one note and finds the fields locked; the delete confirm says
// what happens in the open; axe is clean at 390 in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type { DataLayer, WorkspaceSettings } from '@crm/data';
import { createToasts } from '@crm/ui';
import type { RouterHistory } from '@tanstack/react-router';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { GeneralScreen } from './GeneralScreen.tsx';
import { strings } from './workspace-strings.ts';

const SAVED: WorkspaceSettings = {
  id: '0199a6f2-0000-7000-8000-0000000000w1',
  name: 'Acme',
  slug: 'acme',
  timeZone: 'UTC',
};

/** An address another workspace has. */
const TAKEN = 'acme-taken';

/** A data layer holding the workspace's settings, which its update changes as the server would. */
function layer() {
  let saved = SAVED;
  const update = vi.fn((_slug: string, change: Partial<WorkspaceSettings>) => {
    saved = { ...saved, ...change };
    return Promise.resolve(saved);
  });
  const data = {
    workspace: { update, delete: vi.fn(() => new Promise(() => undefined)) },
    workspaces: { slugAvailable: (slug: string) => Promise.resolve(slug !== TAKEN) },
  } as unknown as DataLayer;
  return { data, update, read: () => saved };
}

let shown: InApp | undefined;

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
  vi.restoreAllMocks();
});

/** The page for an owner (or, `asMember`, someone without workspace.manage), reading its settings back on a change. */
async function renderGeneral({ asMember = false }: { readonly asMember?: boolean } = {}) {
  const { data, update, read } = layer();
  const onMoved = vi.fn(() => Promise.resolve());
  const toasts = createToasts();
  function Page() {
    const [settings, setSettings] = useState(SAVED);
    return (
      <GeneralScreen
        data={data}
        toasts={toasts}
        slug="acme"
        settings={settings}
        mayManage={!asMember}
        mayDelete={!asMember}
        origin="https://app.timefix.test"
        onChanged={() => {
          setSettings(read());
          return Promise.resolve();
        }}
        onMoved={onMoved}
        onDeleted={() => undefined}
      />
    );
  }
  shown = await renderInApp(() => <Page />, {
    data,
    toasts,
    pattern: '/w/$slug/settings/general',
    at: '/w/acme/settings/general',
  });
  return { update, onMoved };
}

const nameField = () => page.getByRole('textbox', { name: strings.name });

describe('the name', () => {
  it('saves once when the field is left, with Name changed. and Undo', async () => {
    const { update } = await renderGeneral();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme Labs');
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('acme', { name: 'Acme Labs' });
    await userEvent.click(page.getByRole('button', { name: strings.undo }));
    await expect.element(nameField()).toHaveValue('Acme');
    expect(update).toHaveBeenLastCalledWith('acme', { name: 'Acme' });
  });

  it('refuses an empty name on the field and sends nothing', async () => {
    const { update } = await renderGeneral();
    await userEvent.clear(nameField());
    await userEvent.tab();
    await expect.element(page.getByText(strings.nameMissing)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
    // Typing again is the fix.
    await userEvent.type(nameField(), 'A');
    expect(page.getByText(strings.nameMissing).elements()).toEqual([]);
  });
});

describe('the web address', () => {
  it('shows the whole link, and Change opens the dialog, which waits for a free address', async () => {
    const { update, onMoved } = await renderGeneral();
    await expect.element(page.getByText('https://app.timefix.test/w/acme')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: strings.changeAddressLabel }));
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    await expect.element(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', { name: strings.webAddress });
    await expect.element(field).toHaveValue('acme');
    const change = dialog.getByRole('button', { name: strings.moveAction });
    await expect.element(change).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, TAKEN);
    await expect.element(dialog.getByText(strings.addressTaken, { exact: true })).toBeVisible();
    await expect.element(change).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'acme-labs');
    await expect.element(dialog.getByText(strings.addressFree, { exact: true })).toBeVisible();
    await expect.element(dialog.getByText(strings.moveText('acme', 'acme-labs'))).toBeVisible();
    await expect.element(change).toBeEnabled();
    await userEvent.click(change);
    await vi.waitFor(() => {
      expect(onMoved).toHaveBeenCalledWith('acme-labs');
    });
    expect(update).toHaveBeenCalledWith('acme', { slug: 'acme-labs' });
  });
});

describe('saving at once', () => {
  it('has no Save bar, and leaving asks nothing', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    await renderGeneral();
    await userEvent.type(nameField(), ' Labs');
    expect(page.getByRole('button', { name: 'Save' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: 'Discard' }).elements()).toEqual([]);
    // Elsewhere in the app, with the name changed and not yet left: nothing asks first.
    (shown?.router.history as RouterHistory | undefined)?.push('/w/acme/settings/members');
    await vi.waitFor(() => {
      expect(shown?.router.state.location.pathname).toBe('/w/acme/settings/members');
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('a member', () => {
  it('reads one note, and finds the fields locked with no Change', async () => {
    await renderGeneral({ asMember: true });
    await expect.element(page.getByText(strings.readOnly)).toBeVisible();
    expect(page.getByText(strings.readOnly).elements()).toHaveLength(1);
    await expect.element(nameField()).toHaveAttribute('readonly');
    expect(page.getByRole('button', { name: strings.changeAddressLabel }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: strings.deleteAction }).elements()).toEqual([]);
  });
});

describe('deleting', () => {
  it('says what happens in the open, with the export line and no help to open', async () => {
    await renderGeneral();
    await expect.element(page.getByText(strings.deleteRowText)).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: strings.deleteAction }));
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog.getByText(strings.deleteText)).toBeVisible();
    await expect.element(dialog.getByText(strings.exportFirst)).toBeVisible();
    expect(dialog.getByRole('button', { name: /^About/ }).elements()).toEqual([]);
  });
});

describe('General at 390', () => {
  for (const theme of THEMES) {
    it(`passes axe in ${theme}, for an owner and for a member`, async () => {
      await page.viewport(390, 844);
      applyTheme(theme);
      await renderGeneral();
      await expect.element(nameField()).toBeVisible();
      expect(await axeViolations()).toEqual([]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      shown?.unmount();
      await renderGeneral({ asMember: true });
      await expect.element(page.getByText(strings.readOnly)).toBeVisible();
      expect(await axeViolations()).toEqual([]);
    });
  }
});
