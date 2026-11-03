// Who a link page is from (3 Nov 2026) in Chromium: the job title's switch is off until there is a title to show,
// each field saves when it is left and only when it changed, what the server kept (the checked address) lands in
// the field, and a refusal stays on its own field with what was typed still there. Checked by axe in both themes.
import '@crm/ui/styles.css';
import { dataError, type DataLayer, type MyProfile } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { IdentityCard, type PageIdentity } from './IdentityCard.tsx';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

const OFF: PageIdentity = { showJobTitle: false, site: '', footLine: '' };

/** The card, with a data layer whose profile update is `update`, and what it reported saved. */
async function render(update: (slug: string, change: object) => Promise<MyProfile>, jobTitle?: string) {
  const saved: PageIdentity[] = [];
  shown = await renderInApp(
    () => (
      <main>
        <IdentityCard
          data={{ profile: { update } } as unknown as DataLayer}
          slug="acme"
          jobTitle={jobTitle}
          identity={OFF}
          onSaved={(identity) => saved.push(identity)}
        />
      </main>
    ),
    { data: {}, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
  );
  return saved;
}

const profile = (fields: Partial<MyProfile>) => ({ bio: '', ...fields }) as MyProfile;

describe('who the page is from', () => {
  it('keeps the job title switch off until there is a title, and says where to add one', async () => {
    await render(vi.fn());
    const toggle = page.getByRole('switch', { name: 'Show my job title' });
    await expect.element(toggle).toBeDisabled();
    await expect.element(page.getByText('Add a job title in Profile first.')).toBeVisible();
  });

  it('saves the switch at once, with the title it will show beside it', async () => {
    const update = vi.fn((_slug: string, _change: object) => Promise.resolve(profile({ showJobTitle: true })));
    const saved = await render(update, 'Head of partnerships');
    await expect.element(page.getByText('Head of partnerships, here and on your booking pages')).toBeVisible();
    // The switch's input is visually hidden under its track, as React Aria draws it.
    await userEvent.click(page.getByRole('switch', { name: 'Show my job title' }), { force: true });
    expect(update).toHaveBeenCalledWith('acme', { showJobTitle: true });
    await vi.waitFor(() => expect(saved).toEqual([{ showJobTitle: true, site: '', footLine: '' }]));
  });

  it('saves a field when it is left, shows the address as kept, and sends nothing for no change', async () => {
    const update = vi.fn((_slug: string, _change: object) =>
      Promise.resolve(profile({ showJobTitle: false, site: 'https://acme.com/' })),
    );
    await render(update);
    const site = page.getByRole('textbox', { name: 'Company site' });
    await userEvent.click(site);
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
    await userEvent.fill(site, 'acme.com');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('acme', { site: 'acme.com' });
    await expect.element(site).toHaveValue('https://acme.com/');
  });

  it('keeps a refusal on its own field, with what was typed still there', async () => {
    await render(() =>
      Promise.reject(dataError('CONFIG_INVALID', 'Use a link that starts with https://, like https://acme.com.')),
    );
    const site = page.getByRole('textbox', { name: 'Company site' });
    await userEvent.fill(site, 'http://acme.com');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Use a link that starts with https://, like https://acme.com.')).toBeVisible();
    await expect.element(site).toHaveValue('http://acme.com');
  });

  it.each(THEMES)('passes axe in %s', async (theme) => {
    await render(vi.fn(), 'Head of partnerships');
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });
});
