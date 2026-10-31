// Settings › General in Chromium, saving at once (SS-G1 to SS-G4): a rename saves when the field is left (once, even
// after Enter, and once while it is on its way) with "Name changed." and Undo, one toast at a time whose Undo puts
// back only the last rename (Q99), closes on leaving, and undoes nothing once the server holds a newer name (after
// coming back, or another admin's); an empty name is refused on the field and nothing is sent; a refused name stays in the field with the reason, said in a toast too, as is one lost for
// another reason; Change opens the address dialog with its field focused, checked as typed, and Change address waits
// for a free one, said once the page opened there; once an address is typed a click outside keeps the dialog; a move
// whose page couldn't open says where it went (announced, focus on Close), sends nothing more, says no "now at", and
// leaves General locked with the same warning and Reload at the top; there is no Save bar and no browser
// confirm on leaving, and a name still typed then is saved; a member reads one note and finds the fields locked; the
// delete confirm says what happens in the open; axe is clean at 390 in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import { dataError, type DataLayer, type WorkspaceSettings } from '@crm/data';
import { createToasts, sharedStrings, type ToastContent, type Toasts } from '@crm/ui';
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

/** How the server answers a rename: with the settings it would save, or not. */
type Answer = (next: WorkspaceSettings) => Promise<WorkspaceSettings>;

/** A data layer holding the workspace's settings, which its update changes as the server would and its get reads;
 * `answer`, when given, stands in for the server on a rename (one held on its way, or refused), and `write` is another
 * admin's change, which this page isn't told of. */
