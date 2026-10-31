// The link page's spec 0058 pieces in Chromium: the address claimed right here with no trip to Profile (AC-8), the
// overview's first empty moment (AC-8), the block kinds picked from a grid of icons with their lines as tooltips
// (AC-9), the starting looks as thumbnails with the chosen one ticked (AC-10), Bring a page across showing a count
// and the list of what came across (AC-16), the delete confirm as one line and two buttons (AC-18), and the Live or
// Private switch (AC-23): a page made for its owner goes live as they open it, said once with Undo, and the switch
// sends their own choice.
// The tokens, so the phone bar's widths below are the real ones.
import '@crm/ui/styles.css';
import {
  dataError,
  PAGE_THEME_PRESETS,
  DEFAULT_PAGE_THEME,
  type DataLayer,
  type ProfileItem,
  type ProfileLinkImport,
} from '@crm/data';
import { Field, Form, TopBar } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { deferred, openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AppearanceCard } from './AppearanceCard.tsx';
import { ClaimLink } from './ClaimLink.tsx';
import { ImportLinksModal } from './ImportLinksModal.tsx';
import { BlockEditorFrame, useFocusesFirstField } from './editors.tsx';
import { DeleteBlockDialog, KindPicker } from './KindPicker.tsx';
import type { AddableKind } from './registry.tsx';
import { LinkPageOverview } from './LinkPageOverview.tsx';
import { HeaderActions } from './LinkPageScreen.tsx';
import { LiveSwitch, useLinkPageLive } from './private-page.tsx';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** Renders one piece inside the app's providers, at the link page's own address. */
async function render(data: Partial<DataLayer>, screen: () => ReactNode) {
  shown = await renderInApp(() => <main>{screen()}</main>, {
    data,
    pattern: '/w/$slug/link-page',
    at: '/w/acme/link-page',
  });
}

const link = (id: string, title: string, url: string): ProfileItem => ({
  kind: 'link',
  id,
  title,
  url,
  hue: 'blue',
  updatedAt: '2026-10-31T10:00:00.000Z',
});

describe('a link page with no handle (AC-8)', () => {
  it('claims the address right here, checked first, and never sends anyone to Profile', async () => {
    const update = vi.fn(() => Promise.resolve({}));
    const data = { profile: { update } } as unknown as DataLayer;
    await render(data, () => <ClaimLink data={data} slug="acme" suggested="ada-lovelace" />);
    await expect.element(page.getByText('Claim your link')).toBeVisible();
    const field = page.getByRole('textbox', { name: 'Your link' });
    await expect.element(field).toHaveValue('ada-lovelace');
    expect(page.getByRole('link', { name: /Profile/ }).query()).toBeNull();
    // A word kept for Timefix is refused on the field, before anything is sent.
    await field.fill('settings');
    await page.getByRole('button', { name: 'Claim' }).click();
    await expect.element(field).toHaveAccessibleDescription('That handle is kept for Timefix. Pick another.');
    expect(update).not.toHaveBeenCalled();
    // Typed as an address is: lowercase, spaces as dashes. Enter claims it too.
    await field.fill('Ada Rocks');
    await expect.element(field).toHaveValue('ada-rocks');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => update.mock.calls).toEqual([['acme', { handle: 'ada-rocks' }]]);
  });

  it('says a taken link on its field, and the field takes it back as it changes', async () => {
    const update = vi.fn(() => Promise.reject(dataError('SLUG_TAKEN', 'That handle is taken. Pick another.')));
    const data = { profile: { update } } as unknown as DataLayer;
    await render(data, () => <ClaimLink data={data} slug="acme" suggested="ada" />);
    const field = page.getByRole('textbox', { name: 'Your link' });
    await page.getByRole('button', { name: 'Claim' }).click();
    await expect.element(field).toHaveAccessibleDescription('That handle is taken. Pick another.');
    await field.fill('ada-2');
    await expect.element(field).not.toHaveAccessibleDescription('That handle is taken. Pick another.');
  });
});

