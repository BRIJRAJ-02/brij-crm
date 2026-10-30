// Brief
// Purpose: the Link page (spec 0051, built as blocks): what the person's page at /<handle> holds, in order, beside a
// phone that shows it as a visitor will, with one Live or Private switch at the top (spec 0058, AC-23).
// Main task: share the page, or add, edit, move, archive and delete its blocks; every change shows at once, on the
// list and in the phone, and is saved as it is made.
// Leaves out: the bio and the picture (Settings › Profile); a handle is claimed right here when there is none.
import {
  DEFAULT_PAGE_THEME,
  type BlockDraft,
  type BrandStore,
  type DataError,
  type DataLayer,
  type LinkPageStore,
  type MyProfile,
  type PageTheme,
  type ProfileBlock,
  type ProfileItem,
  type PublicSocialLink,
} from '@crm/data';
import {
  BookingFoot,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  focusLater,
  HUES,
  LinkList,
  LinkListRowOrder,
  LinkPage,
  LinkPageTile,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PreviewLayout,
  SocialLinks,
  SpotIllustration,
  TopBar,
  VisuallyHidden,
  type LinkPageBlock,
  type LinkRow,
} from '@crm/ui';
import { useBrand, useLinkPage } from '@crm/data/react';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pageEditorHref, publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
import { AppearanceCard, type PhotoSlot } from './AppearanceCard.tsx';
import { DraftLook } from './draft-look.tsx';
import { preparePhoto } from './photo-prep.ts';
import { ClaimLink } from './ClaimLink.tsx';
import { BlockEditorFrame } from './editors.tsx';
import { SharingCard } from './SharingCard.tsx';
import { SocialsCardSlot } from '../booking/socials-slot.tsx';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import {
  ADDABLE,
  blockKindOf,
  BLOCK_KINDS,
  contactHref,
  figuresLine,
  pressesChip,
  previewBlock,
  rowWords,
  type AddableKind,
  type ChosenFacts,
} from './registry.tsx';
import { ImportLinksModal } from './ImportLinksModal.tsx';
import { DeleteBlockDialog, KindPicker } from './KindPicker.tsx';
import { LinkPageOverview } from './LinkPageOverview.tsx';
import { LiveSwitch, useLinkPageLive, type LinkPageLive } from './private-page.tsx';
import { ShareLinkPageModal } from './ShareLinkPageModal.tsx';
import { strings } from './strings.ts';

/** Props for the Link page screen. */
export interface LinkPageScreenProps {
  /** The data layer, for the cards that load a store of their own (the social links). */
  readonly data: DataLayer;
  /** The link page's store (`data.linkPage.load()`, loaded with the route). */
  readonly linkPage: LinkPageStore;
  /** The page's colour and photos (`data.brand.load()`, loaded beside it, spec 0060). */
  readonly brand: BrandStore;
  readonly slug: string;
  readonly profile: MyProfile;
  /** The editor is open; without it the page opens on the overview, which shares it (27 Oct 2026). */
  readonly isEditing: boolean;
  /** Opens or closes the editor, as a change of the page's own address, so Back leaves the editor. */
  readonly onEditing: (isEditing: boolean) => void;
}

/** Which editor is open: a kind's add, or a block's edit. */
/**
 * The Modal open: its kind, the block being edited (none for an add), and the id its save goes under, minted as it
 * opens, so a second press of Add before the Modal closes saves the same block again rather than a second one.
 */
type Editing = { readonly kind: AddableKind; readonly item?: ProfileItem; readonly id: string };

/** A new link's letter colour: the next of the hues after the links so far, gray last, as the server would pick. */
/**
 * The editor's dialog, or the editor alone. Adding draws the chosen kind inside one Add modal that outlives the
 * kind being changed (`BlockEditorFrame`); editing draws the kind's own editor, which brings its Modal with it,
 * since nothing swaps under it.
 */
