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
  Callout,
  Card,
  CopyButton,
  EmptyState,
  focusLater,
  HUES,
  memoIntl,
  useFormatSettings,
  LinkList,
  LinkListRowOrder,
  LinkPage,
  LinkPageTile,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PreviewLayout,
  SegmentedControl,
  SocialLinks,
  SpotIllustration,
  TopBar,
  usePhotoCrop,
  VisuallyHidden,
  type AccentQuickPick,
  type LinkPageBlock,
  type LinkRow,
} from '@crm/ui';
import { preparePhoto } from '@crm/ui/photo';
import { useBrand, useLinkPage } from '@crm/data/react';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pageEditorHref, publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
import { AppearanceCard, type PhotoSlot } from './AppearanceCard.tsx';
import { LinkPublishBar } from './LinkPublishBar.tsx';
import { DraftLook } from './draft-look.tsx';
import { ClaimLink } from './ClaimLink.tsx';
import { BlockEditorFrame } from './editors.tsx';
import { IdentityFields, identityOf, type PageIdentity } from './IdentityFields.tsx';
import { PagePhotos } from './PagePhotos.tsx';
import { SharingFields } from './SharingFields.tsx';
import { SocialsCardSlot } from '../booking/socials-slot.tsx';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { useLinkPagePlace } from './place.tsx';
import {
  ADDABLE,
  blockKindOf,
  BLOCK_KINDS,
  contactHref,
  pressesFigure,
  previewBlock,
  rowWords,
  type AddableKind,
  type AfterSave,
  type ChosenFacts,
} from './registry.tsx';
import { reachStrings } from './reach-strings.ts';
import { ImportLinksModal } from './ImportLinksModal.tsx';
import { DeleteBlockDialog, KindPicker } from './KindPicker.tsx';
import { LinkPageOverview } from './LinkPageOverview.tsx';
import { LiveSwitch, useLinkPageLive, useWalletLink, type LinkPageLive } from './private-page.tsx';
import { ShareLinkPageModal } from './ShareLinkPageModal.tsx';
import { drawnQrStyle, QrStyleModal, ShareLinksModal, useQrStyle } from './ShareTools.tsx';
import { strings } from './strings.ts';
import { teamStrings } from './team-strings.ts';

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
  /**
   * Someone else's page, by member id (spec 0070, AC-7002), opened from Team pages: the same editor on their own
   * stores, with what is the account's own (social links, who the page is from, sharing and search, the wallet, Bring a
   * page across, Email signup) left out, and nothing put live but by the switch.
   */
  readonly member?: string;
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
  const keys = ['ground', 'hue', 'mode', 'shape', 'fill', 'font', 'layout'] as const;
  return keys.every((key) => one[key] === other[key]);
}

function nextHue(items: readonly ProfileItem[]) {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[items.filter((item) => item.kind === 'link').length % ring.length] ?? 'blue';
}

/** The block as the list shows it before the server answers: the checked block, as the server will store it. */
function shownItem(
  id: string,
  block: ProfileBlock,
  was: ProfileItem | undefined,
  facts: ChosenFacts | undefined,
  linkPage: LinkPageStore,
): ProfileItem {
  const updatedAt = new Date().toISOString();
  if (block.kind === 'heading') return { kind: 'heading', id, title: block.title, updatedAt };
  if (block.kind === 'page' || block.kind === 'times') {
    const page = facts !== undefined && 'page' in facts ? facts.page : undefined;
    return { ...block, id, ...(page === undefined ? {} : { page }), updatedAt };
  }
  if (block.kind === 'form') {
    const form = facts !== undefined && 'form' in facts ? facts.form : undefined;
    return { ...block, id, ...(form === undefined ? {} : { form }), updatedAt };
  }
  if (block.kind === 'menu' || block.kind === 'reserve') {
    const place = facts !== undefined && 'place' in facts ? facts.place : undefined;
    return { ...block, id, ...(place === undefined ? {} : { place }), updatedAt };
  }
  if (block.kind === 'media') {
    // The server parses the link into its service and id and reads the title and poster once; until it answers,
    // the row names the service from the address and keeps what the saved block had.
    const kept = was?.kind === 'media' ? was : undefined;
    const same = kept !== undefined && kept.url === block.url ? kept : undefined;
    const title = block.title ?? same?.title;
    const poster = same?.poster;
    return {
      kind: 'media',
      id,
      provider: linkPage.reach.rules.mediaProviderOf(block.url) ?? kept?.provider ?? 'youtube',
      ref: same?.ref ?? '',
      url: block.url,
      ...(title === undefined ? {} : { title }),
      ...(poster === undefined ? {} : { poster }),
      ...(block.size === undefined ? {} : { size: block.size }),
      ...(block.showFrom === undefined ? {} : { showFrom: block.showFrom }),
      ...(block.hideAfter === undefined ? {} : { hideAfter: block.hideAfter }),
      updatedAt,
    };
  }
  if (block.kind !== 'link') return { ...block, id, updatedAt };
  return { ...block, id, hue: block.hue ?? (was?.kind === 'link' ? was.hue : 'blue'), updatedAt };
}