describe('the overview’s first empty moment (AC-8) and a private page’s line (AC-23)', () => {
  it('draws one picture, one line and one primary, which opens the editor on Add', async () => {
    const onEdit = vi.fn();
    const onAdd = vi.fn();
    const data = { linkPage: { load: () => new Promise(() => undefined) } } as unknown as DataLayer;
    await render(data, () => (
      <LinkPageOverview
        data={data}
        slug="acme"
        handle="ada"
        address="https://timefix.com/ada"
        isPublic={false}
        isEmpty
        onEdit={onEdit}
        onAdd={onAdd}
        onGoLive={() => undefined}
      />
    ));
    await expect.element(page.getByText('Nothing on your page yet')).toBeVisible();
    await expect.element(page.getByText('Private. Turn on Live to share it.')).toBeVisible();
    // The old "goes public the first time you edit or share" panel is gone.
    expect(document.body.textContent).not.toContain('goes public');
    expect(page.getByRole('button', { name: 'Make it public' }).query()).toBeNull();
    await page.getByRole('button', { name: 'Add to your page' }).click();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('a Private page’s overview (AC-23)', () => {
  it('offers nothing to share, only Turn on Live, and every way to share comes back once Live', async () => {
    const onGoLive = vi.fn();
    const data = { linkPage: { load: () => new Promise(() => undefined) } } as unknown as DataLayer;
    const overview = (isPublic: boolean) => (
      <LinkPageOverview
        data={data}
        slug="acme"
        handle="ada"
        address="https://timefix.com/ada"
        isPublic={isPublic}
        isEmpty={false}
        onEdit={() => undefined}
        onAdd={() => undefined}
        onGoLive={onGoLive}
      />
    );
    await render(data, () => overview(false));
    await expect.element(page.getByText('Private. Turn on Live to share it.')).toBeVisible();
    expect(page.getByText('Share online').query()).toBeNull();
    expect(page.getByText('Share in person').query()).toBeNull();
    expect(page.getByRole('link', { name: /Open/ }).query()).toBeNull();
    expect(page.getByRole('button', { name: 'Download' }).query()).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Edit page' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn on Live' }).click();
    expect(onGoLive).toHaveBeenCalledTimes(1);
    shown?.unmount();
    await render(data, () => overview(true));
    await expect.element(page.getByText('Share online')).toBeVisible();
    await expect.element(page.getByText('Share in person')).toBeVisible();
    expect(page.getByRole('button', { name: 'Turn on Live' }).query()).toBeNull();
  });
});

describe('the bar on a phone (AC-1)', () => {
  it.each([390, 320])('fits a %i px screen while Live and editing, with Share and Done in reach', async (width) => {
    await page.viewport(width, 844);
    try {
      await render({}, () => (
        <TopBar title="Link page" icon="id-card">
          <HeaderActions
            live={{ isLive: true, setLive: () => undefined }}
            handle="ada-lovelace-2"
            isEditing
            onEditing={() => undefined}
          />
        </TopBar>
      ));
      const share = page.getByRole('button', { name: 'Share' });
      const done = page.getByRole('button', { name: 'Done' });
      await expect.element(share).toBeVisible();
      await expect.element(page.getByRole('link', { name: /open your page/ })).toBeVisible();
      // Nothing scrolls sideways, and the last control ends inside the screen.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(done.element().getBoundingClientRect().right).toBeLessThanOrEqual(width);
    } finally {
      await page.viewport(1280, 800);
    }
  });
});

describe('the Add modal’s kinds (AC-9)', () => {
  it('is a grid of icons with a short name each, the line about each kind only a description', async () => {
    const onChange = vi.fn();
    await render({}, () => (
      <KindPicker
        value="link"
        fullReason={(kind) => (kind === 'contact' ? 'You have a contact card already.' : undefined)}
        onChange={onChange}
      />
    ));
    const grid = page.getByRole('radiogroup', { name: 'What are you adding' });
    await expect.element(grid.getByRole('radio', { name: 'Link' })).toBeChecked();
    await expect
      .element(grid.getByRole('radio', { name: 'Booking page' }))
      .toHaveAccessibleDescription('One of your public booking pages');
    // A kind that is full is off, its tooltip the limit's sentence.
    await expect.element(grid.getByRole('radio', { name: 'Contact card' })).toBeDisabled();
    await expect
      .element(grid.getByRole('radio', { name: 'Contact card' }))
      .toHaveAccessibleDescription('You have a contact card already.');
    // The keyboard moves and picks, as any radio group.
    (grid.getByRole('radio', { name: 'Link' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('page');
  });
});

/** A kind's fields as a block editor draws them: one form that focuses its first field only when the frame says. */
function KindFields({ kind }: { readonly kind: AddableKind }) {
  const focusFirst = useFocusesFirstField();
  return (
    <Form id={`fields-${kind}`} label={kind} onSubmit={() => undefined} focusesFirstField={focusFirst}>
      <Field label={`${kind} title`} name="title" />
    </Form>
  );
}

/** The Add modal: the frame, the kind picker in it, and the chosen kind's fields under it. */
function AddModal() {
  const [kind, setKind] = useState<AddableKind>('link');
  return (
    <BlockEditorFrame
      title="Add to your link page"
      leading={<KindPicker value={kind} fullReason={() => undefined} onChange={setKind} />}
      onClose={() => undefined}
    >
      <KindFields key={kind} kind={kind} />
    </BlockEditorFrame>
  );
}

describe('the Add modal’s keyboard (AC-4, AC-9)', () => {
  it('lets the arrows cross every kind, and moves to the fields only once a kind is picked', async () => {
    await render({}, () => <AddModal />);
    const grid = page.getByRole('radiogroup', { name: 'What are you adding' });
    // It opens on Link with its first field ready to type in.
    await expect.element(page.getByRole('textbox', { name: 'link title' })).toHaveFocus();
    (grid.getByRole('radio', { name: 'Link' }).element() as HTMLElement).focus();
    // Every arrow swaps the fields under the grid and leaves focus on the tiles.
    const names = ['Booking page', 'Timefix form', 'Email signup', 'Writing', 'Questions', 'Testimonial'];
    for (const name of names) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.element(grid.getByRole('radio', { name })).toHaveFocus();
      await expect.element(grid.getByRole('radio', { name })).toBeChecked();
    }
    await expect.element(page.getByRole('textbox', { name: 'testimonial title' })).not.toHaveFocus();
    // Enter picks the focused kind and moves on to its fields.
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('textbox', { name: 'testimonial title' })).toHaveFocus();
    // Back on the grid, Space picks too.
    (grid.getByRole('radio', { name: 'Testimonial' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');
    await expect.element(page.getByRole('textbox', { name: 'contact title' })).toHaveFocus();
  });
});

describe('Appearance’s starting looks (AC-10)', () => {
  it('shows each as a thumbnail with its name, ticks the one on the page, and picks by its picture', async () => {
    const onChange = vi.fn();
    const ink = PAGE_THEME_PRESETS.find((preset) => preset.id === 'ink');
    if (ink === undefined) throw new Error('No Ink look.');
    await render({}, () => <AppearanceCard theme={DEFAULT_PAGE_THEME} onChange={onChange} />);
    const looks = page.getByRole('radiogroup', { name: 'Start from' });
    for (const name of ['Plain', 'Paper', 'Bold', 'Ink', 'Quiet']) {
      await expect.element(looks.getByRole('radio', { name })).toBeInTheDocument();
    }
    const tiles = [...looks.element().querySelectorAll('[data-tile]')];
    expect(tiles).toHaveLength(5);
    // Each tile draws the real look in its picture slot, with the page's own look attributes (Ink's dark ground).
    const grounds = tiles.map((tile) => tile.querySelector('[data-thumbnail]')?.getAttribute('data-page-ground'));
    expect(grounds).toEqual(PAGE_THEME_PRESETS.map((preset) => preset.theme.ground));
    // The page stands on Plain (the default look), so Plain is the one ticked.
    await expect.element(looks.getByRole('radio', { name: 'Plain' })).toBeChecked();
    // Picked from the keyboard (the whole tile is the press target for a pointer): Plain, Paper, Bold, Ink.
    (looks.getByRole('radio', { name: 'Plain' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(ink.theme);
  });
});

describe('Bring a page across (AC-16)', () => {
  it('names the seven services in one hint line, then shows a count and the list of what came across', async () => {
    const archived = [
      link('i1', 'Portfolio', 'https://ada.example/work'),
      link('i2', 'Newsletter', 'https://ada.example/news/'),
    ];
    const answer = deferred<ProfileLinkImport>();
    const onImport = vi.fn(() => answer.promise);
    await render({}, () => (
      <ImportLinksModal
        isOpen
        archived={archived}
        newId={() => 'imp-1'}
        onClose={() => undefined}
        onImport={onImport}
      />
    ));
    const field = page.getByRole('textbox', { name: 'Your page’s address' });
    await expect
      .element(field)
      .toHaveAccessibleDescription('Linktree, Beacons, Bio.link, Lnk.Bio, Linktw.in, Liinks or Solo.to.');
    await field.fill('linktr.ee/ada');
    await page.getByRole('button', { name: 'Bring links across' }).click();
    expect(onImport).toHaveBeenCalledWith('imp-1', 'linktr.ee/ada');
    answer.resolve({
      id: 'imp-1',
      source: 'https://linktr.ee/ada',
      made: 2,
      existed: false,
      itemIds: ['i1', 'i2'],
      skipped: [{ title: 'Me', url: 'https://linktr.ee/ada', reason: 'the-page-itself' }],
    });
    await expect.element(page.getByText('2 links came across')).toBeVisible();
    await expect.element(page.getByText('Portfolio', { exact: true })).toBeVisible();
    await expect.element(page.getByText('ada.example/work', { exact: true })).toBeVisible();
    await expect.element(page.getByText('ada.example/news', { exact: true })).toBeVisible();
    await expect.element(page.getByText('One row didn’t come across:')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Done' })).toHaveFocus();
  });
});

describe('deleting a block (AC-18)', () => {
  it('asks in a Modal with one line and two buttons, Cancel first', async () => {
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    await render({}, () => (
      <DeleteBlockDialog
        item={link('i1', 'Portfolio', 'https://ada.example')}
        isBusy={false}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    ));
    await expect.poll(() => openDialog('alertdialog')).not.toBeNull();
    const dialog = openDialog('alertdialog');
    expect(dialog?.textContent).toContain('Delete Portfolio?');
    expect(dialog?.textContent).toContain('It leaves your page for good. Archive keeps it.');
    // Two buttons, Cancel first (its Esc keycap beside it) and the danger last.
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])].map((button) => button.textContent.trim());
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatch(/^Cancel/);
    expect(buttons[1]).toBe('Delete block');
    await page.getByRole('button', { name: 'Delete block' }).click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

/** The switch as the screen holds it, opened as the link page screen opens it. */
function Live({ data, isPublic }: { readonly data: DataLayer; readonly isPublic: boolean }) {
  const live = useLinkPageLive(data, 'acme', isPublic, { opens: true });
  return <LiveSwitch live={live} />;
}

describe('the Live or Private switch (AC-23)', () => {
  it('puts a page made for its owner live as they open it, says so once with Undo, and Undo makes it private', async () => {
    const show = vi.fn((_slug: string, live?: boolean) => Promise.resolve({ isPublic: live ?? true }));
    const data = { linkPage: { load: () => Promise.resolve({ show }) } } as unknown as DataLayer;
    await render(data, () => <Live data={data} isPublic={false} />);
    const live = page.getByRole('switch', { name: 'Live' });
    await expect.element(page.getByText('Your page is live')).toBeVisible();
    await expect.element(live).toBeChecked();
    expect(show.mock.calls).toEqual([['acme', undefined]]);
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.element(live).not.toBeChecked();
    expect(show).toHaveBeenLastCalledWith('acme', false);
  });

  it('leaves a page its owner set Private as it is, and the switch sends their choice', async () => {
    // The server's answer to an open of a page set Private: still private.
    const show = vi.fn((_slug: string, live?: boolean) => Promise.resolve({ isPublic: live ?? false }));
    const data = { linkPage: { load: () => Promise.resolve({ show }) } } as unknown as DataLayer;
    await render(data, () => <Live data={data} isPublic={false} />);
    const live = page.getByRole('switch', { name: 'Live' });
    await expect.poll(() => show.mock.calls.length).toBe(1);
    await expect.element(live).not.toBeChecked();
    expect(document.body.textContent).not.toContain('Your page is live');
    (live.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await expect.element(live).toBeChecked();
    expect(show).toHaveBeenLastCalledWith('acme', true);
  });

  it('puts the switch back and says so when the save is refused', async () => {
    const show = vi.fn((_slug: string, live?: boolean) =>
      live === undefined ? Promise.resolve({ isPublic: true }) : Promise.reject(new Error('offline')),
    );
    const data = { linkPage: { load: () => Promise.resolve({ show }) } } as unknown as DataLayer;
    await render(data, () => <Live data={data} isPublic />);
    const live = page.getByRole('switch', { name: 'Live' });
    await expect.element(live).toBeChecked();
    // A live page is never opened again: nothing to ask.
    expect(show).not.toHaveBeenCalled();
    (live.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await expect.element(page.getByText('That didn’t save. Try again.')).toBeVisible();
    await expect.element(live).toBeChecked();
  });
});