function EditorOrFrame({
  frame,
  onClose,
  children,
}: {
  readonly frame?: { readonly leading: ReactNode; readonly hint: string };
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  if (frame === undefined) return children;
  return (
    <BlockEditorFrame title={strings.addTitle} hint={frame.hint} leading={frame.leading} onClose={onClose}>
      {children}
    </BlockEditorFrame>
  );
}

/** How long after the last look is picked the one save goes out. Long enough to cover a run of choices, short
 * enough that nobody leaves before it fires; leaving sends it anyway. */
const THEME_SAVE_DELAY = 500;

/** Whether two looks are the same six words, so an answer that changed nothing costs no render. */
function sameTheme(one: PageTheme, other: PageTheme | undefined): boolean {
  if (other === undefined) return false;
  const keys = ['ground', 'hue', 'mode', 'shape', 'fill', 'font'] as const;
  return keys.every((key) => one[key] === other[key]);
}

function nextHue(items: readonly ProfileItem[]) {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[items.filter((item) => item.kind === 'link').length % ring.length] ?? 'blue';
}

/** The block as the list shows it before the server answers: the checked block, as the server will store it. */
function shownItem(id: string, block: ProfileBlock, was: ProfileItem | undefined, facts?: ChosenFacts): ProfileItem {
  const updatedAt = new Date().toISOString();
  if (block.kind === 'heading') return { kind: 'heading', id, title: block.title, updatedAt };
  if (block.kind === 'page') {
    const page = facts !== undefined && 'page' in facts ? facts.page : undefined;
    return { ...block, id, ...(page === undefined ? {} : { page }), updatedAt };
  }
  if (block.kind === 'form') {
    const form = facts !== undefined && 'form' in facts ? facts.form : undefined;
    return { ...block, id, ...(form === undefined ? {} : { form }), updatedAt };
  }
  if (block.kind === 'contact') return { ...block, id, updatedAt };
  if (block.kind === 'text' || block.kind === 'faq' || block.kind === 'testimonial') {
    return { ...block, id, updatedAt };
  }
  return { ...block, id, hue: block.hue ?? (was?.kind === 'link' ? was.hue : 'blue'), updatedAt };
}

/** The link page editor: the blocks beside the phone. */
export function LinkPageScreen({ data, linkPage, brand, slug, profile, isEditing, onEditing }: LinkPageScreenProps) {
  const handle = profile.handle;
  // Live or Private (spec 0058, AC-23): opening the screen is what puts a page made for its owner live, once.
  const live = useLinkPageLive(data, slug, profile.isPublic, { opens: handle !== undefined });
  return (
    // A page of the workspace since 25 October 2026, not a view inside Settings › Account › Profile: its own row
    // in the sidebar, its own bar, and no trail of configuration above it (the owner).
    <WorkspacePage
      currentPage="linkPage"
      page={{
        topBar: (
          <TopBar title={strings.title} icon="id-card">
            {handle === undefined ? undefined : (
              <HeaderActions
                live={live}
                handle={handle}
                workspaceName={profile.workspaceName}
                isEditing={isEditing}
                onEditing={onEditing}
              />
            )}
          </TopBar>
        ),
        body:
          handle === undefined ? (
            <PreviewLayout>
              <Card>
                <ClaimLink data={data} slug={slug} suggested={profile.suggestedHandle} />
              </Card>
            </PreviewLayout>
          ) : (
            <Blocks
              data={data}
              linkPage={linkPage}
              brand={brand}
              slug={slug}
              profile={profile}
              handle={handle}
              isLive={live.isLive}
              isEditing={isEditing}
              onEditing={onEditing}
            />
          ),
      }}
    />
  );
}

/**
 * The header's actions, as the owner's design draws them: the one Live or Private switch (spec 0058, AC-23), the
 * page's address as a pill that opens it, and Share, which opens the one Share modal (the QR, the address and the
 * two ways to go on; Home's card opens the same one). Sharing never changes whether the page is live: the switch is
 * the one place that does, and the modal says when the page is private.
 */
function HeaderActions({
  live,
  handle,
  workspaceName,
  isEditing,
  onEditing,
}: {
  readonly live: LinkPageLive;
  readonly handle: string;
  readonly workspaceName?: string | undefined;
  readonly isEditing: boolean;
  readonly onEditing: (isEditing: boolean) => void;
}) {
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  const [isSharing, setSharing] = useState(false);
  return (
    <>
      <LiveSwitch live={live} />
      <ButtonLink
        variant="secondary"
        isRound
        // While private the address carries a lock, so the bar says Private in edit mode too, beside the switch.
        {...(live.isLive ? {} : { icon: 'lock' as const })}
        iconRight="external-link"
        href={address}
        isExternal
        label={live.isLive ? strings.openAddress(shown) : strings.openPrivateAddress(shown)}
      >
        {shown}
      </ButtonLink>
      <Button icon="share" onPress={() => setSharing(true)}>
        {strings.share}
      </Button>
      {/* Edit page lives on the page's own card; the bar carries only the way back out of the builder. */}
      {isEditing && (
        <Button variant="primary" icon="check" onPress={() => onEditing(false)}>
          {strings.doneEditing}
        </Button>
      )}
      <ShareLinkPageModal
        address={address}
        handle={handle}
        workspaceName={workspaceName}
        isPublic={live.isLive}
        onGoLive={() => live.setLive(true)}
        isOpen={isSharing}
        onClose={() => setSharing(false)}
      />
    </>
  );
}

/** The blocks, their editors and the phone, once the person has a handle. */
function Blocks({
  data,
  linkPage,
  brand,
  slug,
  profile,
  handle,
  isLive,
  isEditing,
  onEditing,
}: {
  readonly data: DataLayer;
  readonly linkPage: LinkPageStore;
  readonly brand: BrandStore;
  readonly slug: string;
  readonly profile: MyProfile;
  readonly handle: string;
  /** Whether the page is Live, as the switch in the bar holds it (spec 0058, AC-23). */
  readonly isLive: boolean;
  readonly isEditing: boolean;
  readonly onEditing: (isEditing: boolean) => void;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const held = linkPage.view(slug);
  const state = useLinkPage(held);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProfileItem | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setImporting] = useState(false);
  // Their social links as the card below holds them now, so the phone follows an edit before the profile is read
  // again; undefined until the card has loaded its store, when the profile's own set stands.
  const [socialPreview, setSocialPreview] = useState<readonly PublicSocialLink[] | undefined>(undefined);
  // The card's set once it has one, else what the profile was read with; either way labelled as a visitor sees it.
  const shownSocials = useMemo(
    () =>
      socialPreview ??
      (profile.socials ?? []).map((link) => ({ ...link, label: link.href.replace(/^https?:\/\//, '') })),
    [socialPreview, profile.socials],
  );
  // What a menu's move says to screen readers; a drag says its own.
  const [said, setSaid] = useState('');
  // The look, shown the moment it is picked and saved behind it (AC-5421). A refusal puts back what was there and
  // says why on the card, where the control that changed is.
  const [picked, setPicked] = useState<PageTheme | undefined>(undefined);
  const [themeRefusal, setThemeRefusal] = useState<DataError | undefined>(undefined);
  const theme = picked ?? profile.theme ?? DEFAULT_PAGE_THEME;
  // What is on screen and what to put back, as refs: the save below runs after the picking has stopped, so it
  // reads them then rather than closing over the render that scheduled it.
  const shown = useRef<PageTheme | undefined>(undefined);
  const before = useRef<PageTheme | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Reads nothing but those refs and this screen's own props, so the copy the unmount holds is as good as any.
  const sendTheme = () => {
    timer.current = undefined;
    const next = shown.current;
    const was = before.current;
    if (next === undefined || was === undefined) return;
    void linkPage.saveTheme(slug, next).then(
      (saved) => {
        before.current = saved;
        // Only when the answer is a different look from the one on screen: setting the same six words again is a
        // render of the whole page, and the preview with it, for nothing at all.
        if (!sameTheme(saved, shown.current)) {
          shown.current = saved;
          setPicked(saved);
        }
      },
      (error: unknown) => {
        shown.current = was;
        setPicked(was);
        setThemeRefusal(error instanceof Error ? (error as DataError) : undefined);
      },
    );
  };
  // Leaving mid picking saves what was picked rather than dropping it: the request outlives this screen.
  useEffect(
    () => () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      sendTheme();
    },
    // The screen's props never change under it, so the first render's `sendTheme` is the only one there is.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a cleanup that reads refs alone
    [],
  );
  /**
   * A look is shown the moment it is picked (AC-5421) and saved once the picking stops. Dressing a page is half a
   * dozen choices in a few seconds, and each one used to be its own round trip whose answer set the state again:
   * production logged 19 saves in 15 seconds, every one of them re drawing the preview (25 October 2026).
   */
  const chooseTheme = (next: PageTheme) => {
    // The look to put back is the one before this run of choices, not the one half a second ago.
    before.current ??= theme;
    shown.current = next;
    setPicked(next);
    setThemeRefusal(undefined);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(sendTheme, THEME_SAVE_DELAY);
  };
  // The page's own colour and photos (spec 0060, AC-14, AC-10, AC-13), the workspace's accent it follows, and the
  // colour under the system picker's pointer while it is dragged, so the phone follows the drag before it settles.
  const lookState = useBrand(brand.look(slug));
  const extrasRead = lookState.status === 'ready' ? lookState.value : undefined;
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  const [lookRefusal, setLookRefusal] = useState<DataError | undefined>(undefined);
  const [sending, setSending] = useState<PhotoSlot | undefined>(undefined);
  const ownAccent = dragged ?? extrasRead?.accent;
  const colours =
    ownAccent === undefined
      ? brand.colours(extrasRead?.workspaceAccent, extrasRead?.workspaceAccentDark)
      : brand.colours(ownAccent, extrasRead?.accentDark);
  const photoSrc = (slot: PhotoSlot, version: string) => brand.photoSrc(handle, slot, version);
  const lookVariables = useMemo(() => {
    const photoPairs = (['cover', 'ground'] as const).flatMap((slot) => {
      const version = extrasRead?.[slot];
      const src = version === undefined ? undefined : brand.photoSrc(handle, slot, version);
      return src === undefined ? [] : [[`--page-${slot}-image`, `url("${src}")`] as const];
    });
    return [...(colours?.variables ?? []), ...photoPairs];
  }, [colours, extrasRead, brand, handle]);
  const lookPhotos = { cover: extrasRead?.cover !== undefined, ground: extrasRead?.ground !== undefined };
  const chooseAccent = (accent: string | undefined, accentDark: string | undefined) => {
    setDragged(undefined);
    setLookRefusal(undefined);
    void brand.saveAccent(slug, accent, accentDark).then((refused) => {
      if (refused !== undefined) setLookRefusal(refused);
    });
  };
  const choosePhoto = (slot: PhotoSlot, file: File) => {
    setLookRefusal(undefined);
    setSending(slot);
    void preparePhoto(file, slot)
      .then(
        (image) => brand.uploadPhoto(slug, slot, image),
        () => {
          toasts.toast({ tone: 'danger', message: strings.photoUnreadable });
          return undefined;
        },
      )
      .then((refused) => {
        if (refused !== undefined) setLookRefusal(refused);
      })
      .finally(() => {
        setSending(undefined);
      });
  };
  const removePhoto = (slot: PhotoSlot) => {
    setLookRefusal(undefined);
    void brand.removePhoto(slug, slot).then((refused) => {
      if (refused !== undefined) setLookRefusal(refused);
    });
  };
  // Whether search engines may show the page (spec 0055, AC-5506), the same shape as the look above: shown the
  // moment it is pressed, put back with its reason on the card if the save is refused.
  const [switched, setSwitched] = useState<boolean | undefined>(undefined);
  const [indexableRefusal, setIndexableRefusal] = useState<DataError | undefined>(undefined);
  const indexable = switched ?? profile.indexable ?? true;
  const chooseIndexable = (next: boolean) => {
    const was = indexable;
    setSwitched(next);
    setIndexableRefusal(undefined);
    void linkPage.setIndexable(slug, next).then(
      (saved) => {
        setSwitched(saved.indexable);
      },
      (error: unknown) => {
        setSwitched(was);
        setIndexableRefusal(error instanceof Error ? (error as DataError) : undefined);
      },
    );
  };
  // The picture a pasted link shows instead of the drawn card (AC-5511). Shown the moment it is chosen, as the
  // two above are; a refusal puts back what was there and says why on the same card.
  const [chosenShare, setChosenShare] = useState<string | undefined>(undefined);
  const [sharePicked, setSharePicked] = useState(false);
  const shareImage = sharePicked ? chosenShare : profile.shareImage;
  const chooseShareImage = (image: { readonly type: string; readonly base64: string } | undefined) => {
    const was = shareImage;
    setIndexableRefusal(undefined);
    // Drawn from the bytes in hand, so the preview changes with the press rather than after the round trip.
    setChosenShare(image === undefined ? undefined : `data:${image.type};base64,${image.base64}`);
    setSharePicked(true);
    // The picker's own word for the file, narrowed to what the procedure takes; the server reads the bytes anyway.
    const kind: 'image/png' | 'image/jpeg' | undefined =
      image?.type === 'image/png' ? 'image/png' : image?.type === 'image/jpeg' ? 'image/jpeg' : undefined;
    const sent = image === undefined || kind === undefined ? undefined : { type: kind, base64: image.base64 };
    void linkPage.setShareImage(slug, sent).then(
      (saved) => {
        setChosenShare(saved.shareImage);
      },
      (error: unknown) => {
        setChosenShare(was);
        setIndexableRefusal(error instanceof Error ? (error as DataError) : undefined);
      },
    );
  };
  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state]);
  const counts = state.status === 'ready' ? state.counts : undefined;
  const socialNetworks = useMemo(() => (profile.socials ?? []).map((link) => link.network), [profile.socials]);
  const archived = state.status === 'ready' ? state.archived : [];
  const pending = state.status === 'ready' ? state.pendingIds : new Set<string>();

  const move = (id: string, toIndex: number) => {
    const ids = items.map((item) => item.id).filter((each) => each !== id);
    const at = Math.max(0, Math.min(toIndex, ids.length));
    const next = [...ids.slice(0, at), id, ...ids.slice(at)];
    void linkPage.order(slug, next);
  };
  const moveFromMenu = (item: ProfileItem, toIndex: number) => {
    setSaid(strings.moved(rowWords(item).title, toIndex + 1, items.length));
    move(item.id, toIndex);
  };
  /**
   * Focus after a row leaves (archived, deleted, restored): the menu of the row now in its place, else the one before,
   * else Add, so a keyboard never lands back at the top of the page.
   */
  const focusNear = (grid: string, index: number) => {
    focusLater(() => {
      const list = document.querySelector(`[role="grid"][aria-label="${grid}"]`);
      const buttons = [...(list?.querySelectorAll<HTMLElement>('[role="row"] [role="group"] button') ?? [])];
      const rowsNow = [...(list?.querySelectorAll<HTMLElement>('[role="row"]') ?? [])];
      const row = rowsNow[Math.min(index, rowsNow.length - 1)];
      const inRow = row?.querySelector<HTMLElement>('[role="group"] button');
      if (inRow !== null && inRow !== undefined) return inRow;
      if (buttons.length > 0) return buttons.at(-1);
      return [...document.querySelectorAll<HTMLElement>('button')].find(
        (button) => button.textContent.trim() === strings.add,
      );
    });
  };
  const archive = (item: ProfileItem, index: number) => {
    const before = items.map((each) => each.id);
    void linkPage.archive(slug, item.id, true);
    focusNear(strings.blocks, index);
    // One press, so it says what it did, and Undo puts it back in its place.
    toasts.toast({
      tone: 'success',
      message: strings.archived1(rowWords(item).title),
      action: {
        label: strings.undo,
        onAction: () => {
          void linkPage.archive(slug, item.id, false);
          void linkPage.order(slug, before);
        },
      },
    });
  };
  const restore = (item: ProfileItem, index: number) => {
    // A kind that is full can't take this one back (the one contact card, the 12 headings): said at once, rather
    // than shown and then put back when the server refuses it.
    const full = linkPage.limit(items, item.kind);
    if (full !== undefined) {
      toasts.toast({ tone: 'danger', message: full });
      return;
    }
    void linkPage.archive(slug, item.id, false);
    focusNear(strings.archived, index);
  };
  const copy = (href: string) => {
    navigator.clipboard.writeText(href).then(
      () => toasts.toast({ tone: 'success', message: strings.copied }),
      () => toasts.toast({ tone: 'danger', message: strings.copyFailed }),
    );
  };
  const copyHrefOf = (item: ProfileItem): string | undefined => {
    if (item.kind === 'link') return item.url;
    // The card's vCard, as a visitor saves it: the same address Save contact opens, and a QR code can carry.
    if (item.kind === 'contact') return `${publicBookingOrigin()}${contactHref(handle)}`;
    if (item.kind === 'page' && item.page !== undefined) {
      return `${publicBookingOrigin()}/${encodeURIComponent(handle)}/${encodeURIComponent(item.page.slug)}`;
    }
    return undefined;
  };
  const submit = (draft: BlockDraft, facts?: ChosenFacts) => {
    const was = editing?.item;
    setEditing(undefined);
    const withHue: BlockDraft =
      draft.kind === 'link' && draft.hue === undefined ? { ...draft, hue: nextHue(items) } : draft;
    const checked = linkPage.check(withHue, items, was?.id);
    if (!checked.ok) return;
    const id = was?.id ?? editing?.id ?? linkPage.newId();
    void linkPage.save(slug, id, checked.block, shownItem(id, checked.block, was, facts));
  };

  const rowMenu = (item: ProfileItem, index: number) => {
    const words = rowWords(item);
    const href = copyHrefOf(item);
    const kind = BLOCK_KINDS[item.kind];
    return (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.moreFor(words.title)} />
        <Menu label={strings.moreFor(words.title)}>
          {kind.isEditable && (
            <MenuItem id="edit" icon="pencil" onAction={() => setEditing({ kind: item.kind, item, id: item.id })}>
              {strings.edit}
            </MenuItem>
          )}
          {href !== undefined && (
            <MenuItem id="copy" icon="copy" onAction={() => copy(href)}>
              {strings.copyLink}
            </MenuItem>
          )}
          {index > 0 && (
            <MenuItem id="up" icon="chevron-up" onAction={() => moveFromMenu(item, index - 1)}>
              {strings.moveUp}
            </MenuItem>
          )}
          {index < items.length - 1 && (
            <MenuItem id="down" icon="chevron-down" onAction={() => moveFromMenu(item, index + 1)}>
              {strings.moveDown}
            </MenuItem>
          )}
          <MenuSeparator />
          {item.kind === 'page' && item.page !== undefined && (
            <MenuItem id="page" icon="calendar-clock" href={pageEditorHref(item.page.workspaceSlug, item.pageId)}>
              {strings.editPage}
            </MenuItem>
          )}
          <MenuItem id="archive" icon="archive" onAction={() => archive(item, index)}>
            {strings.archive}
          </MenuItem>
          <MenuItem id="delete" icon="trash" isDanger onAction={() => setDeleting(item)}>
            {strings.remove}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
  };

  const tileOf = (item: ProfileItem): LinkPageBlock => {
    const block = previewBlock(item, handle, linkPage.markOf);
    if (block !== undefined) return block;
    // A paused or unavailable page still shows its calendar tile in the list.
    return { kind: 'page', id: item.id, title: rowWords(item).title, href: '', facts: '' };
  };
  // A section heads everything after it until the next one, which is what its count says.
  const underSection = (at: number) => {
    let count = 0;
    for (let index = at + 1; index < items.length; index += 1) {
      if (items[index]?.kind === 'heading') break;
      count += 1;
    }
    return count;
  };
  const rows: LinkRow[] = items.map((item, index) => {
    const words = rowWords(item);
    const isPending = pending.has(item.id);
    if (item.kind === 'heading') {
      return {
        id: item.id,
        title: words.title,
        address: '',
        chips: [],
        variant: 'section',
        count: underSection(index),
        ...(isPending ? { isPending: true } : { actions: rowMenu(item, index) }),
      };
    }
    return {
      id: item.id,
      title: words.title,
      address: words.address,
      // Its presses over 30 days, once the figures are here (a pending block has none yet). The figures are read
      // apart from the blocks, so until they land the chip's line is held, and the row never grows under a thumb.
      chips: isPending ? [] : pressesChip(item, counts),
      ...(isPending || counts !== undefined || (state.status === 'ready' && state.countsFailed === true)
        ? {}
        : { areChipsPending: true }),
      leading: <LinkPageTile block={tileOf(item)} />,
      ...(words.badge === undefined ? {} : { badge: words.badge }),
      ...(words.isOff === true ? { isOff: true } : {}),
      ...(isPending ? { isPending: true } : { actions: rowMenu(item, index) }),
      ...(item.kind === 'page' && item.page !== undefined
        ? { href: pageEditorHref(item.page.workspaceSlug, item.pageId) }
        : {}),
    };
  });

  // The owner's design adds every kind in one modal: the picker chooses the kind, the fields follow it, and the
  // kind swaps in place rather than closing one dialog to open another. An edit opens its kind's editor alone.
  // A button opens the modal on the kind it names, unless that kind is full: then it opens on the first kind that
  // isn't, so the picker never opens on a choice that can't be taken. Every kind full disables the button.
  // Email signup makes a form block, so what it needs room for is a form (`blockKindOf`), not a kind of its own.
  const roomFor = (kind: AddableKind) => linkPage.limit(items, blockKindOf(kind)) === undefined;
  const openAdd = (kind: AddableKind) => {
    const open = roomFor(kind) ? kind : ADDABLE.find(roomFor);
    if (open !== undefined) setEditing({ kind: open, id: linkPage.newId() });
  };
  const isFull = !ADDABLE.some(roomFor);
  const addButtons = (
    <>
      {/* Bringing a page across (spec 0055, AC-5524). Secondary, as Button's README puts Import with the view
          controls: it is the thing a new arrival most wants, and a third weight in a row of three buttons made
          it the hardest to see. The order carries the hierarchy instead. */}
      <Button icon="download" isDisabled={state.status !== 'ready' || isFull} onPress={() => setImporting(true)}>
        {strings.bringAcross}
      </Button>
      <Button
        icon="list-plus"
        isDisabled={state.status !== 'ready' || !roomFor('heading')}
        onPress={() => openAdd('heading')}
      >
        {strings.newSection}
      </Button>
      <Button
        variant="primary"
        icon="plus"
        isDisabled={state.status !== 'ready' || isFull}
        onPress={() => openAdd('link')}
      >
        {strings.addItem}
      </Button>
    </>
  );
  // A full kind's tile is off and can't take focus, so why it is full is said in the footer's line too, where a
  // keyboard reaches it; with nothing full the line says where the block lands.
  const fullReasons = [...new Set(ADDABLE.flatMap((kind) => linkPage.limit(items, blockKindOf(kind)) ?? []))];
  const addHint = fullReasons.length === 0 ? strings.addHint : fullReasons.join(' ');
  // The kinds as a grid of icons with a short name each (spec 0058, AC-9), only while adding.
  const kindPicker =
    editing === undefined || editing.item !== undefined ? undefined : (
      <KindPicker
        value={editing.kind}
        fullReason={(kind) => linkPage.limit(items, blockKindOf(kind))}
        // The id is minted once and kept as the kind changes, so the save that follows is still the one add.
        onChange={(kind) => setEditing({ kind, id: editing.id })}
      />
    );

  const previewBlocks = items.flatMap((item) => {
    const block = previewBlock(item, handle, linkPage.markOf);
    return block === undefined ? [] : [block];
  });
  const preview = (
    <LinkPage
      isPreview
      // What a visitor sees at the foot of the page: the editor hid it, so the preview was not the page (the
      // owner, 25 October 2026). ProfilePage draws the same footer live. Its "Claim your free page" link is left
      // out here: it is for a visitor without a page, not for the person whose page this is, and `claimPageHref`
      // lives on the public pages' own entry, which the app's bundle has no reason to pull in.
      // The phone beside the editor shows the look being picked, so its mark follows that, not the app's theme.
      foot={<BookingFoot page="booking_profile" {...(theme.mode === 'system' ? {} : { scheme: theme.mode })} />}
      // A new look remounts the phone, which fades the page in on its new ground (spec 0060, AC-18).
      key={[
        theme.ground,
        theme.hue,
        theme.mode,
        theme.shape,
        theme.fill,
        theme.font,
        theme.gradient,
        theme.pattern,
        theme.header,
        theme.avatar,
      ].join(' ')}
      person={{
        name: profile.name.trim() || handle,
        id: handle,
        bio: profile.bio,
        ...(profile.image === undefined || profile.pictureHidden === true ? {} : { image: profile.image }),
      }}
      {...(state.status === 'ready' ? { blocks: previewBlocks } : {})}
      theme={theme}
      photos={lookPhotos}
      variables={lookVariables}
      // Their own set of networks (the Social links card below), under the bio as visitors see it.
      {...(shownSocials.length === 0 ? {} : { socials: <SocialLinks links={shownSocials} /> })}
      empty={
        <EmptyState title={strings.empty} icon="link">
          {strings.emptyText}
        </EmptyState>
      }
    />
  );

  let list;
  if (state.status === 'loading') {
    list = (
      <LinkList
        label={strings.blocks}
        searchLabel={strings.blocks}
        placement="card"
        isToolbarHidden
        leadingLoading={<LinkPageTile />}
        rows={[]}
        status="loading"
        onOpen={() => undefined}
        onMove={() => undefined}
        rowOrder={LinkListRowOrder}
      />
    );
  } else if (state.status === 'error') {
    list = (
      <LinkList
        label={strings.blocks}
        searchLabel={strings.blocks}
        placement="card"
        isToolbarHidden
        rows={[]}
        status="error"
        errorTitle={strings.failed}
        onRetry={() => held.retry()}
        onOpen={() => undefined}
      />
    );
  } else if (items.length === 0) {
    // The first empty moment (spec 0058, AC-8): the drawing, one line and the one primary, Add item, with bringing an
    // old page across beside it. The card's footer steps aside meanwhile, so nothing is offered twice.
    // Once an import has landed its rows wait in Archived below: the line says so, and Bring a page across steps
    // aside rather than offering the same page again.
    const hasArchived = archived.length > 0;
    list = (
      <EmptyState
        illustration={<SpotIllustration kind="link-page" />}
        title={strings.empty}
        actions={
          <>
            {!hasArchived && (
              <Button icon="download" isDisabled={isFull} onPress={() => setImporting(true)}>
                {strings.bringAcross}
              </Button>
            )}
            <Button variant="primary" icon="plus" isDisabled={isFull} onPress={() => openAdd('link')}>
              {strings.addItem}
            </Button>
          </>
        }
      >
        {hasArchived ? strings.emptyArchived : strings.emptyText}
      </EmptyState>
    );
  } else {
    list = (
      <LinkList
        label={strings.blocks}
        searchLabel={strings.blocks}
        placement="card"
        isToolbarHidden
        leadingLoading={<LinkPageTile />}
        rows={rows}
        onOpen={(id) => {
          const item = items.find((each) => each.id === id);
          if (item === undefined) return;
          if (BLOCK_KINDS[item.kind].isEditable) setEditing({ kind: item.kind, item, id: item.id });
          // A booking page block opens the booking page's own editor, in its workspace.
          else if (item.kind === 'page' && item.page !== undefined) {
            void navigate({ href: pageEditorHref(item.page.workspaceSlug, item.pageId) });
          }
        }}
        onMove={move}
        rowOrder={LinkListRowOrder}
      />
    );
  }

  const Editor = editing === undefined ? undefined : BLOCK_KINDS[editing.kind].Editor;
  // What the page opens on: the page as something to hand out, the phone beside it showing exactly what a visitor
  // gets. Everything that changes the page is one press away, under Edit page (the owner, 27 October 2026).
  if (!isEditing) {
    return (
      <PreviewLayout preview={preview} previewShare="wide">
        <LinkPageOverview
          data={data}
          slug={slug}
          handle={handle}
          address={publicProfileUrl(handle)}
          isPublic={isLive}
          isEmpty={state.status === 'ready' && items.length === 0}
          onEdit={() => onEditing(true)}
          onAdd={() => {
            onEditing(true);
            openAdd('link');
          }}
        />
      </PreviewLayout>
    );
  }
  return (
    <PreviewLayout preview={preview} previewShare="wide">
      {/* What is on the page comes first (its blocks, the archived ones, the social links), then how it looks:
          content is what the editor is opened for (flow walks, 29 October 2026: L2). */}
      <Card
        title={strings.blocks}
        description={[
          // Whose page this is: each workspace has its own (spec 0056, AC-5617).
          ...(profile.workspaceName === undefined ? [] : [strings.inWorkspace(profile.workspaceName)]),
          counts !== undefined
            ? `${strings.blocksText} ${figuresLine(counts)}`
            : state.status === 'ready' && state.countsFailed === true
              ? `${strings.blocksText} ${strings.countsFailed}`
              : strings.blocksText,
        ].join(' ')}
        {...(state.status === 'ready' && items.length === 0 ? {} : { footer: addButtons })}
      >
        {list}
      </Card>
      {archived.length > 0 && (
        <Card title={strings.archived} description={strings.archivedText}>
          <LinkList
            label={strings.archived}
            searchLabel={strings.archived}
            placement="card"
            isToolbarHidden
            leadingLoading={<LinkPageTile />}
            rows={archived.map((item, index) => {
              const words = rowWords(item);
              return {
                id: item.id,
                title: words.title,
                address: words.address,
                chips: [],
                isOff: true,
                leading: <LinkPageTile block={tileOf(item)} />,
                actions: (
                  <>
                    <Button variant="ghost" icon="archive-restore" onPress={() => restore(item, index)}>
                      {strings.restore}
                    </Button>
                    <Button
                      variant="ghost"
                      icon="trash"
                      label={strings.removeFor(words.title)}
                      onPress={() => setDeleting(item)}
                    />
                  </>
                ),
              };
            })}
            onOpen={() => undefined}
          />
        </Card>
      )}
      {/* Their own set of links, changed here rather than only inside a booking page's editor (the owner, 26
          October 2026): a link page always shows them, so this card has no switch. */}
      <SocialsCardSlot data={data} slug={slug} onPreviewLinks={setSocialPreview} isTeam={false} isOwner />
      {/* Only where there is a page to dress: the screen already sends a person with no handle to Profile. */}
      <AppearanceCard
        theme={theme}
        onChange={chooseTheme}
        {...(themeRefusal === undefined
          ? lookRefusal === undefined
            ? {}
            : { refusal: lookRefusal }
          : { refusal: themeRefusal })}
        extras={{
          look: extrasRead,
          colours: brand.colours,
          variables: lookVariables,
          quickPicks: brand.quickPicks,
          photoSrc,
          onAccent: chooseAccent,
          onPreviewAccent: setDragged,
          onPhoto: choosePhoto,
          onRemovePhoto: removePhoto,
          ...(sending === undefined ? {} : { sending }),
        }}
      />
      <SharingCard
        indexable={indexable}
        {...(shareImage === undefined ? {} : { shareImage })}
        onShareImage={chooseShareImage}
        onChange={chooseIndexable}
        {...(indexableRefusal === undefined ? {} : { refusal: indexableRefusal })}
      />
      {Editor !== undefined && editing !== undefined && (
        // The draft wears the page's own look (spec 0060, AC-16), as the phone does.
        <DraftLook look={{ theme, photos: lookPhotos, variables: lookVariables }}>
          <EditorOrFrame
            // Adding keeps one dialog across the kinds (the frame owns it); editing opens the kind's own, as before.
            {...(kindPicker === undefined ? {} : { frame: { leading: kindPicker, hint: addHint } })}
            onClose={() => setEditing(undefined)}
          >
            <Editor
              {...(editing.item === undefined ? {} : { item: editing.item })}
              {...(kindPicker === undefined ? {} : { chrome: { submitLabel: strings.addItem } })}
              items={items}
              slug={slug}
              handle={handle}
              newHue={nextHue(items)}
              linkPage={linkPage}
              socialNetworks={socialNetworks}
              ownerName={profile.name}
              onSubmit={submit}
              onClose={() => setEditing(undefined)}
            />
          </EditorOrFrame>
        </DraftLook>
      )}
      {deleting !== undefined && (
        <DeleteBlockDialog
          item={deleting}
          isBusy={isDeleting}
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            setIsDeleting(true);
            const live = items.findIndex((each) => each.id === deleting.id);
            const grid = live === -1 ? strings.archived : strings.blocks;
            const index = live === -1 ? archived.findIndex((each) => each.id === deleting.id) : live;
            void linkPage.remove(slug, deleting.id).finally(() => {
              setIsDeleting(false);
              setDeleting(undefined);
              focusNear(grid, index);
            });
          }}
        />
      )}
      {isImporting && (
        <ImportLinksModal
          isOpen
          archived={archived}
          newId={linkPage.newId}
          onClose={() => setImporting(false)}
          onImport={(id, url) => linkPage.importLinks(slug, id, url)}
        />
      )}
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </PreviewLayout>
  );
}
