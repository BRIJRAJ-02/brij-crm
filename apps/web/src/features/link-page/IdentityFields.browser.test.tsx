// Who a link page is from (3 Nov 2026; 9 Nov 2026, name and title) in Chromium: the name and the title under it change
// right in the editor, a title typed there turns on and one cleared turns off, the switch shows only with a title to
// show, each field saves when it is left and only when it changed, what the server kept (the checked address) lands
// in the field, and a refusal stays on its own field with what was typed still there. On someone else's page a page
// only person's name saves through Team pages, and anyone else's is read only. Checked by axe in both themes.
import '@crm/ui/styles.css';
import { dataError, type DataLayer, type MyProfile } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Card, PreviewLayout } from '@crm/ui';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { IdentityFields, type IdentityOwner, type PageIdentity } from './IdentityFields.tsx';
import { strings } from './strings.ts';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** What the fields said about the switch, for the card's foot: a refusal, or undefined once it saves. */
let refused: (string | undefined)[] = [];

const OFF: PageIdentity = { name: 'Ada Lovelace', jobTitle: '', showJobTitle: false, site: '', footLine: '' };

/** The card, with a data layer whose profile update is `update`, and what it reported saved. */
async function render(
  update: (slug: string, change: object) => Promise<MyProfile>,
  identity: PageIdentity = OFF,
  owner?: IdentityOwner,
  namePerson: (...args: unknown[]) => Promise<unknown> = vi.fn(),
) {
  const saved: PageIdentity[] = [];
  refused = [];
  shown = await renderInApp(
    () => (
      <main>
        <IdentityFields
          data={{ profile: { update }, teamPages: { namePerson } } as unknown as DataLayer}
          slug="acme"
          {...(owner === undefined ? {} : { owner })}
          identity={identity}
          onSaved={(kept) => saved.push(kept)}
          onSwitchRefused={(message) => refused.push(message)}
        />
      </main>
    ),
    { data: {}, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
  );
  return saved;
}

const profile = (fields: Partial<MyProfile>) => ({ name: 'Ada Lovelace', bio: '', ...fields }) as MyProfile;
const TITLED: PageIdentity = { ...OFF, jobTitle: 'Head of partnerships' };

describe('who the page is from', () => {
  it('changes the name right here, and sends nothing for no change', async () => {
    const update = vi.fn((_slug: string, _change: object) => Promise.resolve(profile({ name: 'Ada King' })));
    const saved = await render(update);
    const name = page.getByRole('textbox', { name: 'Name' });
    await expect.element(name).toHaveValue('Ada Lovelace');
    await userEvent.click(name);
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
    await userEvent.fill(name, 'Ada King ');
    await userEvent.keyboard('{Enter}');
    expect(update).toHaveBeenCalledWith('acme', { name: 'Ada King' });
    await vi.waitFor(() => expect(saved.at(-1)).toMatchObject({ name: 'Ada King' }));
  });

  it('turns a title typed here on, and one cleared off; no switch until there is one', async () => {
    expect.hasAssertions();
    const update = vi.fn((_slug: string, _change: object) =>
      Promise.resolve(profile({ jobTitle: 'Founder', showJobTitle: true })),
    );
    await render(update);
    expect(page.getByRole('switch', { name: 'Show under my name' }).query()).toBeNull();
    await userEvent.fill(page.getByRole('textbox', { name: 'Title' }), 'Founder');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('acme', { jobTitle: 'Founder', showJobTitle: true });
    shown?.unmount();
    const cleared = vi.fn((_slug: string, _change: object) => Promise.resolve(profile({ showJobTitle: false })));
    await render(cleared, { ...TITLED, showJobTitle: true });
    await userEvent.fill(page.getByRole('textbox', { name: 'Title' }), '');
    await userEvent.tab();
    expect(cleared).toHaveBeenCalledWith('acme', { jobTitle: '', showJobTitle: false });
  });

  it('leaves the switch alone when a title is reworded, and sends Enter then Tab once', async () => {
    // The save stays in flight until the Tab is done: a timer let it land first on a slow runner, and this harness
    // never hands the kept title back, so the Tab then read as a second change (CI, 9 Nov 2026).
    let land: () => void = () => undefined;
    const update = vi.fn(
      (_slug: string, _change: object) =>
        new Promise<MyProfile>((resolve) => {
          land = () => resolve(profile({ jobTitle: 'Sales lead', showJobTitle: false }));
        }),
    );
    await render(update, TITLED);
    await userEvent.fill(page.getByRole('textbox', { name: 'Title' }), 'Sales lead');
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('acme', { jobTitle: 'Sales lead' });
    land();
  });

  it('saves the switch at once, with a title to show under the name', async () => {
    const update = vi.fn((_slug: string, _change: object) =>
      Promise.resolve(profile({ jobTitle: 'Head of partnerships', showJobTitle: true })),
    );
    const saved = await render(update, TITLED);
    // The switch's input is visually hidden under its track, as React Aria draws it.
    await userEvent.click(page.getByRole('switch', { name: 'Show under my name' }), { force: true });
    expect(update).toHaveBeenCalledWith('acme', { showJobTitle: true });
    await vi.waitFor(() => expect(saved).toEqual([{ ...OFF, jobTitle: 'Head of partnerships', showJobTitle: true }]));
    expect(refused).toEqual([undefined]);
  });

  it('hands a refused switch to the card it sits in', async () => {
    await render(() => Promise.reject(dataError('CONFIG_INVALID', 'That didn’t save.')), TITLED);
    await userEvent.click(page.getByRole('switch', { name: 'Show under my name' }), { force: true });
    await vi.waitFor(() => expect(refused).toEqual([undefined, 'That didn’t save.']));
    await expect.element(page.getByRole('switch', { name: 'Show under my name' })).not.toBeChecked();
  });

  it('saves a field when it is left, shows the address as kept', async () => {
    const update = vi.fn((_slug: string, _change: object) =>
      Promise.resolve(profile({ showJobTitle: false, site: 'https://acme.com/' })),
    );
    await render(update);
    const site = page.getByRole('textbox', { name: 'Company site' });
    await userEvent.fill(site, 'acme.com');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('acme', { site: 'acme.com' });
    await expect.element(site).toHaveValue('https://acme.com/');
  });

  it('says an empty name on the field and sends nothing', async () => {
    const update = vi.fn();
    await render(update);
    const name = page.getByRole('textbox', { name: 'Name' });
    await userEvent.fill(name, ' ');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Enter a name.')).toBeVisible();
    await expect.element(name).toHaveValue(' ');
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps a refusal on its own field, with what was typed still there', async () => {
    await render(() => Promise.reject(dataError('CONFIG_INVALID', 'Use 1 to 80 characters for your name.')));
    const name = page.getByRole('textbox', { name: 'Name' });
    await userEvent.fill(name, 'Ada K');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Use 1 to 80 characters for your name.')).toBeVisible();
    await expect.element(name).toHaveValue('Ada K');
  });

  it.each(THEMES)('passes axe in %s', async (theme) => {
    await render(vi.fn(), TITLED);
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });
});

describe('on someone else’s page', () => {
  it('names a page only person through Team pages, with only the name and title', async () => {
    const namePerson = vi.fn(() => Promise.resolve({ name: 'Nick', jobTitle: 'Barista', showJobTitle: true }));
    const update = vi.fn();
    const saved = await render(update, { ...OFF, name: 'Nick' }, { kind: 'team', member: 'm-1' }, namePerson);
    expect(page.getByRole('textbox', { name: 'Company site' }).query()).toBeNull();
    await userEvent.fill(page.getByRole('textbox', { name: 'Title' }), 'Barista');
    await userEvent.tab();
    expect(namePerson).toHaveBeenCalledWith('acme', 'm-1', { jobTitle: 'Barista' });
    expect(update).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(saved.at(-1)).toMatchObject({ jobTitle: 'Barista', showJobTitle: true }));
  });

  it('shows a member with a login their own name, read only, and says where they change it', async () => {
    await render(vi.fn(), TITLED, { kind: 'kept', by: 'self' });
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly');
    await expect.element(page.getByText('They change their name and title in their own Profile.')).toBeVisible();
    // Their title kept to the team isn't shown as the page's.
    expect(page.getByRole('textbox', { name: 'Title' }).query()).toBeNull();
  });

  it.each(THEMES)('passes axe read only in %s', async (theme) => {
    await render(vi.fn(), TITLED, { kind: 'kept', by: 'self' });
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });
});

