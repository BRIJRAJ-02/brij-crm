// The link page's spec 0058 pieces in Chromium: the address claimed right here with no trip to Profile (AC-8), the
// overview's first empty moment (AC-8), the block kinds picked from a grid of icons with their lines as tooltips
// (AC-9), the starting looks as thumbnails with the chosen one ticked (AC-10), Bring a page across showing a count
// and the list of what came across (AC-16), the delete confirm as one line and two buttons (AC-18), and the Live or
// Private switch (AC-23): a page made for its owner goes live as they open it, said once with Undo, and the switch
// sends their own choice.
// The tokens, so the phone bar's widths below are the real ones.
import '@crm/ui/app.css';
import {
  dataError,
  DEFAULT_PAGE_THEME,
  type DataLayer,
  type LinkPageStore,
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
import { LinkPublishBar } from './LinkPublishBar.tsx';
import { PagePhotos } from './PagePhotos.tsx';
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

/** A held value that stays loading: Insights and the code's style, which these pieces never wait on. */
const loading = { status: 'loading' } as const;
const waiting = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
  retry: () => undefined,
};

/** The link page store as the overview reads it (spec 0061): Insights and the code's style, both still loading. */
const linkPageStore = {
  reach: {
    insights: () => waiting,
    insightDays: [7, 30, 90],
    qrStyle: () => waiting,
    pictureSrc: (_slug: string, id: string) => `/api/profile/images/${id}`,
    insightsCsvHref: () => '/api/profile/insights.csv',
  },
} as unknown as LinkPageStore;

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
        slug="acme"
        handle="ada"
        address="https://timefix.com/ada"
        isPublic={false}
        isEmpty
        onEdit={onEdit}
        onAdd={onAdd}
        onGoLive={() => undefined}
        linkPage={linkPageStore}
        items={[]}
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
        slug="acme"
        handle="ada"
        address="https://timefix.com/ada"
        isPublic={isPublic}
        isEmpty={false}
        onEdit={() => undefined}
        onAdd={() => undefined}
        onGoLive={onGoLive}
        linkPage={linkPageStore}
        items={[]}
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
    // Live: the code and its one Download; the address, Share links and Open live once, in the bar.
    await expect.element(page.getByRole('button', { name: 'Download QR code' })).toBeVisible();
    expect(page.getByText('Share online').query()).toBeNull();
    expect(page.getByText('Everything people need from you, behind one short link.').query()).toBeNull();
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
            data={{} as DataLayer}
            live={{ isLive: true, setLive: () => undefined, goLive: () => undefined, switchRef: { current: null } }}
            handle="ada-lovelace-2"
            linkPage={linkPageStore}
            slug="acme"
            quickPicks={[]}
            isEditing
            onEditing={() => undefined}
          />
        </TopBar>
      ));
      const share = page.getByRole('button', { name: 'Share' });
      const done = page.getByRole('button', { name: 'Done' });
      await expect.element(share).toBeVisible();
      // The address is a pill that copies the link in one press.
      await expect.element(page.getByRole('button', { name: /copy link/ })).toBeVisible();
      // Nothing scrolls sideways, and the last control ends inside the screen.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(done.element().getBoundingClientRect().right).toBeLessThanOrEqual(width);
    } finally {
      await page.viewport(1280, 800);
    }
  });
});

