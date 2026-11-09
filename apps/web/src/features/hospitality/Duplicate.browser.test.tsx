// Many businesses' dialogs in Chromium (spec 0065 H7): Duplicate to another business warns while the business picked
// prices in another currency and copies to the one picked (AC-6591); the switch guard asks before dropping unsaved
// changes, as a danger confirm, and answers no when its screen goes; a settings page says whose it is from two
// businesses. axe is clean in light and dark at a desktop's and a phone's width; with VITE_SHOT_DIR set, each is
// photographed there.
import '@crm/ui/styles.css';
import type {
  HospitalityHeld,
  HospitalityHeldState,
  HospitalityStore,
  PropertiesView,
  PropertySummary,
} from '@crm/data';
import { createToasts, TopBar } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { DuplicateToBusiness } from './DuplicateToBusiness.tsx';
import { ShownBusinessLink } from './ShownBusinessLink.tsx';
import { SwitchGuard } from './SwitchGuard.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const FIRST = '0192f0c8-0000-7000-8000-00000000d001';
const SECOND = '0192f0c8-0000-7000-8000-00000000d002';
const THIRD = '0192f0c8-0000-7000-8000-00000000d003';
const toasts = createToasts();

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

const PROPERTIES: readonly PropertySummary[] = [
  { id: FIRST, name: 'Harbour Café', kind: 'cafe', currency: 'GBP', position: 0, holds: 3 },
  { id: SECOND, name: 'Late Bar', kind: 'bar', currency: 'EUR', position: 1, holds: 1 },
  { id: THIRD, name: 'Dockside', kind: 'restaurant', currency: 'GBP', position: 2, holds: 0 },
];

/** A held copy, ready. */
function heldOf<Value>(value: Value): HospitalityHeld<Value> {
  const state: HospitalityHeldState<Value> = { status: 'ready', value, isSaving: false };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
}

/** The suite's store, as far as these dialogs read it: two or more businesses, the first chosen. */
function storeOf() {
  let guard: (() => Promise<boolean>) | undefined;
  const store = {
    properties: () => heldOf<PropertiesView>({ properties: [...PROPERTIES], canManage: true }),
    choice: () => heldOf<string | undefined>(undefined),
    guardChoice: (_slug: string, next: (() => Promise<boolean>) | undefined) => {
      guard = next;
    },
    dropGuard: (_slug: string, mine: () => Promise<boolean>) => {
      if (guard === mine) guard = undefined;
    },
  } as unknown as HospitalityStore;
  return { store, ask: () => guard?.() ?? Promise.resolve(true), hasGuard: () => guard !== undefined };
}

/** Waits for every running animation that ends, so axe and the picture see a dialog fully in. */
async function settle() {
  const ending = document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY);
  await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
}

async function shoot(name: string) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true } as never);
}

const at = { data: {}, pattern: '/w/$slug/menus', at: '/w/acme/menus' } as const;

describe('Duplicate to another business (AC-6591)', () => {
  it('warns while the business picked prices in another currency, and copies to it', async () => {
    const sent: string[] = [];
    shown = await renderInApp(
      () => (
        <DuplicateToBusiness
          isOpen
          onOpenChange={() => undefined}
          name="Dinner"
          others={PROPERTIES.slice(1)}
          currency="GBP"
          onDuplicate={(to) => {
            sent.push(to);
            return Promise.resolve(undefined);
          }}
          toasts={toasts}
        />
      ),
      at,
    );
    await expect.element(page.getByRole('dialog', { name: 'Duplicate Dinner' })).toBeVisible();
    await page.getByText('Dockside').click();
    await expect.element(page.getByText(/keeps the same numbers/)).not.toBeInTheDocument();
    await page.getByText('Late Bar').click();
    await expect.element(page.getByText(/Prices are in GBP here and EUR there/)).toBeVisible();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    expect(sent).toEqual([SECOND]);
  });
});

describe('the switch guard', () => {
  it('asks before dropping unsaved changes, and answers no once its screen goes', async () => {
    const { store, ask, hasGuard } = storeOf();
    shown = await renderInApp(
      () => <SwitchGuard store={store} slug="acme" isDirty text="Your design changes aren’t saved." />,
      at,
    );
    const answer = ask();
    await expect.element(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
    shown.unmount();
    shown = undefined;
    expect(await answer).toBe(false);
    expect(hasGuard()).toBe(false);
  });
});

describe('axe and the pictures', () => {
  for (const theme of THEMES) {
    for (const width of [1280, 390]) {
      it(`is clean in ${theme} at ${String(width)}`, async () => {
        await page.viewport(width, 900);
        applyTheme(theme);
        shown = await renderInApp(
          () => (
            <DuplicateToBusiness
              isOpen
              onOpenChange={() => undefined}
              name="Dinner"
              others={PROPERTIES.slice(1)}
              currency="GBP"
              onDuplicate={() => Promise.resolve(undefined)}
              toasts={toasts}
            />
          ),
          at,
        );
        await page.getByText('Late Bar').click();
        await settle();
        expect(await axeViolations()).toEqual([]);
        await shoot(`duplicate-${theme}-${String(width)}`);
        shown.unmount();
        const { store, ask } = storeOf();
        shown = await renderInApp(
          () => (
            <>
              <TopBar title="Services" meta={<ShownBusinessLink hospitality={store} slug="acme" />} />
              <SwitchGuard store={store} slug="acme" isDirty text="Your design changes aren’t saved." />
            </>
          ),
          { data: {}, pattern: '/w/$slug/settings/services', at: '/w/acme/settings/services' },
        );
        await expect.element(page.getByRole('link', { name: 'For Harbour Café' })).toBeVisible();
        void ask();
        await expect.element(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
        await settle();
        expect(await axeViolations()).toEqual([]);
        await shoot(`switch-guard-${theme}-${String(width)}`);
      });
    }
  }
});