/** Where the lane's screenshots go, when it asks for them; never in CI. */
const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

describe.runIf(SHOT_DIR !== undefined && SHOT_DIR !== '')('the Details card, photographed', () => {
  const owners: readonly (readonly [string, IdentityOwner, PageIdentity])[] = [
    [
      'own',
      { kind: 'own' },
      { ...TITLED, showJobTitle: true, site: 'https://acme.com/', footLine: 'Replies within a day.' },
    ],
    ['team', { kind: 'team', member: 'm-1' }, { ...OFF, name: 'Nick Page', jobTitle: 'Barista' }],
    [
      'kept',
      { kind: 'kept', by: 'self' },
      { ...OFF, name: 'Priya Raman', jobTitle: 'Head of Sales', showJobTitle: true },
    ],
  ];
  it('in light and dark, at a desktop’s and a phone’s width', async () => {
    for (const [name, owner, identity] of owners) {
      shown = await renderInApp(
        () => (
          <main>
            <PreviewLayout previewShare="wide">
              <Card title={strings.details}>
                <IdentityFields
                  data={{ profile: { update: vi.fn() }, teamPages: { namePerson: vi.fn() } } as unknown as DataLayer}
                  slug="acme"
                  owner={owner}
                  identity={identity}
                  onSaved={() => undefined}
                  onSwitchRefused={() => undefined}
                />
              </Card>
            </PreviewLayout>
          </main>
        ),
        { data: {}, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
      );
      for (const width of [1280, 390]) {
        await page.viewport(width, 800);
        for (const theme of THEMES) {
          applyTheme(theme);
          await page.screenshot({ path: `${SHOT_DIR ?? ''}/details-${name}-${theme}-${String(width)}.png` } as never);
        }
      }
      // Focus on the name, as a keyboard reaches it.
      if (owner.kind !== 'kept') {
        await page.viewport(1280, 800);
        applyTheme('light');
        await userEvent.click(page.getByRole('textbox', { name: 'Name' }));
        await page.screenshot({ path: `${SHOT_DIR ?? ''}/details-${name}-focus.png` } as never);
      }
      resetTheme();
      shown.unmount();
      shown = undefined;
    }
  });
});