describe('Share, on the one share sheet (spec 0074, AC-7404)', () => {
  /** The header with Share, its Live state held here so a test can turn the page Private while Share is open. */
  function Header({ onLive }: { readonly onLive: (setLive: (isLive: boolean) => void) => void }) {
    const [isLive, setLive] = useState(true);
    onLive(setLive);
    return (
      <TopBar title="Link page" icon="id-card">
        <HeaderActions
          data={
            {
              linkPage: {
                load: () =>
                  Promise.resolve({ walletLink: () => Promise.resolve({ url: 'https://wallet.example.com/pass' }) }),
              },
            } as unknown as DataLayer
          }
          live={{ isLive, setLive, goLive: () => undefined, switchRef: { current: null } }}
          handle="ada"
          workspaceName="Acme"
          linkPage={linkPageStore}
          slug="acme"
          quickPicks={[]}
          isEditing={false}
          onEditing={() => undefined}
        />
      </TopBar>
    );
  }

  it('keeps every way the old Share had: the line, Copy link, Download, Open page, the links, the style and Wallet', async () => {
    let turn: (isLive: boolean) => void = () => undefined;
    await render({}, () => <Header onLive={(set) => (turn = set)} />);
    await userEvent.click(page.getByRole('button', { name: 'Share' }));
    const sheet = page.getByRole('dialog', { name: 'Share your link page' });
    await expect.element(sheet.getByText('Your link page in Acme.')).toBeVisible();
    await expect.element(sheet.getByRole('img', { name: 'QR code for @ada' })).toBeInTheDocument();
    await expect.element(sheet.getByRole('button', { name: 'Copy link' })).toHaveAttribute('data-variant', 'primary');
    await expect.element(sheet.getByRole('button', { name: /^Download QR code/ })).toBeVisible();
    await expect.element(sheet.getByRole('link', { name: 'Open page' })).toBeVisible();
    expect(sheet.getByRole('link', { name: 'Open page' }).element().getAttribute('href')).toMatch(/\/ada$/);
    await expect.element(sheet.getByRole('button', { name: 'Share links' })).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'Style the code' })).toBeVisible();
    await expect
      .element(sheet.getByRole('link', { name: 'Add to Wallet' }))
      .toHaveAttribute('href', 'https://wallet.example.com/pass');
    // Turned Private while open: the sheet says so, offers Turn on Live, and the other ways go.
    turn(false);
    await expect.element(sheet.getByText('Private. Only you can open it.')).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'Turn on Live' })).toBeVisible();
    expect(sheet.getByRole('button', { name: 'Share links' }).query()).toBeNull();
    await userEvent.click(sheet.getByRole('button', { name: 'Turn on Live' }));
    await expect.element(sheet.getByText('Your link page in Acme.')).toBeVisible();
    // One dialog at a time: Share links closes the sheet before its own opens.
    await userEvent.click(sheet.getByRole('button', { name: 'Share links' }));
    await expect.poll(() => page.getByRole('dialog', { name: 'Share your link page' }).query()).toBeNull();
    await expect.element(page.getByRole('dialog', { name: 'Links for each place' })).toBeVisible();
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
    const names = [
      'Booking page',
      'Next times',
      'Timefix form',
      'Email signup',
      'Video or music',
      'Picture',
      'Gallery',
      'Social icons',
      'Writing',
      'Questions',
      'Testimonial',
    ];
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

describe('Design’s four templates (spec 0068, AC-6802, AC-6804, AC-6805)', () => {
  const extras = (template?: 'studio') =>
    ({
      look: {
        accent: '#ffd400',
        workspaceAccent: '#1f5fd6',
        ...(template === undefined ? {} : { workspaceTemplate: template }),
      },
      colours: () => ({ variables: [], adjusted: true, light: '#7a6700', dark: '#ffd400' }),
      variables: [],
      quickPicks: [{ hue: 'orange', value: '#fb8f3c' }],
      photoSrc: () => undefined,
      onAccent: vi.fn(),
      onPreviewAccent: () => undefined,
      onPhoto: () => undefined,
      onRemovePhoto: () => undefined,
    }) as const;

  it('shows the four as small pictures with a name each, ticks the one worn, and picks by keyboard', async () => {
    const onChange = vi.fn();
    await render({}, () => <AppearanceCard theme={DEFAULT_PAGE_THEME} onChange={onChange} extras={extras('studio')} />);
    const templates = page.getByRole('radiogroup', { name: 'Template' });
    for (const name of ['Classic', 'Studio', 'Night', 'Split']) {
      await expect.element(templates.getByRole('radio', { name })).toBeInTheDocument();
    }
    const tiles = [...templates.element().querySelectorAll('[data-tile]')];
    expect(tiles).toHaveLength(4);
    // Each tile draws the real page in its template, small: the phone beside the card is the large one.
    expect(tiles.map((tile) => tile.querySelector('[data-thumbnail]')?.getAttribute('data-template'))).toEqual([
      'classic',
      'studio',
      'night',
      'split',
    ]);
    expect(tiles.every((tile) => tile.querySelector('[data-size="large"]') === null)).toBe(true);
    // No sentence under the templates.
    expect(page.getByText('Clean and calm.', { exact: false }).query()).toBeNull();
    // A page with no template of its own wears the workspace's, and says so.
    await expect.element(templates.getByRole('radio', { name: 'Studio' })).toBeChecked();
    await expect.element(page.getByText('Studio, from your workspace')).toBeVisible();
    (templates.getByRole('radio', { name: 'Studio' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ template: 'night', ground: 'ink' }));
    // Nothing but the template, the colour, the cover and the face (AC-6802).
    for (const gone of ['Background', 'Font', 'Buttons', 'Corners', 'Header', 'Mode', 'Looks']) {
      await expect.element(page.getByRole('radiogroup', { name: gone })).not.toBeInTheDocument();
    }
    await expect.element(page.getByRole('radiogroup', { name: 'Profile photo shape' })).toBeInTheDocument();
    await expect.element(page.getByRole('status')).toHaveTextContent('Adjusted so text stays readable.');
  });

  it('says the move once, and Keep it saves the look without the note', async () => {
    const onChange = vi.fn();
    const moved = { ...DEFAULT_PAGE_THEME, template: 'classic', moved: true } as const;
    await render({}, () => <AppearanceCard theme={moved} onChange={onChange} extras={extras()} />);
    await expect.element(page.getByText('Your page now uses Classic.')).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    const kept = onChange.mock.lastCall?.[0] as Record<string, unknown> | undefined;
    expect(kept?.template).toBe('classic');
    expect(kept).not.toHaveProperty('moved');
  });
});

