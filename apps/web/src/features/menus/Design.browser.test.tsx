// The Design page in Chromium (spec 0065, AC-6570 as amended): picking a preset paints the real guest menu at once,
// a colour nobody can read says so and still draws readable words, Save goes through the store, a refusal keeps what's
// on screen, and someone who can't edit sees it read only. axe is clean in light and dark at a desktop's and a phone's
// width.
import '@crm/ui/app.css';
import type { HospitalityHeld, HospitalityHeldState, MenuDraft, MenuLook, MenuStore } from '@crm/data';
import { contrastRatio } from '@crm/data/menu';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { DesignScreen } from './DesignScreen.tsx';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PLACE = id(1);

const DRAFT: MenuDraft = {
  currency: 'GBP',
  look: { preset: 'warm', heading: 'device', body: 'device', radius: 'soft' },
  lookAccents: {},
  places: [{ id: PLACE, name: 'Soho', menuKey: 'AbCdEfGhIjKlMnOp', timeZone: 'Europe/London', locale: 'en-GB' }],
  menus: [],
  sections: [],
  items: [],
  groups: [],
  changes: 0,
  hidden: false,
  photos: 0,
  canEdit: true,
};

function heldOf(draft: MenuDraft): HospitalityHeld<MenuDraft> {
  const state: HospitalityHeldState<MenuDraft> = { status: 'ready', value: draft, isSaving: false };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
}

function storeOf(draft: MenuDraft, refusal?: string) {
  const saved: MenuLook[] = [];
  const store = {
    draft: () => heldOf(draft),
    saveLook: (_workspace: string, look: MenuLook) => {
      saved.push(look);
      return Promise.resolve(refusal === undefined ? undefined : { code: 'CONFLICT', message: refusal });
    },
  } as unknown as MenuStore;
  return { store, saved };
}

const toasts = { toast: () => undefined } as never;

let app: InApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  resetTheme();
});

/** Every animation that ends has ended, so a contrast check never reads a bar on its way in. */
async function settled() {
  await expect
    .poll(() =>
      document
        .getAnimations()
        .every((each) => each.playState !== 'running' || each.effect?.getTiming().iterations === Infinity),
    )
    .toBe(true);
}

async function open(draft: MenuDraft = DRAFT, refusal?: string) {
  await page.viewport(1280, 900);
  const made = storeOf(draft, refusal);
  app = await renderInApp(
    () => <DesignScreen store={made.store} slug="somewhere" toasts={toasts} businessName="Somewhere Nowhere" />,
    {
      data: {},
      pattern: '/w/$slug/menus/design',
      at: '/w/somewhere/menus/design',
    },
  );
  await expect.element(page.getByRole('heading', { name: 'Design', level: 1 })).toBeVisible();
  return made;
}

/** A custom property of the guest menu in the phone, as the browser computes it. */
function menuVariable(name: string): string {
  const menu = document.querySelector('[data-menu-list]');
  if (menu === null) throw new Error('No guest menu in the phone.');
  return getComputedStyle(menu).getPropertyValue(name).trim();
}

