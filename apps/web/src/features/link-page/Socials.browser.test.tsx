// Social icons with its links in Chromium (10 Nov 2026): the Add modal's Social icons tile is never off for want of
// links; its editor holds the person's own set (the same editor as Settings › Profile's), and Add saves the set and
// then the block. Your own set goes through your own links store; on Team pages (and inside a partner's frame) the set
// of someone with no login goes through Team pages, shown at once on the phone and put back if refused; anyone who
// keeps their own shows read only, with where they change it. Checked by axe in both themes.
import '@crm/ui/styles.css';
import type { BlockDraft, DataLayer, LinkPageStore, SocialLink, SocialLinksState } from '@crm/data';
import type { SocialLinkItem } from '@crm/ui';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SocialsEditor } from './editors-reach.tsx';
import { BlockEditorFrame } from './editors.tsx';
import { KindPicker } from './KindPicker.tsx';
import { EmbeddedLinkPages } from './place.tsx';
import { reachStrings } from './reach-strings.ts';
import { ADDABLE, type AddableKind, type SocialsKeeper } from './registry.tsx';
import { strings } from './strings.ts';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

const LINKEDIN: SocialLinkItem = { network: 'linkedin', href: 'https://linkedin.com/in/ada', label: 'ada' };
const SITE: SocialLinkItem = { network: 'website', href: 'https://ada.dev', label: 'ada.dev' };

/** The person's own links store, answering `links`, and what it was asked to change. */
function ownStore(links: readonly SocialLink[]) {
  const change = vi.fn((_slug: string, _links: readonly SocialLink[]) => Promise.resolve(true));
  const state: SocialLinksState = { status: 'ready', links, isSaving: false, canChange: true };
  const access = {
    of: () => ({
      subscribe: () => () => undefined,
      getSnapshot: () => state,
      retain: () => () => undefined,
      retry: () => undefined,
    }),
    change,
  };
  return { change, loadSocials: () => Promise.resolve(access) };
}

/** What a partner's frame leaves out of the Add modal, as the screen does: other modules' blocks. */
const FRAMED_OUT: ReadonlySet<AddableKind> = new Set(['page', 'times', 'form', 'signup', 'menu', 'reserve']);

const linkPage = { check: () => ({ ok: true }) } as unknown as LinkPageStore;

/** The Add modal on Social icons, as the screen draws it, with `keeper` keeping `links`. */
async function render(options: {
  readonly keeper: SocialsKeeper;
  readonly links?: readonly SocialLinkItem[];
  readonly data?: Partial<DataLayer>;
  readonly isEmbedded?: boolean;
  readonly onSubmit?: (draft: BlockDraft) => void;
}) {
  const links = options.links ?? [];
  const frame = (
    <BlockEditorFrame
      title={strings.addTitle}
      hint={strings.addHint}
      leading={
        <KindPicker
          kinds={ADDABLE.filter((kind: AddableKind) => !(options.isEmbedded === true && FRAMED_OUT.has(kind)))}
          value="socials"
          fullReason={() => undefined}
          onChange={() => undefined}
        />
      }
      onClose={() => undefined}
    >
      <SocialsEditor
        chrome={{ submitLabel: strings.addItem }}
        items={[]}
        slug="acme"
        handle="ada"
        newHue="blue"
        linkPage={linkPage}
        socialNetworks={[]}
        ownerName="Ada"
        socialLinks={links}
        socialsKeeper={options.keeper}
        onSubmit={options.onSubmit ?? (() => undefined)}
        onClose={() => undefined}
      />
    </BlockEditorFrame>
  );
  shown = await renderInApp(
    () =>
      options.isEmbedded === true ? (
        <EmbeddedLinkPages place={{ base: '/embed/hub/link-page', canManageTeam: true, workspaceName: 'Acme' }}>
          {frame}
        </EmbeddedLinkPages>
      ) : (
        frame
      ),
    {
      data: options.data ?? { profile: ownStore([]) as unknown as DataLayer['profile'] },
      pattern: '/w/$slug/link-page',
      at: '/w/acme/link-page',
    },
  );
}