describe('Publish’s bar (spec 0068, AC-6811)', () => {
  it('shows a template pick as a draft as soon as its save lands, with no reload and no timer', async () => {
    // The server's answer: nothing to publish until the look's save lands, then the template change.
    let changes: readonly string[] = [];
    const listeners = new Set<() => void>();
    const linkPage = {
      publication: {
        read: vi.fn(() => Promise.resolve({ changes: [...changes] })),
        onChange: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        changed: () => undefined,
      },
    } as unknown as LinkPageStore;
    await render({}, () => <LinkPublishBar linkPage={linkPage} slug="acme" address="/ada" isPaused={false} />);
    await expect.element(page.getByText('Live: guests see this page')).toBeVisible();
    // The save lands (the store says so), long after any read a timer would have made.
    changes = ['Template Classic → Studio'];
    for (const listener of listeners) listener();
    await expect.element(page.getByText('1 change not published')).toBeVisible();
    expect(linkPage.publication.read).toHaveBeenCalledTimes(2);
  });
});

describe('Crop again (spec 0068, AC-6809)', () => {
  it('offers Adjust crop on a photo that is there, handing the screen its address for the cropper', async () => {
    const onPhoto = vi.fn();
    const cover =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const extras = {
      look: { cover: 'v1', workspaceAccent: '#1f5fd6' },
      photoSrc: () => cover,
      onPhoto,
      onRemovePhoto: () => undefined,
    } as const;
    await render({}, () => <PagePhotos slots={['avatar', 'cover']} extras={extras} />);
    // The cover sits in Profile with the profile photo (owner, 10 Nov 2026), as one row: its picture, Change,
    // Adjust crop and Remove.
    await expect.element(page.getByRole('button', { name: 'Change cover photo' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Remove cover photo' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Adjust crop' }).first());
    expect(onPhoto).toHaveBeenCalledWith('cover', cover);
  });
});

