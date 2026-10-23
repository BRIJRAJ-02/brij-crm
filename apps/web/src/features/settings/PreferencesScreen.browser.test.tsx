// Preferences in Chromium (spec 0026; SA12 to SA16): the plain labels (Automatic, Only on this browser, Home, the
// Time zone InfoTip, no line under Sidebar), and the Setup checklist switch saving like every select, with the
// "Preferences saved" toast whose Undo puts it back.
import type { MemberPreferences, PreferencesChange, PreferencesState } from '@crm/data';
import { createToasts } from '@crm/ui';
import type { ThemeController } from '@crm/ui/theme';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { PreferencesScreen } from './PreferencesScreen.tsx';

const START: MemberPreferences = { dateFormat: 'auto', weekStart: 'auto', landing: { kind: 'home' } };

const theme = {
  get: () => 'system',
  set: () => undefined,
  subscribe: () => () => undefined,
} as unknown as ThemeController;

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The page over preferences the test's own store holds: each change shows at once and lands. */
async function render() {
  const changes: PreferencesChange[] = [];
  const toasts = createToasts();
  function Harness() {
    const [preferences, setPreferences] = useState<MemberPreferences>(START);
    const state: PreferencesState = { status: 'ready', preferences };
    return (
      <PreferencesScreen
        theme={theme}
        preferences={state}
        objects={[]}
        onChange={(change) => {
          changes.push(change);
          setPreferences((was) => ({ ...was, ...change }) as MemberPreferences);
          return Promise.resolve(true);
        }}
        toasts={toasts}
        onRetry={() => undefined}
        customiseSidebar={<span>Customise</span>}
      />
    );
  }
  shown = await renderInApp(() => <Harness />, {
    data: {},
    pattern: '/w/$slug/settings/account/preferences',
    at: '/w/acme/settings/account/preferences',
    toasts,
  });
  return changes;
}

describe('Preferences', () => {
  it('reads in plain words', async () => {
    await render();
    await expect.element(page.getByText('Only on this browser.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'About Time zone' })).toBeVisible();
    await expect.element(page.getByText('Where this workspace opens.')).toBeVisible();
    await expect.element(page.getByText('The steps left to set up this workspace, at the top of Home.')).toBeVisible();
    await expect.element(page.getByText('Show, hide or reorder what’s in your sidebar.')).toBeVisible();
    await expect.element(page.getByText('Kept for you on every device.')).not.toBeInTheDocument();
    // The theme's default and the start page's first choice, as their selects show them.
    await expect.element(page.getByText('Automatic', { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText('Home', { exact: true }).first()).toBeVisible();
  });

  it('saves the Setup checklist switch with a toast whose Undo puts it back', async () => {
    const changes = await render();
    const checklist = page.getByRole('switch', { name: 'Setup checklist on Home' });
    await expect.element(checklist).toBeChecked();
    (checklist.element() as HTMLElement).focus();
    await userEvent.keyboard('[Space]');
    await expect.element(checklist).not.toBeChecked();
    await expect.element(page.getByText('Preferences saved')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(checklist).toBeChecked();
    await expect.element(page.getByText('Change undone')).toBeVisible();
    expect(changes).toEqual([{ homeHidden: ['setup'] }, { homeHidden: [] }]);
  });
});
