// New booking page in Chromium (spec 0058): it asks for a title and a length only and makes a page on the default
// schedule (AC-17), then turns to the Ready panel with the link, Copy, Share, its QR code and a small preview (AC-5),
// left in one action for the editor. Axe clean in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type { BookingPageView, DataLayer, RotationView } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { NewPageDialog } from './NewPageDialog.tsx';
import { strings } from './strings.ts';

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** A held list that never changes. */
function held<T>(state: T) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: vi.fn(),
  };
}

const MADE = {
  id: '0199a6f2-0000-7000-8000-0000000000p1',
  title: 'Intro call',
  slug: 'intro-call',
  description: '',
  durations: [45],
  location: { type: 'video' },
  status: 'live',
  isPrivate: false,
  kind: 'personal',
  scope: 'member',
  publicKey: 'k3x9k3x9k3x9k3x9',
  canChange: true,
  bookingsThisMonth: 0,
  scheduleId: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
} as unknown as BookingPageView;

async function render() {
  const create = vi.fn(() => Promise.resolve(MADE));
  const data = {
    preferences: { of: () => held({ status: 'loading' as const }) },
    rotations: {
      view: () => held({ status: 'ready' as const, items: [] as RotationView[], pendingIds: new Set<string>() }),
    },
    bookingPages: { newId: () => MADE.id, create },
  } as unknown as DataLayer;
  const onCreated = vi.fn();
  shown = await renderInApp(
    () => <NewPageDialog data={data} slug="acme" isOpen onClose={() => undefined} onCreated={onCreated} />,
    { data, pattern: '/w/$slug/captures/links', at: '/w/acme/captures/links' },
  );
  return { create, onCreated };
}

/** Axe in both themes, with every entrance settled first. */
async function checkThemes(name: string) {
  for (const theme of THEMES) {
    applyTheme(theme);
    for (const animation of document.getAnimations()) animation.finish();
    expect(await axeViolations(), `${name} in ${theme}`).toEqual([]);
  }
}

describe('New booking page', () => {
  it('asks for a title and a length only, and makes the page on the default schedule (AC-17)', async () => {
    const { create, onCreated } = await render();
    const dialog = page.getByRole('dialog', { name: strings.addPage });
    await expect.element(dialog.getByRole('textbox', { name: strings.title })).toHaveFocus();
    // No schedule to pick, and no hint lines: the page follows the default.
    expect(dialog.getByText('Schedule', { exact: true }).elements()).toHaveLength(0);
    expect(dialog.getByRole('button', { name: /Schedule/ }).elements()).toHaveLength(0);
    await checkThemes('new-page');
    await userEvent.fill(dialog.getByRole('textbox', { name: strings.title }), 'Intro call');
    await userEvent.click(dialog.getByRole('radio', { name: strings.minutesShort(45) }), { force: true });
    await userEvent.click(dialog.getByRole('button', { name: strings.createPage }));
    expect(create).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ title: 'Intro call', settings: { durations: [45], scheduleId: null } }),
    );
    // The editor waits until the Ready panel is left.
    await expect.element(page.getByRole('heading', { name: strings.readyTitle })).toBeVisible();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the Ready panel with the link, Copy, QR and a preview, left in one action (AC-5)', async () => {
    const { onCreated } = await render();
    await userEvent.fill(page.getByRole('textbox', { name: strings.title }), 'Intro call');
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    const ready = page.getByRole('dialog', { name: 'Intro call' });
    await expect.element(ready.getByRole('heading', { name: strings.readyTitle })).toBeVisible();
    await expect.element(ready.getByText(`${location.origin}/b/k3x9k3x9k3x9k3x9`)).toBeVisible();
    await expect.element(ready.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect.element(ready.getByRole('img', { name: 'QR code for the link' })).toBeVisible();
    await expect.element(ready.getByRole('group', { name: strings.readyPreview })).toBeVisible();
    expect(ready.getByTitle('Preview of Intro call').elements()).toHaveLength(1);
    await checkThemes('ready');
    await userEvent.click(ready.getByRole('button', { name: strings.readyEdit }));
    expect(onCreated).toHaveBeenCalledWith(MADE);
  });

  it('goes on to the editor when the Ready panel is closed with Escape', async () => {
    const { onCreated } = await render();
    await userEvent.fill(page.getByRole('textbox', { name: strings.title }), 'Intro call');
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    await expect.element(page.getByRole('heading', { name: strings.readyTitle })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(MADE));
  });
});
