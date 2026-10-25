// Brief
// Purpose: Settings › Account › Link page (spec 0051, built as blocks): what the person's page at /<handle> holds, in
// order, beside a phone that shows it as a visitor will.
// Main task: add a booking page, a link or a heading, edit it, move it, archive or delete it; every change shows at
// once, on the list and in the phone, and is saved as it is made.
// Leaves out: the contact card, the QR, the socials row (they come in later phases), themes and appearance, and the
// handle itself (Settings › Profile).
import type {
  BlockDraft,
  LinkPageStore,
  MyProfile,
  ProfileBlock,
  ProfileBlockKind,
  ProfileItem,
  ProfilePageFacts,
} from '@crm/data';
import {
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
  Modal,
  PreviewLayout,
  Radio,
  RadioGroup,
  SocialLinks,
  VisuallyHidden,
  type LinkPageBlock,
  type LinkRow,
} from '@crm/ui';
import { useLinkPage } from '@crm/data/react';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { pageEditorHref, publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
import { profileHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { ADDABLE, BLOCK_KINDS, contactHref, figuresLine, pressesChip, previewBlock, rowWords } from './registry.tsx';
import { ShareLinkPageModal } from './ShareLinkPageModal.tsx';
import { strings } from './strings.ts';

/** Props for the Link page screen. */
export interface LinkPageScreenProps {
  /** The link page's store (`data.linkPage.load()`, loaded with the route). */
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  readonly profile: MyProfile;
}

/** Which editor is open: a kind's add, or a block's edit. */
/**
 * The Modal open: its kind, the block being edited (none for an add), and the id its save goes under, minted as it
 * opens, so a second press of Add before the Modal closes saves the same block again rather than a second one.
 */
type Editing = { readonly kind: ProfileBlockKind; readonly item?: ProfileItem; readonly id: string };

/** A new link's letter colour: the next of the hues after the links so far, gray last, as the server would pick. */
function nextHue(items: readonly ProfileItem[]) {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[items.filter((item) => item.kind === 'link').length % ring.length] ?? 'blue';
}

/** The block as the list shows it before the server answers: the checked block, as the server will store it. */
function shownItem(
  id: string,
  block: ProfileBlock,
  was: ProfileItem | undefined,
  page?: ProfilePageFacts,
): ProfileItem {
  const updatedAt = new Date().toISOString();
  if (block.kind === 'heading') return { kind: 'heading', id, title: block.title, updatedAt };
  if (block.kind === 'page') return { ...block, id, ...(page === undefined ? {} : { page }), updatedAt };
  if (block.kind === 'contact') return { ...block, id, updatedAt };
  return { ...block, id, hue: block.hue ?? (was?.kind === 'link' ? was.hue : 'blue'), updatedAt };
}

/** The link page editor: the blocks beside the phone. */
export function LinkPageScreen({ linkPage, slug, profile }: LinkPageScreenProps) {
  const handle = profile.handle;
  return (
    <SettingsPage
      title={strings.title}
      crumbs={[{ id: 'profile', label: strings.profile, href: profileHref(slug) }]}
      fillsView
      {...(handle === undefined ? {} : { actions: <HeaderActions handle={handle} /> })}
    >
      {handle === undefined ? (
        <PreviewLayout>
          <Card>
            <EmptyState
              layout="row"
              icon="at-sign"
              title={strings.noHandle}
              actions={<ButtonLink href={profileHref(slug)}>{strings.openProfile}</ButtonLink>}
            >
              {strings.noHandleText}
            </EmptyState>
          </Card>
        </PreviewLayout>
      ) : (
        <Blocks linkPage={linkPage} slug={slug} profile={profile} handle={handle} />
      )}
    </SettingsPage>
  );
}

/**
 * The header's actions, as the owner's design draws them: the page's address as a pill that opens it, and Share,
 * which opens the one Share modal (the QR, the address and the two ways to go on; Home's card opens the same one).
 */
function HeaderActions({ handle }: { readonly handle: string }) {
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  const [isSharing, setSharing] = useState(false);
  return (
    <>
      <ButtonLink
        variant="secondary"
        isRound
        iconRight="external-link"
        href={address}
        isExternal
        label={strings.openAddress(shown)}
      >
        {shown}
      </ButtonLink>
      <Button icon="upload" onPress={() => setSharing(true)}>
        {strings.share}
      </Button>
      <ShareLinkPageModal address={address} handle={handle} isOpen={isSharing} onClose={() => setSharing(false)} />
    </>
  );
}

/** The blocks, their editors and the phone, once the person has a handle. */
function Blocks({
  linkPage,
  slug,
  profile,
  handle,
}: {
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  readonly profile: MyProfile;
  readonly handle: string;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const held = linkPage.view(slug);
  const state = useLinkPage(held);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProfileItem | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  // What a menu's move says to screen readers; a drag says its own.
  const [said, setSaid] = useState('');
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
  const submit = (draft: BlockDraft, page?: ProfilePageFacts) => {
    const was = editing?.item;
    setEditing(undefined);
    const withHue: BlockDraft =
      draft.kind === 'link' && draft.hue === undefined ? { ...draft, hue: nextHue(items) } : draft;
    const checked = linkPage.check(withHue, items, was?.id);
    if (!checked.ok) return;
    const id = was?.id ?? editing?.id ?? linkPage.newId();
    void linkPage.save(slug, id, checked.block, shownItem(id, checked.block, was, page));
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
  // A workspace is named beside a booking page only when the person's pages come from more than one.
  const namesWorkspace =
    new Set([...items, ...archived].flatMap((item) => (item.kind === 'page' ? [item.workspaceId] : []))).size > 1;
  const rows: LinkRow[] = items.map((item, index) => {
    const words = rowWords(item, namesWorkspace);
    const isPending = pending.has(item.id);
    return {
      id: item.id,
      title: words.title,
      address: words.address,
      // Its presses over 30 days, once the figures are here (a pending block has none yet).
      chips: isPending ? [] : pressesChip(item, counts),
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
  const openAdd = (kind: ProfileBlockKind) => setEditing({ kind, id: linkPage.newId() });
  const addButtons = (
    <>
      <Button icon="list-plus" isDisabled={state.status !== 'ready'} onPress={() => openAdd('heading')}>
        {strings.newSection}
      </Button>
      <Button variant="primary" icon="plus" isDisabled={state.status !== 'ready'} onPress={() => openAdd('link')}>
        {strings.addItem}
      </Button>
    </>
  );
  const kindPicker =
    editing === undefined || editing.item !== undefined ? undefined : (
      <RadioGroup
        label={strings.addWhat}
        variant="cards"
        value={editing.kind}
        // The id is minted once and kept as the kind changes, so the save that follows is still the one add.
        onChange={(kind) => setEditing({ kind: kind as ProfileBlockKind, id: editing.id })}
      >
        {ADDABLE.map((kind) => {
          const entry = BLOCK_KINDS[kind];
          const full = linkPage.limit(items, kind);
          return (
            <Radio
              key={kind}
              value={kind}
              icon={entry.icon}
              description={full ?? entry.description}
              isDisabled={full !== undefined}
            >
              {entry.label}
            </Radio>
          );
        })}
      </RadioGroup>
    );

  const previewBlocks = items.flatMap((item) => {
    const block = previewBlock(item, handle, linkPage.markOf);
    return block === undefined ? [] : [block];
  });
  const preview = (
    <LinkPage
      isPreview
      person={{
        name: profile.name.trim() || handle,
        id: handle,
        bio: profile.bio,
        ...(profile.image === undefined || profile.pictureHidden === true ? {} : { image: profile.image }),
      }}
      {...(state.status === 'ready' ? { blocks: previewBlocks } : {})}
      // Their own set of networks (Settings › Profile's Social links), under the bio as visitors see it.
      {...(profile.socials === undefined || profile.socials.length === 0
        ? {}
        : {
            socials: (
              <SocialLinks
                links={profile.socials.map((link) => ({ ...link, label: link.href.replace(/^https?:\/\//, '') }))}
              />
            ),
          })}
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
    list = (
      <EmptyState layout="row" icon="link" title={strings.empty}>
        {strings.emptyText}
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
  return (
    <PreviewLayout preview={preview} previewShare="wide">
      <Card
        title={strings.blocks}
        description={
          counts !== undefined
            ? `${strings.blocksText} ${figuresLine(counts)}`
            : state.status === 'ready' && state.countsFailed === true
              ? `${strings.blocksText} ${strings.countsFailed}`
              : strings.blocksText
        }
        footer={addButtons}
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
              const words = rowWords(item, namesWorkspace);
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
      {Editor !== undefined && editing !== undefined && (
        <Editor
          {...(editing.item === undefined ? {} : { item: editing.item })}
          {...(kindPicker === undefined
            ? {}
            : {
                chrome: {
                  title: strings.addTitle,
                  leading: kindPicker,
                  hint: strings.addHint,
                  submitLabel: strings.addItem,
                },
              })}
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
      )}
      {deleting !== undefined && (
        <Modal
          title={
            deleting.kind === 'page'
              ? strings.removePageTitle(rowWords(deleting).title)
              : strings.deleteTitle(rowWords(deleting).title)
          }
          tone="danger"
          isOpen
          isBusy={isDeleting}
          onOpenChange={(open) => {
            if (!open && !isDeleting) setDeleting(undefined);
          }}
          actions={
            <>
              <Button slot="close" kbd="ESC" isDisabled={isDeleting}>
                {strings.cancel}
              </Button>
              <Button
                variant="danger-solid"
                icon="trash"
                isPending={isDeleting}
                onPress={() => {
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
              >
                {deleting.kind === 'page' ? strings.removePage : strings.deleteBlock}
              </Button>
            </>
          }
        >
          {deleting.kind === 'page' ? strings.removePageText : strings.deleteText}
        </Modal>
      )}
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </PreviewLayout>
  );
}
