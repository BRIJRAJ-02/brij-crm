// Settings › Brand in Chromium (spec 0060, AC-1, AC-3, AC-6): an owner picks the colour and the booking page preview
// wears it at once, with the same variables the page's stylesheet sets; a member reads the kit with no way to change
// it; and axe is clean in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type { BrandHeldState, BrandKit, BrandStore } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { BrandScreen } from './BrandScreen.tsx';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** A brand store holding one kit, which `saveKit` changes at once as the real one shows a change. */
function store(kit: BrandKit) {
  let state: BrandHeldState<BrandKit> = { status: 'ready', value: kit, isSaving: false };
  const listeners = new Set<() => void>();
  const saveKit = vi.fn((_slug: string, accent?: string) => {
    state = {
      status: 'ready',
      value: { ...kit, ...(accent === undefined ? {} : { accent }) },
      isSaving: false,
    };
    for (const listener of listeners) listener();
    return Promise.resolve(undefined);
  });
  const held = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
  const brand = {
    kit: () => held,
    saveKit,
    colours: (accent?: string) =>
      accent === undefined
        ? undefined
        : {
            variables: [
              ['--brand-accent', '#e65708'],
              ['--brand-on-accent', '#000000'],
              ['--brand-link', '#b74300'],
              ['--brand-accent-dark', '#e8590c'],
              ['--brand-on-accent-dark', '#000000'],
              ['--brand-link-dark', '#fd6c2b'],
            ],
            adjusted: false,
            light: '#e65708',
            dark: '#e8590c',
          },
    quickPicks: [{ hue: 'orange', value: '#fb8f3c' }],
    logoSrc: () => undefined,
  } as unknown as BrandStore;
  return { brand, saveKit };
}

async function render(brand: BrandStore) {
  shown = await renderInApp(
    () => <BrandScreen brand={brand} slug="acme" toasts={{ toast: () => undefined } as never} />,
    {
      data: {},
      pattern: '/w/$slug/settings/brand',
      at: '/w/acme/settings/brand',
    },
  );
}

describe('Settings › Brand', () => {
  it('lets an owner pick the colour, and the booking page preview wears it at once', async () => {
    const { brand, saveKit } = store({ canEdit: true });
    await render(brand);
    await expect.element(page.getByRole('radio', { name: 'Timefix' })).toBeChecked();
    (page.getByRole('radio', { name: 'Timefix' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(saveKit).toHaveBeenLastCalledWith('acme', '#fb8f3c', undefined);
    // The preview's root takes the very variables the live page's brand stylesheet sets (AC-7).
    const root = document.querySelector<HTMLElement>('main[class*="booking-frame"], [class*="booking-frame-root"]');
    await expect.poll(() => root?.style.getPropertyValue('--brand-accent')).toBe('#e65708');
  });

  it('shows a member the kit with no way to change it', async () => {
    const { brand } = store({ canEdit: false, accent: '#0fc27b' });
    await render(brand);
    await expect.element(page.getByText('Only owners and admins change the brand.')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Any colour' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add your logo' })).not.toBeInTheDocument();
  });

  it.each(THEMES)('is clean under axe in %s', async (theme) => {
    applyTheme(theme);
    const { brand } = store({ canEdit: true, accent: '#e8590c' });
    await render(brand);
    await expect.element(page.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});