function layer(answer?: Answer) {
  let saved = SAVED;
  const update = vi.fn((_slug: string, change: Partial<WorkspaceSettings>) => {
    if (answer !== undefined && change.name !== undefined) {
      return answer({ ...saved, ...change }).then((next) => {
        saved = next;
        return next;
      });
    }
    saved = { ...saved, ...change };
    return Promise.resolve(saved);
  });
  const get = vi.fn(() => Promise.resolve(saved));
  const data = {
    workspace: { get, update, delete: vi.fn(() => new Promise(() => undefined)) },
    workspaces: { slugAvailable: (slug: string) => Promise.resolve(slug !== TAKEN) },
  } as unknown as DataLayer;
  return {
    data,
    update,
    read: () => saved,
    write: (change: Partial<WorkspaceSettings>) => {
      saved = { ...saved, ...change };
    },
  };
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

/** The page for an owner (or, `asMember`, someone without workspace.manage), reading its settings back on a change;
 * `answer` answers a rename, and `isMoveLost` has the page fail to open at a new address. `raised` holds every toast
 * raised, so a test can press an Undo the screen has closed; `remount` leaves General and comes back. */
async function renderGeneral({
  asMember = false,
  answer,
  isMoveLost = false,
}: { readonly asMember?: boolean; readonly answer?: Answer; readonly isMoveLost?: boolean } = {}) {
  const { data, update, read, write } = layer(answer);
  const onMoved = vi.fn(() => (isMoveLost ? Promise.reject(new Error('The page didn’t load.')) : Promise.resolve()));
  const queue = createToasts();
  const raised: ToastContent[] = [];
  const toasts: Toasts = {
    ...queue,
    toast: (content, options) => {
      raised.push(content);
      return queue.toast(content, options);
    },
  };
  let remount: () => void = () => undefined;
  function Page() {
    const [settings, setSettings] = useState(SAVED);
    const [mount, setMount] = useState(0);
    remount = () => {
      setMount((was) => was + 1);
    };
    return (
      <GeneralScreen
        key={mount}
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
  return {
    update,
    onMoved,
    write,
    raised,
    remount: () => {
      remount();
    },
  };
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

  it('keeps one Name changed. toast, whose Undo puts back only the last rename (Q99)', async () => {
    const { update } = await renderGeneral();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme B');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme C');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => update.mock.calls.length).toBe(2);
    // The first toast went when the second came, so no older Undo is left to press.
    await expect.poll(() => page.getByText(strings.nameChanged).elements().length).toBe(1);
    expect(page.getByRole('button', { name: strings.undo }).elements()).toHaveLength(1);
    await userEvent.click(page.getByRole('button', { name: strings.undo }));
    await expect.element(nameField()).toHaveValue('Acme B');
    expect(update).toHaveBeenLastCalledWith('acme', { name: 'Acme B' });
  });

  it('closes the Undo on leaving, and an old Undo pressed after coming back undoes nothing (Q99)', async () => {
    const { update, raised, remount } = await renderGeneral();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme B');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    remount();
    await expect.poll(() => page.getByRole('button', { name: strings.undo }).elements().length).toBe(0);
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme C');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => update.mock.calls.length).toBe(2);
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    // The first rename's Undo, pressed as if its toast had stayed: the server holds Acme C, so nothing is sent.
    raised.find((each) => each.message === strings.nameChanged)?.action?.onAction();
    await expect.element(page.getByText(strings.undoStale)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(2);
    await expect.element(nameField()).toHaveValue('Acme C');
  });

  it('undoes nothing once another admin renamed it since, though the page still shows this rename', async () => {
    const { update, write } = await renderGeneral();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme Labs');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    write({ name: 'Acme Other' });
    await userEvent.click(page.getByRole('button', { name: strings.undo }));
    await expect.element(page.getByText(strings.undoStale)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('sends a rename once while it is on its way, then says so', async () => {
    let release: () => void = () => undefined;
    const { update } = await renderGeneral({
      answer: (next) =>
        new Promise((resolve) => {
          release = () => {
            resolve(next);
          };
        }),
    });
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme Labs');
    await userEvent.keyboard('{Enter}');
    // Still on its way when the field is left: not sent again.
    await userEvent.tab();
    expect(update).toHaveBeenCalledTimes(1);
    release();
    await expect.element(page.getByText(strings.nameChanged)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    await expect.element(nameField()).toHaveValue('Acme Labs');
  });

  it('keeps a refused name in the field, with the reason under it and in a toast', async () => {
    const reason = 'Use 1 to 64 characters for the name.';
    await renderGeneral({
      answer: () =>
        Promise.reject(
          dataError('CONFIG_INVALID', reason, {
            refusals: [{ code: 'CONFIG_INVALID', message: reason, field: 'name' }],
          }),
        ),
    });
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme Labs');
    await userEvent.tab();
    // On the field, and in a toast, said even though focus has left the field.
    await vi.waitFor(() => {
      expect(page.getByText(reason).elements()).toHaveLength(2);
    });
    await expect.element(nameField()).toHaveValue('Acme Labs');
    expect(page.getByText(strings.nameChanged).elements()).toEqual([]);
  });

  it('says a rename lost for another reason as a toast too, as focus has left the field', async () => {
    await renderGeneral({ answer: () => Promise.reject(new Error('Failed to fetch')) });
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme Labs');
    await userEvent.tab();
    await expect.element(page.getByText(sharedStrings.couldntDoThat)).toBeVisible();
    await expect.element(page.getByText(strings.nameNotSaved)).toBeVisible();
    await expect.element(nameField()).toHaveValue('Acme Labs');
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
    // Typing the address is the dialog's one job.
    await expect.element(field).toHaveFocus();
    const change = dialog.getByRole('button', { name: strings.moveAction });
    await expect.element(change).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, TAKEN);
    await expect.element(dialog.getByText(strings.addressTaken, { exact: true })).toBeVisible();
    await expect.element(change).toBeDisabled();
    // No "moves to" an address it can't move to.
    expect(dialog.getByText(strings.moveFromTo('acme', TAKEN)).elements()).toEqual([]);
    await expect.element(dialog.getByText(strings.oldLinksWork)).toBeVisible();

    await userEvent.clear(field);
    await userEvent.type(field, 'acme-labs');
    await expect.element(dialog.getByText(strings.addressFree, { exact: true })).toBeVisible();
    await expect.element(dialog.getByText(strings.moveFromTo('acme', 'acme-labs'))).toBeVisible();
    await expect.element(change).toBeEnabled();
    await userEvent.click(change);
    await vi.waitFor(() => {
      expect(onMoved).toHaveBeenCalledWith('acme-labs');
    });
    expect(update).toHaveBeenCalledWith('acme', { slug: 'acme-labs' });
    // Said once the page opened there.
    await expect.element(page.getByText(strings.moved('acme-labs'))).toBeVisible();
  });

  it('keeps the dialog on a click outside once an address is typed', async () => {
    await renderGeneral();
    const open = page.getByRole('button', { name: strings.changeAddressLabel });
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    // The page's corner, under the scrim (the page behind a modal is hidden from roles).
    const clickOutside = () => userEvent.click(page.elementLocator(document.body), { position: { x: 4, y: 4 } });
    // Nothing typed: a click outside closes it, so the click does reach outside.
    await userEvent.click(open);
    await expect.element(dialog).toBeVisible();
    await clickOutside();
    await expect.element(dialog).not.toBeInTheDocument();

    await userEvent.click(open);
    const field = dialog.getByRole('textbox', { name: strings.webAddress });
    await userEvent.clear(field);
    await userEvent.type(field, 'acme-labs');
    await clickOutside();
    await expect.element(dialog).toBeVisible();
    await expect.element(field).toHaveValue('acme-labs');
  });

  it('says where it went when the page couldn’t open there, and sends nothing more', async () => {
    const { update } = await renderGeneral({ isMoveLost: true });
    await userEvent.click(page.getByRole('button', { name: strings.changeAddressLabel }));
    const dialog = page.getByRole('dialog', { name: strings.moveTitle });
    const field = dialog.getByRole('textbox', { name: strings.webAddress });
    await userEvent.clear(field);
    await userEvent.type(field, 'acme-labs');
    const change = dialog.getByRole('button', { name: strings.moveAction });
    await expect.element(change).toBeEnabled();
    await userEvent.click(change);
    // Announced, and focus on Close rather than lost from the now disabled Change address.
    const warning = dialog.getByRole('status').filter({ hasText: strings.movedReload('acme-labs') });
    await expect.element(warning).toBeVisible();
    expect(dialog.getByText(sharedStrings.couldntDoThat).elements()).toEqual([]);
    await expect.element(change).toBeDisabled();
    // The footer's Close, which has words; the title bar's has only its icon.
    const close = dialog.getByRole('button', { name: strings.close, exact: true }).filter({ hasText: strings.close });
    await expect.element(close).toHaveFocus();
    expect(dialog.getByRole('button', { name: strings.cancel, exact: true }).elements()).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
    // It never says it is now there.
    expect(page.getByText(strings.moved('acme-labs'), { exact: true }).elements()).toEqual([]);

    // Closed, General keeps the same warning with Reload, which takes focus, and stays locked until then.
    await userEvent.click(close);
    await expect.element(dialog).not.toBeInTheDocument();
    const onPage = page.getByRole('status').filter({ hasText: strings.movedReload('acme-labs') });
    await expect.element(onPage).toBeVisible();
    const reload = onPage.getByRole('button', { name: strings.reload });
    await expect.element(reload).toHaveFocus();
    await expect.element(nameField()).toHaveAttribute('readonly');
    await expect.element(page.getByRole('button', { name: strings.changeAddressLabel })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: strings.deleteAction })).toBeDisabled();
    expect(page.getByText(strings.moved('acme-labs'), { exact: true }).elements()).toEqual([]);
  });
});

describe('saving at once', () => {
  it('has no Save bar, leaving asks nothing, and a name still typed is saved', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { update } = await renderGeneral();
    await userEvent.type(nameField(), ' Labs');
    expect(page.getByRole('button', { name: 'Save' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: 'Discard' }).elements()).toEqual([]);
    // Elsewhere in the app, with the name changed and not yet left: nothing asks first.
    (shown?.router.history as RouterHistory | undefined)?.push('/w/acme/settings/members');
    await vi.waitFor(() => {
      expect(shown?.router.state.location.pathname).toBe('/w/acme/settings/members');
    });
    expect(confirm).not.toHaveBeenCalled();
    // Saved as leaving the field would, whether or not the browser said it was left.
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('acme', { name: 'Acme Labs' });
    });
    expect(update).toHaveBeenCalledTimes(1);
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
    // Typing the name is its one task: the field has focus as it opens (Q102).
    await expect.element(dialog.getByRole('textbox', { name: strings.typeName('Acme') })).toHaveFocus();
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