describe('the Design page', () => {
  it('draws the real guest menu in the look picked, before anything is saved', async () => {
    const { saved } = await open();
    await expect.element(page.getByText('Roast chicken').first()).toBeVisible();
    expect(menuVariable('--menu-ground')).toBe('#ffffff');
    await page.getByRole('radio', { name: 'Noir' }).click();
    await expect.poll(() => menuVariable('--menu-ground')).toBe('#0a0a0a');
    expect(menuVariable('--menu-accent')).toBe('#d4af37');
    expect(document.querySelector('[data-menu-list]')?.getAttribute('data-theme')).toBe('dark');
    expect(saved).toEqual([]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toEqual({ preset: 'noir', heading: 'grotesk', body: 'grotesk', radius: 'square' });
  });

  it('shows the Light and Dark switch only for a look that follows the guest', async () => {
    await open();
    await expect.element(page.getByRole('radiogroup', { name: 'Guest’s light or dark' })).toBeVisible();
    await page.getByText('Dark', { exact: true }).click();
    await expect.poll(() => menuVariable('--menu-ground')).toBe('#141414');
    await page.getByRole('radio', { name: 'Noir' }).click();
    await expect.element(page.getByRole('radiogroup', { name: 'Guest’s light or dark' })).not.toBeInTheDocument();
  });

  it('says a colour fails AA, and still draws words a guest can read', async () => {
    await open();
    await expect.element(page.getByText('Some colours are hard to read')).not.toBeInTheDocument();
    // The hex fields in the page's order: Page, Text, Buttons, Prices.
    await page.getByRole('textbox', { name: 'Hex' }).nth(1).fill('#eeeeee');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Some colours are hard to read')).toBeVisible();
    await expect.element(page.getByText(/^Fails AA/)).toBeVisible();
    await expect
      .poll(() => contrastRatio(menuVariable('--menu-text'), menuVariable('--menu-ground')))
      .toBeGreaterThanOrEqual(4.5);
  });

  it('gives a yellow button a readable label', async () => {
    await open();
    await page.getByRole('textbox', { name: 'Hex' }).nth(2).fill('#ffff00');
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => contrastRatio(menuVariable('--menu-on-accent'), menuVariable('--menu-accent')))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(menuVariable('--menu-accent'), menuVariable('--menu-ground'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps what’s on screen and says why when Save is refused', async () => {
    const { saved } = await open(DRAFT, 'Add your business first, then you can design its menu.');
    await page.getByRole('radio', { name: 'Linen' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    await expect.element(page.getByText('Add your business first, then you can design its menu.')).toBeVisible();
    expect(menuVariable('--menu-ground')).toBe('#f8f6f1');
  });

  it('names the colour each empty hex field stands for', async () => {
    await open();
    await expect.element(page.getByRole('textbox', { name: 'Hex' }).nth(0)).toHaveAttribute('placeholder', '#ffffff');
    await page.getByRole('radio', { name: 'Noir' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Hex' }).nth(2)).toHaveAttribute('placeholder', '#d4af37');
  });

  it('warns on the dark side too, for a look that follows the guest', async () => {
    await open();
    // Navy passes on Warm's white and fails on its near black.
    await page.getByRole('textbox', { name: 'Hex' }).nth(2).fill('#000033');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Some colours are hard to read')).toBeVisible();
  });

  it('offers Undo when a preset replaces colours picked by hand', async () => {
    const said: { action?: { onAction: () => void } }[] = [];
    const made = storeOf(DRAFT);
    app = await renderInApp(
      () => (
        <DesignScreen
          store={made.store}
          slug="somewhere"
          toasts={{ toast: (each: (typeof said)[number]) => said.push(each) } as never}
          businessName="Somewhere Nowhere"
        />
      ),
      { data: {}, pattern: '/w/$slug/menus/design', at: '/w/somewhere/menus/design' },
    );
    await page.viewport(1280, 900);
    await page.getByRole('textbox', { name: 'Hex' }).nth(3).fill('#c2410c');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => menuVariable('--menu-highlight')).toBe('#c2410c');
    await page.getByRole('radio', { name: 'Noir' }).click();
    await expect.poll(() => said.length).toBe(1);
    await expect.poll(() => menuVariable('--menu-ground')).toBe('#0a0a0a');
    said[0]?.action?.onAction();
    await expect.poll(() => menuVariable('--menu-highlight')).toBe('#c2410c');
  });

  it('says what’s missing before an owner with no business does any work', async () => {
    const made = storeOf(DRAFT);
    app = await renderInApp(
      () => <DesignScreen store={made.store} slug="somewhere" toasts={toasts} businessName="" hasBusiness={false} />,
      { data: {}, pattern: '/w/$slug/menus/design', at: '/w/somewhere/menus/design' },
    );
    await expect.element(page.getByText('Add your business first').first()).toBeVisible();
  });

  it('is read only to someone who can’t edit', async () => {
    await open({ ...DRAFT, canEdit: false });
    await expect.element(page.getByRole('radio', { name: 'Noir' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it.each(THEMES)('has no axe violations in %s at a desktop’s and a phone’s width', async (theme) => {
    applyTheme(theme);
    await open();
    await settled();
    expect(await axeViolations()).toEqual([]);
    await page.getByRole('radio', { name: 'Ronin' }).click();
    await settled();
    expect(await axeViolations()).toEqual([]);
    await page.viewport(390, 844);
    await settled();
    expect(await axeViolations()).toEqual([]);
  });
});