/** Adds a row for `network` from Add social link's menu and types `text` into it. */
async function addRow(network: string, text: string) {
  await userEvent.click(page.getByRole('button', { name: 'Add social link' }));
  await userEvent.click(page.getByRole('menuitem', { name: network }));
  // The new row's field takes focus once the menu has gone.
  await expect.element(page.getByRole('textbox', { name: network })).toHaveFocus();
  await userEvent.keyboard(text);
}

describe('Social icons, with its links (10 Nov 2026)', () => {
  it('is offered with no links yet, and Add saves your own set and then the block', async () => {
    const own = ownStore([]);
    const onSubmit = vi.fn();
    await render({ keeper: { kind: 'self' }, data: { profile: own as unknown as DataLayer['profile'] }, onSubmit });
    await expect.element(page.getByRole('radio', { name: 'Social icons' })).toBeEnabled();
    await expect.element(page.getByText('No social links yet')).toBeVisible();
    // Nothing to add until there is a link.
    await expect.element(page.getByRole('button', { name: strings.addItem })).not.toBeInTheDocument();
    await addRow('LinkedIn', 'ada');
    await userEvent.tab();
    await userEvent.click(page.getByRole('button', { name: strings.addItem }));
    expect(own.change).toHaveBeenCalledWith('acme', [{ network: 'linkedin', href: LINKEDIN.href }]);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'socials' }));
  });

  it('adds the block alone when the links are as they were', async () => {
    const own = ownStore([{ network: 'linkedin', href: LINKEDIN.href }]);
    const onSubmit = vi.fn();
    await render({
      keeper: { kind: 'self' },
      links: [LINKEDIN],
      data: { profile: own as unknown as DataLayer['profile'] },
      onSubmit,
    });
    await userEvent.click(page.getByRole('button', { name: strings.addItem }));
    expect(own.change).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('keeps the set of someone with no login through Team pages, shown at once, put back if refused', async () => {
    const setSocials = vi.fn(() => Promise.reject(new Error('down')));
    const onShow = vi.fn();
    const onSubmit = vi.fn();
    await render({
      keeper: { kind: 'team', member: 'm-1', onShow },
      links: [LINKEDIN],
      data: { teamPages: { setSocials } as unknown as DataLayer['teamPages'] },
      isEmbedded: true,
      onSubmit,
    });
    await addRow('Website', 'ada.dev');
    await userEvent.tab();
    await userEvent.click(page.getByRole('button', { name: strings.addItem }));
    expect(setSocials).toHaveBeenCalledWith('acme', 'm-1', [
      { network: 'linkedin', href: LINKEDIN.href },
      { network: 'website', href: SITE.href },
    ]);
    expect(onShow.mock.calls[0]?.[0]).toHaveLength(2);
    expect(onSubmit).toHaveBeenCalledOnce();
    // Refused: their set as it was.
    await vi.waitFor(() => expect(onShow.mock.calls.at(-1)?.[0]).toEqual([LINKEDIN]));
  });

  it('shows the links of someone who keeps their own read only, with where they change them', async () => {
    await render({ keeper: { kind: 'kept' }, links: [LINKEDIN], data: {} });
    await expect.element(page.getByText(reachStrings.socialsKept)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Add social link' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('textbox').first()).toHaveAttribute('readonly');
  });

  it('adds nothing from the keyboard while there is no link', async () => {
    const onSubmit = vi.fn();
    await render({ keeper: { kind: 'self' }, onSubmit });
    await expect.element(page.getByText('No social links yet')).toBeVisible();
    await addRow('LinkedIn', ' ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}{Meta>}{Enter}{/Meta}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says why your links didn’t load, and reads them again on Try again', async () => {
    const own = ownStore([{ network: 'linkedin', href: LINKEDIN.href }]);
    const loadSocials = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(own.loadSocials);
    await render({ keeper: { kind: 'self' }, data: { profile: { loadSocials } as unknown as DataLayer['profile'] } });
    await expect.element(page.getByText('Couldn’t load your social links.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    await expect.element(page.getByRole('textbox', { name: 'LinkedIn' })).toHaveValue('ada');
  });

  it('says only whose they are for someone with none of their own', async () => {
    await render({ keeper: { kind: 'kept' }, links: [], data: {} });
    await expect.element(page.getByText(reachStrings.socialsKept)).toBeVisible();
    await expect.element(page.getByText('No social links yet')).not.toBeInTheDocument();
  });

  it.each(THEMES)('passes axe in %s', async (theme) => {
    await render({
      keeper: { kind: 'self' },
      links: [LINKEDIN, SITE],
      data: { profile: ownStore([LINKEDIN, SITE]) as never },
    });
    applyTheme(theme);
    await expect.element(page.getByRole('textbox', { name: 'LinkedIn' })).toBeVisible();
    // The dialog is still opening: settle it, so axe reads its colours rather than a fade's.
    for (const animation of document.getAnimations()) animation.finish();
    expect(await axeViolations()).toEqual([]);
  });
});

/** Where the lane's screenshots go, when it asks for them; never in CI. */
const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

describe.runIf(SHOT_DIR !== undefined && SHOT_DIR !== '')('Social icons, photographed', () => {
  const cases: readonly {
    readonly name: string;
    readonly keeper: SocialsKeeper;
    readonly links: readonly SocialLinkItem[];
    readonly isEmbedded?: boolean;
  }[] = [
    { name: 'own-empty', keeper: { kind: 'self' }, links: [] },
    { name: 'own-filled', keeper: { kind: 'self' }, links: [LINKEDIN, SITE] },
    { name: 'frame-empty', keeper: { kind: 'self' }, links: [], isEmbedded: true },
    {
      name: 'frame-team-filled',
      keeper: { kind: 'team', member: 'm-1', onShow: () => undefined },
      links: [LINKEDIN],
      isEmbedded: true,
    },
    { name: 'team-empty', keeper: { kind: 'team', member: 'm-1', onShow: () => undefined }, links: [] },
    { name: 'team-filled', keeper: { kind: 'team', member: 'm-1', onShow: () => undefined }, links: [LINKEDIN, SITE] },
    { name: 'team-kept', keeper: { kind: 'kept' }, links: [LINKEDIN] },
  ];
  it.each(cases)('$name', async ({ name, keeper, links, isEmbedded }) => {
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      await render({
        keeper,
        links,
        data: { profile: ownStore(links) as never, teamPages: { setSocials: vi.fn() } as never },
        ...(isEmbedded === true ? { isEmbedded } : {}),
      });
      await expect.element(page.getByRole('radio', { name: 'Social icons' })).toBeVisible();
      // Your own links store answers a moment after the dialog opens.
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (const theme of THEMES) {
        applyTheme(theme);
        for (const animation of document.getAnimations()) animation.finish();
        const dialog = document.querySelector('[role="dialog"]');
        dialog?.querySelector('[role="radiogroup"]')?.scrollIntoView({ block: 'start' });
        await page.screenshot({ path: `${SHOT_DIR ?? ''}/socials-${name}-${theme}-${String(width)}.png` } as never);
        // Then its fields, as the dialog scrolls to them once the tile is picked.
        dialog?.querySelector('form')?.scrollIntoView({ block: 'end' });
        await page.screenshot({
          path: `${SHOT_DIR ?? ''}/socials-${name}-fields-${theme}-${String(width)}.png`,
        } as never);
      }
      shown?.unmount();
      shown = undefined;
    }
    await page.viewport(1280, 900);
  });
});
