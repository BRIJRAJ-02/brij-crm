// Edit social links (the link page's and the booking editor's Social links card), in Chromium: its Save is the
// footer's primary, so it shows ⌘↵ beside Cancel's ESC, and ⌘↵ from the field just typed in saves the set (the owner,
// 5 November 2026: "no command enter").
import type { DataLayer, SocialLink, SocialLinksAccess, SocialLinksState } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { SocialsCard } from './SocialsCard.tsx';

const LINKS: readonly SocialLink[] = [{ network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace' }];

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

/** The card on a link page (no switch), with `change` standing in for the store's. */
async function mount(change: SocialLinksAccess['change']) {
  const state: SocialLinksState = { status: 'ready', links: LINKS, isSaving: false, canChange: true };
  const access: SocialLinksAccess = {
    of: () => ({
      subscribe: () => () => undefined,
      getSnapshot: () => state,
      retain: () => () => undefined,
      retry: () => undefined,
    }),
    change,
  };
  const data = { profile: { loadSocials: () => Promise.resolve(access) } } as unknown as DataLayer;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-GB" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <SocialsCard data={data} slug="acme" isTeam={false} isOwner onPreviewLinks={() => undefined} />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** The modifier ⌘↵ takes here (Meta on a Mac, Control elsewhere), read off the key the button states. */
async function modifierOf(button: Element): Promise<'Meta' | 'Control'> {
  const shortcut = await vi.waitFor(() => {
    const said = button.getAttribute('aria-keyshortcuts') ?? '';
    expect(said).toMatch(/^(Meta|Control)\+Enter$/u);
    return said;
  });
  return shortcut.startsWith('Meta') ? 'Meta' : 'Control';
}

describe('Edit social links', () => {
  it('shows ⌘↵ on Save and ESC on Cancel, and ⌘↵ from a field saves what was just typed', async () => {
    const change = vi.fn<SocialLinksAccess['change']>(() => Promise.resolve(true));
    await mount(change);
    await userEvent.click(page.getByRole('button', { name: 'Edit social links' }));
    const dialog = page.getByRole('dialog', { name: 'Social links' });
    await expect.element(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Save' });
    await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
    const mod = await modifierOf(save.element());

    const field = dialog.getByRole('textbox', { name: 'LinkedIn' });
    await userEvent.clear(field);
    await userEvent.type(field, 'ada-byron');
    await userEvent.keyboard(`{${mod}>}{Enter}{/${mod}}`);

    await vi.waitFor(() => {
      expect(change).toHaveBeenCalledTimes(1);
    });
    expect(change).toHaveBeenCalledWith('acme', [{ network: 'linkedin', href: 'https://linkedin.com/in/ada-byron' }]);
    await expect.element(page.getByRole('dialog', { name: 'Social links' })).not.toBeInTheDocument();
  });

  it('keeps a refused draft open on ⌘↵, as Save does', async () => {
    const change = vi.fn<SocialLinksAccess['change']>(() => Promise.resolve(true));
    await mount(change);
    await userEvent.click(page.getByRole('button', { name: 'Edit social links' }));
    const dialog = page.getByRole('dialog', { name: 'Social links' });
    const save = dialog.getByRole('button', { name: 'Save' });
    const mod = await modifierOf(save.element());
    const field = dialog.getByRole('textbox', { name: 'LinkedIn' });
    await userEvent.clear(field);
    await userEvent.type(field, 'https://example.com/not-linkedin');
    await userEvent.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(change).not.toHaveBeenCalled();
    await expect.element(page.getByRole('dialog', { name: 'Social links' })).toBeVisible();
  });
});