/**
 * Now, for the blocks' windows (AC-6111): it moves on by itself at the next start or end among the blocks, so a block
 * whose time comes while the editor is open joins or leaves the phone and its row's chip changes then, and it stays
 * the same moment between those renders.
 */
function useWindowClock(items: readonly ProfileItem[]): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const at = now.getTime();
    const edges = items
      .flatMap((item) => (item.kind === 'heading' ? [] : [item.showFrom, item.hideAfter]))
      .flatMap((edge) => (edge === undefined ? [] : [Date.parse(edge)]))
      .filter((edge) => edge > at);
    if (edges.length === 0) return undefined;
    // A day at most, so a long wait never overflows the timer; a little after the edge, so it has passed.
    const wait = Math.min(Math.min(...edges) - at + 500, 86_400_000);
    const timer = setTimeout(() => setNow(new Date()), wait);
    return () => clearTimeout(timer);
  }, [items, now]);
  return now;
}

/** The link page editor: the blocks beside the phone. */
export function LinkPageScreen({
  data,
  linkPage,
  brand,
  slug,
  profile,
  member,
  isEditing,
  onEditing,
}: LinkPageScreenProps) {
  const handle = profile.handle;
  const isTeam = member !== undefined;
  // Live or Private (spec 0058, AC-23): opening the screen is what puts a page made for its owner live, once. Someone
  // else opening it (spec 0070) never does: only the switch.
  const live = useLinkPageLive(data, slug, profile.isPublic, { opens: handle !== undefined && !isTeam, linkPage });
  // Team pages (spec 0070, AC-7001): one way there, on the person's own overview, for those who may manage them.
  // Its addresses are the place's: the app's, or the partner's frame's (AC-7032).
  const place = useLinkPagePlace(slug);
  const canManageTeam = place.canManageTeam;
  const teamHref = place.href({ team: true });
  return (
    // A page of the workspace since 25 October 2026, not a view inside Settings › Account › Profile: its own row
    // in the sidebar, its own bar, and no trail of configuration above it (the owner).
    <WorkspacePage
      currentPage="linkPage"
      page={{
        topBar: (
          <TopBar
            title={isTeam ? teamStrings.memberTitle(profile.name) : strings.title}
            icon="id-card"
            {...(isTeam
              ? {
                  crumbs: [
                    { id: 'link-page', label: teamStrings.linkPage, href: place.href() },
                    { id: 'team', label: teamStrings.title, href: teamHref },
                  ],
                  back: { label: teamStrings.back, href: teamHref },
                }
              : {})}
          >
            {!isTeam && canManageTeam && !isEditing && (
              <ButtonLink href={teamHref} icon="users" isLabelCollapsible label={teamStrings.openList}>
                {teamStrings.openList}
              </ButtonLink>
            )}
            {handle === undefined ? undefined : (
              <HeaderActions
                isTeam={isTeam}
                data={data}
                live={live}
                handle={handle}
                workspaceName={profile.workspaceName}
                linkPage={linkPage}
                slug={slug}
                personImage={profile.image === undefined || profile.pictureHidden === true ? undefined : profile.image}
                quickPicks={brand.quickPicks}
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
                {isTeam ? (
                  // A member with no page is claimed for from Team pages, where the claim asks for the handle.
                  <EmptyState
                    layout="block"
                    illustration={<SpotIllustration kind="link-page" />}
                    title={teamStrings.noPage}
                    actions={<ButtonLink href={teamHref}>{teamStrings.back}</ButtonLink>}
                  />
                ) : (
                  <ClaimLink data={data} slug={slug} suggested={profile.suggestedHandle} />
                )}
              </Card>
            </PreviewLayout>
          ) : (
            <Blocks
              data={data}
              isTeam={isTeam}
              {...(member === undefined ? {} : { member })}
              linkPage={linkPage}
              brand={brand}
              slug={slug}
              profile={profile}
              handle={handle}
              isLive={live.isLive}
              onGoLive={live.goLive}
              isEditing={isEditing}
              onEditing={onEditing}
            />
          ),
      }}
    />
  );
}

/**
 * The header's actions, the one place a link page is shared from (owner, 5 November 2026, after Linktree's bar): the
 * one Live or Private switch (spec 0058, AC-23), then, once Live, the page's address as a pill that copies it in one
 * press, and Share, which opens the one Share modal (the QR and Download, Open, Links for each place, Style the code
 * and Add to Wallet). Sharing never changes whether the page is live: the switch is the one place that does, and the
 * modal says when the page is private.
 */
export function HeaderActions({
  data,
  isTeam = false,
  live,
  handle,
  workspaceName,
  linkPage,
  slug,
  personImage,
  quickPicks,
  isEditing,
  onEditing,
}: {
  /** For the Wallet pass's link, read once Share opens. */
  readonly data: DataLayer;
  /** Someone else's page (spec 0070): the wallet pass is its member's own, so it isn't offered. */
  readonly isTeam?: boolean;
  readonly live: LinkPageLive;
  readonly handle: string;
  readonly workspaceName?: string | undefined;
  /** The store and workspace the saved QR style is read from (spec 0061, AC-6124). */
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  /** The person's picture, when it shows on their pages: a styled code may carry it. */
  readonly personImage?: string | undefined;
  /** The code's quick colour picks: the brand kit's nine. */
  readonly quickPicks: readonly AccentQuickPick[];
  readonly isEditing: boolean;
  readonly onEditing: (isEditing: boolean) => void;
}) {
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  const [isSharing, setSharing] = useState(false);
  const [isMarking, setMarking] = useState(false);
  const [isStyling, setStyling] = useState(false);
  const qrStyle = drawnQrStyle(useQrStyle(linkPage, slug), linkPage, slug, personImage);
  // The Wallet pass is read once Share has opened, not on every visit to the page.
  const [hasShared, setShared] = useState(false);
  const wallet = useWalletLink(data, slug, live.isLive && hasShared && !isTeam);
  return (
    <>
      <LiveSwitch live={live} />
      {/* Sharing is offered only for a page visitors can open: while Private the switch beside it says so, and
          the address and Share wait for Live (an unpublished page offers no link, as Notion's and Webflow's do). */}
      {live.isLive && (
        <>
          {/* The address copies in one press, as Linktree's does (owner, 5 November 2026); Open is in Share and the
              preview. On a phone's narrow bar the address and Share drop their words for their icons, keeping their
              names, so the bar never runs past the screen (spec 0058, AC-1). */}
          <CopyButton
            value={address}
            label={shown}
            name={strings.copyAddress(shown)}
            announcement={strings.copied}
            isRound
            isLabelCollapsible
          />
          <Button
            icon="share"
            isLabelCollapsible
            label={strings.share}
            onPress={() => {
              setShared(true);
              setSharing(true);
            }}
          >
            {strings.share}
          </Button>
        </>
      )}
      {/* Edit page lives on the page's own card; the bar carries only the way back out of the builder. */}
      {isEditing && (
        // Secondary: the builder's one primary is Add item, the thing it is opened for; Done only steps back out.
        <Button
          variant="secondary"
          icon="check"
          isLabelCollapsible
          label={strings.doneEditing}
          onPress={() => onEditing(false)}
        >
          {strings.doneEditing}
        </Button>
      )}
      <ShareLinkPageModal
        address={address}
        handle={handle}
        workspaceName={workspaceName}
        isPublic={live.isLive}
        onGoLive={() => live.setLive(true)}
        qrStyle={qrStyle}
        onShareLinks={() => {
          // One dialog at a time: Share steps aside for the links, rather than stacking two scrims.
          setSharing(false);
          setMarking(true);
        }}
        onStyle={() => {
          setSharing(false);
          setStyling(true);
        }}
        {...(wallet === undefined ? {} : { wallet })}
        isOpen={isSharing}
        onClose={() => setSharing(false)}
      />
      <ShareLinksModal address={address} isOpen={isMarking} onClose={() => setMarking(false)} />
      <QrStyleModal
        linkPage={linkPage}
        slug={slug}
        handle={handle}
        address={address}
        {...(personImage === undefined ? {} : { personImage })}
        quickPicks={quickPicks}
        isOpen={isStyling}
        onClose={() => setStyling(false)}
      />
    </>
  );
}

/**
 * The kinds that belong to modules other than Link pages (booking pages, forms, places): an embedded frame, which
 * shares Link pages alone (spec 0070, AC-7033), never offers them.
 */
const OTHER_MODULES: ReadonlySet<AddableKind> = new Set(['page', 'times', 'form', 'signup', 'menu', 'reserve']);

/** The blocks, their editors and the phone, once the person has a handle. */
function Blocks({
  data,
  isTeam,
  member,
  linkPage,
  brand,
  slug,
  profile,
  handle,
  isLive,
  onGoLive,
  isEditing,
  onEditing,
}: {
  readonly data: DataLayer;
  /** Someone else's page (spec 0070): what is the account's own stays off this editor. */
  readonly isTeam: boolean;
  /** Whose page, by member id, when it is someone else's: a page only person's name and title change with it. */
  readonly member?: string;
  readonly linkPage: LinkPageStore;
  readonly brand: BrandStore;
  readonly slug: string;
  readonly profile: MyProfile;
  readonly handle: string;
  /** Whether the page is Live, as the switch in the bar holds it (spec 0058, AC-23). */
  readonly isLive: boolean;
  /** Turns it Live, as the bar's switch does: the overview's Turn on Live while it is Private. */
  readonly onGoLive: () => void;
  readonly isEditing: boolean;
  readonly onEditing: (isEditing: boolean) => void;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // Embedded in a partner's frame (spec 0070, AC-7033): only Link pages is shared, so no block of another module
  // (booking pages, forms, places) is offered, and none opens that module's editor.
  const { isEmbedded } = useLinkPagePlace(slug);
  const held = linkPage.view(slug);
  const state = useLinkPage(held);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProfileItem | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setImporting] = useState(false);
  // Who last changed the person's own page when it wasn't them (spec 0070, AC-7004), read once as the page opens.
  const [editedBy, setEditedBy] = useState<{ readonly name: string; readonly at: string } | undefined>(undefined);
  useEffect(() => {
    if (isTeam) return undefined;
    let isCurrent = true;
    data.teamPages.editedBy(slug).then(
      (answer) => {
        if (isCurrent) setEditedBy(answer.last);
      },
      // No line is no error: the page simply doesn't say it.
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isTeam]);
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
  const chooseTheme = (picked: PageTheme) => {
    // A starting look names the ten looks' keys, never the layout (spec 0061): picking one keeps the blocks' layout.
    const next: PageTheme =
      picked.layout === undefined && theme.layout !== undefined ? { ...picked, layout: theme.layout } : picked;
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
  // The look as it draws (spec 0068, AC-6804): the page's own template, else its workspace's, else Classic.
  const worn: PageTheme = { ...theme, template: theme.template ?? extrasRead?.workspaceTemplate ?? 'classic' };
  const wornMode = worn.template === 'night' ? 'dark' : worn.template === 'studio' ? 'light' : undefined;
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  const [lookRefusal, setLookRefusal] = useState<DataError | undefined>(undefined);
  const [sending, setSending] = useState<PhotoSlot | undefined>(undefined);
  const ownAccent = dragged ?? extrasRead?.accent;
  // Worked out once per colour, not per render: the guard is a search, and the tiles and phone all read it.
  const accentDark = extrasRead?.accentDark;
  const workspaceAccent = extrasRead?.workspaceAccent;
  const workspaceAccentDark = extrasRead?.workspaceAccentDark;
  const colours = useMemo(
    () =>
      ownAccent === undefined
        ? brand.colours(workspaceAccent, workspaceAccentDark)
        : brand.colours(ownAccent, accentDark),
    [brand, ownAccent, accentDark, workspaceAccent, workspaceAccentDark],
  );
  // The page's photos as its draft holds them, read through the same door as the upload (a team page's too).
  const photoSrc = (slot: PhotoSlot, version: string) => brand.photoSrc(slug, slot, version);
  const lookVariables = useMemo(() => {
    const photoPairs = (['cover', 'ground'] as const).flatMap((slot) => {
      const version = extrasRead?.[slot];
      const src = version === undefined ? undefined : brand.photoSrc(slug, slot, version);
      return src === undefined ? [] : [[`--page-${slot}-image`, `url("${src}")`] as const];
    });
    return [...(colours?.variables ?? []), ...photoPairs];
  }, [colours, extrasRead, brand, slug]);
  // The face the phone draws: the page's own profile photo, else the account picture unless it is kept off pages.
  const pagePhoto = extrasRead?.avatar === undefined ? undefined : brand.photoSrc(slug, 'avatar', extrasRead.avatar);
  const faceImage =
    pagePhoto ?? (profile.image === undefined || profile.pictureHidden === true ? undefined : profile.image);
  const lookPhotos = { cover: extrasRead?.cover !== undefined, ground: extrasRead?.ground !== undefined };
  const chooseAccent = (accent: string | undefined, accentDark: string | undefined) => {
    setDragged(undefined);
    setLookRefusal(undefined);
    void brand.saveAccent(slug, accent, accentDark).then((refused) => {
      if (refused !== undefined) setLookRefusal(refused);
      // The page's colour is drafted (spec 0068): Publish's bar reads where the page stands now.
      else linkPage.publication.changed();
    });
  };
  // A photo picked, or the one there cropped again (spec 0068, AC-6809): the cover in its 3:1 frame, the profile
  // photo square, the background free, then drawn again for its kind and sent.
  const cropping = usePhotoCrop();
  // Why the profile photo or the cover didn't save, said in Profile where they are; the background's stays in Design.
  const [profileRefusal, setProfileRefusal] = useState<DataError | undefined>(undefined);
  const refusePhoto = (slot: PhotoSlot, refused: DataError) => {
    if (slot === 'ground') setLookRefusal(refused);
    else setProfileRefusal(refused);
  };
  const choosePhoto = (slot: PhotoSlot, source: File | string) => {
    setLookRefusal(undefined);
    setProfileRefusal(undefined);
    void cropping.crop(source, slot === 'cover' ? 'cover' : slot === 'avatar' ? 'square' : 'free').then((crop) => {
      if (crop === undefined) return;
      setSending(slot);
      void preparePhoto(source, slot, crop)
        .then(
          (image) => brand.uploadPhoto(slug, slot, image.blob),
          () => {
            toasts.toast({ tone: 'danger', message: strings.photoUnreadable });
            return undefined;
          },
        )
        .then((answer) => {
          if (answer === 'same') toasts.toast({ tone: 'info', message: strings.samePhoto });
          else if (answer !== undefined) refusePhoto(slot, answer);
          // The photos are drafted (spec 0068): Publish's bar reads where the page stands now.
          else linkPage.publication.changed();
        })
        .finally(() => {
          setSending(undefined);
        });
    });
  };
  const removePhoto = (slot: PhotoSlot) => {
    setLookRefusal(undefined);
    setProfileRefusal(undefined);
    void brand.removePhoto(slug, slot).then((refused) => {
      if (refused !== undefined) refusePhoto(slot, refused);
      else linkPage.publication.changed();
    });
  };
  // Whether search engines may show the page (spec 0055, AC-5506), the same shape as the look above: shown the
  // moment it is pressed, put back with its reason on the card if the save is refused.
  const [switched, setSwitched] = useState<boolean | undefined>(undefined);
  const [indexableRefusal, setIndexableRefusal] = useState<DataError | undefined>(undefined);
  const indexable = switched ?? profile.indexable ?? true;
  // Who the page is from (3 Nov 2026), as last saved, so the phone follows a change before the profile is read again.
  const [identity, setIdentity] = useState<PageIdentity>(() => identityOf(profile));
  // The name, title and its switch are live on save (owner, 10 November 2026), with no Publish to wait for: one quiet
  // toast says so, the last save's only, so a run of edits never stacks them.
  const liveToast = useRef<string | undefined>(undefined);
  const identityLive = (saved: PageIdentity) => {
    setIdentity(saved);
    if (liveToast.current !== undefined) toasts.dismiss(liveToast.current);
    liveToast.current = toasts.toast({ tone: 'success', message: strings.identityLive });
  };
  // Why the job title switch didn't save, said in the Details card's foot until it saves.
  const [identityRefusal, setIdentityRefusal] = useState<string | undefined>(undefined);
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
  // Spec 0061: a stored picture as the owner's own browser reads it (live or not), and now, for each block's window.
  const picture = (imageId: string) => ({ src: linkPage.reach.pictureSrc(slug, imageId), width: 4, height: 3 });
  // An audio intro plays from the owner's own copy (spec 0068); the phone is inert, so it never plays there.
  const audio = (audioId: string) => linkPage.reach.audioSrc(slug, audioId);
  const now = useWindowClock(items);
  const { locale, timeZone } = useFormatSettings();
  const whenFormat = memoIntl(
    `link-window:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }),
  );
  /** Whether a block's window keeps it off the page now: not started yet, or ended. */
  const isOutOfWindow = (item: ProfileItem) => {
    const at = linkPage.reach.rules.windowStateOf(item, now).state;
    return at === 'starts' || at === 'ended';
  };
  /** A block's window as its row's chip (AC-6111): "Starts 3 Nov, 09:00", "Ends 10 Nov, 18:00", "Ended". */
  const windowChip = (item: ProfileItem): readonly string[] => {
    const at = linkPage.reach.rules.windowStateOf(item, now);
    if (at.state === 'always') return [];
    if (at.state === 'ended') return [reachStrings.ended];
    const when = whenFormat.format(new Date(at.at));
    return [at.state === 'starts' ? reachStrings.starts(when) : reachStrings.ends(when)];
  };
  const counts = state.status === 'ready' ? state.counts : undefined;
  const socialNetworks = useMemo(() => (profile.socials ?? []).map((link) => link.network), [profile.socials]);
  const archived = useMemo(() => (state.status === 'ready' ? state.archived : []), [state]);
  // Every block, live and archived, for Insights' names of each block's clicks.
  const everyItem = useMemo(() => [...items, ...archived], [items, archived]);
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
  const copyHrefOf = (item: ProfileItem): string | undefined => {
    if (item.kind === 'link') return item.url;
    // The card's vCard, as a visitor saves it: the same address Save contact opens, and a QR code can carry.
    if (item.kind === 'contact') return `${publicBookingOrigin()}${contactHref(handle, item.id)}`;
    if (item.kind === 'page' && item.page !== undefined) {
      return `${publicBookingOrigin()}/${encodeURIComponent(handle)}/${encodeURIComponent(item.page.slug)}`;
    }
    return undefined;
  };
  const submit = (draft: BlockDraft, facts?: ChosenFacts, after?: AfterSave) => {
    const was = editing?.item;
    setEditing(undefined);
    const withHue: BlockDraft =
      draft.kind === 'link' && draft.hue === undefined ? { ...draft, hue: nextHue(items) } : draft;
    const checked = linkPage.check(withHue, items, was?.id);
    if (!checked.ok) return;
    const id = was?.id ?? editing?.id ?? linkPage.newId();
    const shown = shownItem(id, checked.block, was, facts, linkPage);
    void linkPage.save(slug, id, checked.block, shown).then((landed) => {
      // A new link's own site picture (AC-6101): read once the link is saved, since the server reads only the
      // address it holds; then the link is saved again with it, as an edit would.
      if (!landed || after?.siteThumb !== true || checked.block.kind !== 'link') return;
      const asked = checked.block;
      linkPage.reach.fetchThumbnail(slug, id).then(
        (found) => {
          if ('none' in found) {
            toasts.toast({ tone: 'info', message: reachStrings.thumbSiteNone });
            return;
          }
          // The link as it stands now, not as it was sent: the read takes seconds, and meanwhile the owner may have
          // edited it, picked a picture, or archived or deleted it. Only the same live link at the same address,
          // still with no picture, takes the one the server read.
          const now = held.getSnapshot();
          const current = now.status === 'ready' ? now.items.find((each) => each.id === id) : undefined;
          if (current?.kind !== 'link' || current.url !== asked.url || current.thumb !== undefined) return;
          const { id: _id, updatedAt: _at, outsideWorkspace: _outside, ...fields } = current;
          const block: ProfileBlock = { ...fields, thumb: found.image };
          void linkPage.save(slug, id, block, { ...current, thumb: found.image });
        },
        (error: unknown) =>
          toasts.toast({
            tone: 'danger',
            message: error instanceof Error && error.message !== '' ? error.message : reachStrings.pictureFailed,
          }),
      );
    });
  };

  const rowMenu = (item: ProfileItem, index: number) => {
    const words = rowWords(item);
    const href = copyHrefOf(item);
    const kind = BLOCK_KINDS[item.kind];
    const editKind = item.kind;
    return (
      <>
        {/* Copy link says it worked in place, as every copy does (C11), so it sits on the row, not in the menu. */}
        {href !== undefined && (
          <CopyButton
            value={href}
            label={strings.copyLink}
            isIconOnly
            variant="ghost"
            announcement={strings.copied}
            failureMessage={strings.copyFailed}
          />
        )}
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.moreFor(words.title)} />
          <Menu label={strings.moreFor(words.title)}>
            {kind.isEditable && (
              <MenuItem
                id="edit"
                icon={item.kind === 'page' ? 'clock' : 'pencil'}
                onAction={() => {
                  setEditing({ kind: editKind, item, id: item.id });
                }}
              >
                {/* A booking page block's own editor holds its window (and its size on a grid page); "Edit booking
                  page" below opens the page itself, so this one is named for what it opens. */}
                {item.kind !== 'page'
                  ? strings.edit
                  : theme.layout === 'grid'
                    ? reachStrings.sizeAndSchedule
                    : reachStrings.schedule}
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
            {item.kind === 'page' && item.page !== undefined && !isEmbedded && (
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
      </>
    );
  };

  const tileOf = (item: ProfileItem): LinkPageBlock => {
    // The row's tile draws the block whatever its window, so a scheduled block still reads as itself.
    const block = previewBlock(item, handle, linkPage.markOf, { picture, audio, socials: shownSocials });
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
      chips: isPending ? [] : windowChip(item),
      // Outside its window a block has left the page, so its row reads as off, as a paused page's does (AC-6111).
      ...(isOutOfWindow(item) ? { isOff: true } : {}),
      // Its clicks over 30 days as one quiet number at its end, once the figures are here (none for zero).
      ...(() => {
        const figure = isPending ? undefined : pressesFigure(item, counts);
        return figure === undefined ? {} : { figure };
      })(),
      leading: <LinkPageTile block={tileOf(item)} />,
      ...(words.badge === undefined ? {} : { badge: words.badge }),
      ...(words.isOff === true ? { isOff: true } : {}),
      ...(isPending ? { isPending: true } : { actions: rowMenu(item, index) }),
      ...(item.kind === 'page' && item.page !== undefined && !isEmbedded
        ? { href: pageEditorHref(item.page.workspaceSlug, item.pageId) }
        : {}),
    };
  });

  // The owner's design adds every kind in one modal: the picker chooses the kind, the fields follow it, and the
  // kind swaps in place rather than closing one dialog to open another. An edit opens its kind's editor alone.
  // A button opens the modal on the kind it names, unless that kind is full: then it opens on the first kind that
  // isn't, so the picker never opens on a choice that can't be taken. Every kind full disables the button.
  // Email signup makes a form block, so what it needs room for is a form (`blockKindOf`), not a kind of its own.
  // Why a kind can't be added now: its limit's sentence, or, for Social icons, that there are no links to show yet.
  // Menu and Reserve (spec 0065, AC-6528) are offered only where they can be placed: while Menu or Table seating is
  // installed in this workspace, read once as the screen opens. Elsewhere the Add modal never mentions them.
  const [placeKinds, setPlaceKinds] = useState<ReadonlySet<AddableKind>>(() => new Set());
  useEffect(() => {
    // Embedded, no place's block is offered, so there is nothing to ask.
    if (isEmbedded) return undefined;
    let isCurrent = true;
    linkPage.placeChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        setPlaceKinds(
          new Set<AddableKind>([
            ...(found.some((choice) => choice.menu !== undefined) ? (['menu'] as const) : []),
            ...(found.some((choice) => choice.reserve !== undefined) ? (['reserve'] as const) : []),
          ]),
        );
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [linkPage, slug, isEmbedded]);
  // Email signup makes a form in the name of whoever adds it, so it is the page owner's own to add (spec 0070).
  const addable = ADDABLE.filter(
    (kind) =>
      ((kind !== 'menu' && kind !== 'reserve') || placeKinds.has(kind)) &&
      !(isTeam && kind === 'signup') &&
      !(isEmbedded && OTHER_MODULES.has(kind)),
  );
  const offReason = (kind: AddableKind) =>
    linkPage.limit(items, blockKindOf(kind)) ??
    (kind === 'socials' && shownSocials.length === 0 ? reachStrings.socialsNone : undefined);
  const roomFor = (kind: AddableKind) => offReason(kind) === undefined;
  const openAdd = (kind: AddableKind) => {
    const open = roomFor(kind) ? kind : addable.find(roomFor);
    if (open !== undefined) setEditing({ kind: open, id: linkPage.newId() });
  };
  const isFull = !addable.some(roomFor);
  // One Add, as Linktree and Bento have it (owner, 5 November 2026): the primary adds a block, and its menu beside
  // holds the two other ways in, a new section and bringing an old page across (spec 0055, AC-5524).
  const addButtons = (
    <>
      <MenuTrigger>
        <Button
          variant="ghost"
          icon="ellipsis"
          label={strings.moreWaysToAdd}
          isDisabled={state.status !== 'ready' || isFull}
        />
        <Menu label={strings.moreWaysToAdd}>
          <MenuItem id="section" icon="list-plus" isDisabled={!roomFor('heading')} onAction={() => openAdd('heading')}>
            {strings.newSection}
          </MenuItem>
          {!isTeam && (
            <MenuItem id="import" icon="download" onAction={() => setImporting(true)}>
              {strings.bringAcross}
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
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
  const fullReasons = [...new Set(addable.flatMap((kind) => linkPage.limit(items, blockKindOf(kind)) ?? []))];
  const addHint = fullReasons.length === 0 ? strings.addHint : fullReasons.join(' ');
  // The kinds as a grid of icons with a short name each (spec 0058, AC-9), only while adding.
  const kindPicker =
    editing === undefined || editing.item !== undefined ? undefined : (
      <KindPicker
        kinds={addable}
        value={editing.kind}
        fullReason={offReason}
        // The id is minted once and kept as the kind changes, so the save that follows is still the one add.
        onChange={(kind) => setEditing({ kind, id: editing.id })}
      />
    );

  const previewBlocks = items.flatMap((item) => {
    const block = previewBlock(item, handle, linkPage.markOf, { picture, audio, socials: shownSocials, now });
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
      foot={<BookingFoot page="booking_profile" {...(wornMode === undefined ? {} : { scheme: wornMode })} />}
      // A new ground remounts the phone, which fades the page in on it (spec 0060, AC-18).
      // Only a new ground, mode or header: a font or a button shape changes in place, keeping the phone's scroll.
      // A new template remounts it too, so the switch crossfades (spec 0068, AC-6804).
      key={[worn.template, theme.ground, theme.gradient, theme.pattern, theme.mode, theme.header].join(' ')}
      person={{
        name: identity.name.trim() || handle,
        id: handle,
        bio: profile.bio,
        ...(identity.showJobTitle && identity.jobTitle !== '' ? { role: identity.jobTitle } : {}),
        ...(faceImage === undefined ? {} : { image: faceImage }),
      }}
      // The lockup's name and link as a visitor sees them; its logo is the Brand kit's, which the phone leaves out.
      {...(identity.site === '' || profile.workspaceName === undefined
        ? {}
        : { brand: { name: profile.workspaceName, href: identity.site } })}
      {...(identity.footLine === '' ? {} : { footLine: identity.footLine })}
      {...(state.status === 'ready' ? { blocks: previewBlocks } : {})}
      theme={worn}
      {...(theme.layout === undefined ? {} : { pageLayout: theme.layout })}
      photos={lookPhotos}
      variables={lookVariables}
      // Their own set of networks (the Social links card below), under the bio as visitors see it.
      {...(shownSocials.length === 0 ? {} : { socials: <SocialLinks links={shownSocials} /> })}
      empty={
        <EmptyState layout="block" title={strings.empty} icon="link">
          {isEmbedded ? strings.emptyTextEmbedded : strings.emptyText}
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
        layout="block"
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
        {hasArchived ? strings.emptyArchived : isEmbedded ? strings.emptyTextEmbedded : strings.emptyText}
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
          // A booking page block opens the booking page's own editor, in its workspace; its menu's Edit holds the
          // block's own size and window.
          if (item.kind === 'page' && item.page !== undefined && !isEmbedded) {
            void navigate({ href: pageEditorHref(item.page.workspaceSlug, item.pageId) });
          } else if (BLOCK_KINDS[item.kind].isEditable) setEditing({ kind: item.kind, item, id: item.id });
        }}
        onMove={move}
        rowOrder={LinkListRowOrder}
      />
    );
  }

  const Editor = editing === undefined ? undefined : BLOCK_KINDS[editing.kind].Editor;
  // Publish (spec 0068, AC-6810 to AC-6812): every edit here is a draft until Publish; the bar heads both views.
  const publishBar = (
    <LinkPublishBar linkPage={linkPage} slug={slug} address={publicProfileUrl(handle)} isPaused={!isLive} />
  );
  // What the page opens on: the page as something to hand out, the phone beside it showing exactly what a visitor
  // gets. Everything that changes the page is one press away, under Edit page (the owner, 27 October 2026).
  if (!isEditing) {
    return (
      <PreviewLayout preview={preview} previewShare="wide" notices={publishBar}>
        <LinkPageOverview
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
          onGoLive={onGoLive}
          linkPage={linkPage}
          items={everyItem}
          personImage={faceImage}
          editedBy={editedBy}
          {...(isTeam ? { title: teamStrings.theirPage } : {})}
        />
      </PreviewLayout>
    );
  }
  // The page's photos and what changes them, for both cards that hold photo rows: Profile and Design.
  const photoExtras = {
    look: extrasRead,
    photoSrc,
    onPhoto: choosePhoto,
    onRemovePhoto: removePhoto,
    ...(sending === undefined ? {} : { sending }),
  };
  // What the page shows for its face while it has no photo of its own: the account photo, unless it is kept off.
  const accountPhoto = profile.image === undefined || profile.pictureHidden === true ? undefined : profile.image;
  return (
    <PreviewLayout preview={preview} previewShare="wide" notices={publishBar}>
      {/* Who the page is from comes first, as on Linktree (owner, 10 November 2026): the profile photo, the cover, the
          name and the title under it. The name and title are live the moment each saves; the photos wait for Publish
          with the rest. On someone else's page (spec 0070) a page only person's name and title change here, anyone
          else's are shown as they keep them (9 Nov 2026). */}
      <Card title={strings.profile}>
        {/* Why a photo here didn't save, until the next try: the card has no footer to say it in. */}
        {profileRefusal !== undefined && <Callout tone="danger">{profileRefusal.message}</Callout>}
        <PagePhotos
          slots={['avatar', 'cover']}
          extras={photoExtras}
          {...(accountPhoto === undefined ? {} : { avatarStandIn: accountPhoto })}
        />
        {isTeam && member !== undefined && (
          <IdentityFields
            data={data}
            slug={slug}
            owner={
              profile.managedBy === 'team'
                ? { kind: 'team', member }
                : { kind: 'kept', by: profile.managedBy === 'partner' ? 'partner' : 'self' }
            }
            identity={identity}
            // Live on save (owner, 10 November 2026): nothing here is a draft, so Publish's bar has nothing to read.
            onSaved={identityLive}
            onSwitchRefused={() => undefined}
          />
        )}
        {!isTeam && (
          <IdentityFields
            data={data}
            slug={slug}
            identity={identity}
            onSaved={identityLive}
            onSwitchRefused={setIdentityRefusal}
          />
        )}
        {/* Why the title switch didn't save, right under it until the next try. */}
        {!isTeam && identityRefusal !== undefined && <Callout tone="danger">{identityRefusal}</Callout>}
      </Card>
      {/* Then what is on the page (its blocks, the archived ones, the social links), then how it looks: content is
          what the editor is opened for (flow walks, 29 October 2026: L2). */}
      {/* No subtitle (owner, 5 November 2026): the views and clicks live in Insights, and the grips say drag. */}
      <Card
        title={strings.blocks}
        // The clicks are read apart from the blocks: when they fail, the rows' numbers can't say so themselves.
        {...(state.status === 'ready' && state.countsFailed === true ? { footerNote: strings.countsFailed } : {})}
        {...(state.status === 'ready' && items.length === 0 ? {} : { footer: addButtons })}
        actions={
          // How the blocks lay out on the page (spec 0061, AC-6103): one column of rows, or tiles on a grid, whose
          // sizes each sized block's editor then offers. Saved with the look, as every other look choice is.
          <SegmentedControl
            label={reachStrings.layout}
            size="compact"
            value={theme.layout ?? 'list'}
            onChange={(next) => {
              if (next === 'list' || next === 'grid') chooseTheme({ ...theme, layout: next });
            }}
            segments={[
              { value: 'list', label: reachStrings.layoutList, icon: 'list' },
              { value: 'grid', label: reachStrings.layoutGrid, icon: 'layout-grid' },
            ]}
          />
        }
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
      {!isTeam && <SocialsCardSlot data={data} slug={slug} onPreviewLinks={setSocialPreview} isTeam={false} isOwner />}
      {/* Only where there is a page to dress: the screen already sends a person with no handle to Profile. */}
      {cropping.cropper}
      <AppearanceCard
        theme={theme}
        onChange={chooseTheme}
        // The template pictures draw this page: its owner's name and face, and its first rows (spec 0068, AC-6804).
        profile={{
          name: identity.name.trim() || handle,
          ...(accountPhoto === undefined ? {} : { picture: accountPhoto }),
          rows: previewBlocks
            .flatMap((block) => ('title' in block && typeof block.title === 'string' ? [block.title] : []))
            .slice(0, 3),
        }}
        {...(themeRefusal === undefined
          ? lookRefusal === undefined
            ? {}
            : { refusal: lookRefusal }
          : { refusal: themeRefusal })}
        extras={{
          ...photoExtras,
          colours: brand.colours,
          variables: lookVariables,
          quickPicks: brand.quickPicks,
          onAccent: chooseAccent,
          onPreviewAccent: setDragged,
        }}
      />
      {/* How it shows when shared or searched, and the company site and closing line, as one quiet card at the end
          (owner, 5 November 2026); the name and title moved up to Profile (10 November 2026). Someone else's page
          has none of these here. */}
      {!isTeam && (
        <Card title={strings.details}>
          {/* Why the last switch didn't save, until the next try: the card has no footer to say it in. */}
          {indexableRefusal !== undefined && <Callout tone="danger">{indexableRefusal.message}</Callout>}
          <IdentityFields
            data={data}
            slug={slug}
            part="details"
            identity={identity}
            onSaved={(saved) => {
              setIdentity(saved);
              // The site and the closing line are drafted (spec 0068): Publish's bar reads where the page stands now.
              linkPage.publication.changed();
            }}
            onSwitchRefused={() => undefined}
          />
          <SharingFields
            indexable={indexable}
            {...(shareImage === undefined ? {} : { shareImage })}
            onShareImage={chooseShareImage}
            onChange={chooseIndexable}
          />
        </Card>
      )}
      {Editor !== undefined && editing !== undefined && (
        // The draft wears the page's own look (spec 0060, AC-16), as the phone does.
        <DraftLook look={{ theme: worn, photos: lookPhotos, variables: lookVariables }}>
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
              ownerName={identity.name}
              socialLinks={shownSocials}
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