describe('the page’s three photos (9 Nov 2026; Profile first, 10 Nov 2026)', () => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const extras = (look: Readonly<Record<string, string>>, onRemovePhoto: (slot: string) => void = () => undefined) =>
    ({
      look: { workspaceAccent: '#1f5fd6', ...look },
      colours: () => undefined,
      variables: [],
      quickPicks: [],
      photoSrc: () => pixel,
      onAccent: () => undefined,
      onPreviewAccent: () => undefined,
      onPhoto: () => undefined,
      onRemovePhoto,
    }) as const;

  it('puts the profile photo and the cover in Profile, the background in Design, each saying where', async () => {
    await render({}, () => (
      <>
        <PagePhotos slots={['avatar', 'cover']} extras={extras({})} />
        <AppearanceCard theme={DEFAULT_PAGE_THEME} onChange={() => undefined} extras={extras({})} />
      </>
    ));
    const uploads = ['Upload profile photo', 'Upload cover photo', 'Upload background photo'];
    const hints = [
      'Above the name, also on booking pages',
      'The wide photo at the top',
      'Fills the page behind everything',
    ];
    for (const [index, name] of uploads.entries()) {
      await expect.element(page.getByRole('button', { name })).toHaveAccessibleDescription(hints[index] ?? '');
    }
    const order = [...document.querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((label) => uploads.includes(label));
    expect(order).toEqual(uploads);
    shown?.unmount();
    // Design alone holds only the background now; the shape of the profile photo stays with the look.
    await render({}, () => (
      <AppearanceCard theme={DEFAULT_PAGE_THEME} onChange={() => undefined} extras={extras({})} />
    ));
    await expect.element(page.getByRole('button', { name: 'Upload background photo' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Upload profile photo' }).query()).toBeNull();
    expect(page.getByRole('button', { name: 'Upload cover photo' }).query()).toBeNull();
    await expect.element(page.getByRole('radiogroup', { name: 'Profile photo shape' })).toBeVisible();
  });

  it('shows the account picture the page uses until it has its own, with nothing to remove', async () => {
    await render({}, () => <PagePhotos slots={['avatar', 'cover']} extras={extras({})} avatarStandIn={pixel} />);
    await expect.element(page.getByRole('button', { name: 'Change profile photo' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Remove profile photo' })).not.toBeInTheDocument();
  });

  it('asks before a photo goes, naming that photo, and keeps its words as it closes', async () => {
    const onRemovePhoto = vi.fn();
    await render({}, () => (
      <PagePhotos
        slots={['avatar', 'cover', 'ground']}
        extras={extras({ cover: 'v1', avatar: 'v2', ground: 'v3' }, onRemovePhoto)}
      />
    ));
    await userEvent.click(page.getByRole('button', { name: 'Remove background photo' }));
    await expect.element(page.getByText('Remove the background photo?')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Remove photo' }));
    expect(onRemovePhoto).toHaveBeenCalledWith('ground');
    // Closing, it still names the background photo (the words never fall back to another photo's).
    expect(document.body.textContent).not.toContain('Remove the cover photo?');
    await expect.element(page.getByText('Remove the background photo?')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Remove profile photo' }));
    await expect.element(page.getByText('Remove the profile photo?')).toBeVisible();
    await expect.element(page.getByText('The page goes back to the account photo, or initials.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    expect(onRemovePhoto).toHaveBeenCalledTimes(1);
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

/** The bar's switch beside the overview, as the screen holds them, the overview's Turn on Live through `goLive`. */
function LiveOverview({ data }: { readonly data: DataLayer }) {
  const live = useLinkPageLive(data, 'acme', false);
  return (
    <>
      <LiveSwitch live={live} />
      <LinkPageOverview
        slug="acme"
        handle="ada"
        address="https://timefix.com/ada"
        isPublic={live.isLive}
        isEmpty={false}
        onEdit={() => undefined}
        onAdd={() => undefined}
        onGoLive={live.goLive}
        linkPage={linkPageStore}
        items={[]}
      />
    </>
  );
}

describe('the Live or Private switch (AC-23)', () => {
  it('moves focus to the switch when the overview’s Turn on Live goes away with the Private state', async () => {
    const show = vi.fn((_slug: string, live?: boolean) => Promise.resolve({ isPublic: live ?? true }));
    const walletLink = () => Promise.resolve({});
    const data = { linkPage: { load: () => Promise.resolve({ show, walletLink }) } } as unknown as DataLayer;
    await render(data, () => <LiveOverview data={data} />);
    await userEvent.click(page.getByRole('button', { name: 'Turn on Live' }));
    const live = page.getByRole('switch', { name: 'Live' });
    await expect.element(live).toBeChecked();
    await expect.element(live).toHaveFocus();
    expect(page.getByRole('button', { name: 'Turn on Live' }).query()).toBeNull();
    expect(show).toHaveBeenLastCalledWith('acme', true);
  });

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
