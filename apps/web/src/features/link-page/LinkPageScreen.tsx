// Brief
// Purpose: Settings › Account › Link page (spec 0051, built as blocks): what the person's page at /<handle> holds, in
// order, beside a phone that shows it as a visitor will.
// Main task: add a booking page, a link or a heading, edit it, move it, archive or delete it; every change shows at
// once, on the list and in the phone, and is saved as it is made.
// Leaves out: the contact card, the QR, the socials row (they come in later phases), themes and appearance, and the
// handle itself (Settings › Profile).
import type { BlockDraft, DataLayer, MyProfile, ProfileBlockKind, ProfileItem, ProfilePageFacts } from '@crm/data';
import { useLinkPage } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
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
  VisuallyHidden,
  type LinkPageBlock,
  type LinkRow,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
import { profileHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { ADDABLE, BLOCK_KINDS, previewBlock, rowWords } from './registry.tsx';
import { strings } from './strings.ts';

/** Props for the Link page screen. */
export interface LinkPageScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
}

/** Which editor is open: a kind's add, or a block's edit. */
type Editing = { readonly kind: ProfileBlockKind; readonly item?: ProfileItem };

/** A new link's letter colour: the next of the hues after the links so far, gray last, as the server would pick. */
function nextHue(items: readonly ProfileItem[]) {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[items.filter((item) => item.kind === 'link').length % ring.length] ?? 'blue';
}

/** The block as the list shows it before the server answers. */
function shownItem(id: string, draft: BlockDraft, was: ProfileItem | undefined, page?: ProfilePageFacts): ProfileItem {
  const updatedAt = new Date().toISOString();
  if (draft.kind === 'heading') return { kind: 'heading', id, title: draft.title.trim(), updatedAt };
  if (draft.kind === 'page') {
    return {
      kind: 'page',
      id,
      workspaceId: draft.workspaceId ?? '',
      pageId: draft.pageId ?? '',
      ...(page === undefined ? {} : { page }),
      updatedAt,
    };
  }
  const note = draft.note.trim();
  return {
    kind: 'link',
    id,
    title: draft.title.trim(),
    url: draft.url.trim(),
    hue: draft.hue ?? (was?.kind === 'link' ? was.hue : 'blue'),
    ...(note === '' ? {} : { note }),
    ...(draft.icon === undefined ? {} : { icon: draft.icon as Extract<ProfileItem, { kind: 'link' }>['icon'] }),
    updatedAt,
  };
}

/** The link page editor: the blocks beside the phone. */
export function LinkPageScreen({ data, slug, profile }: LinkPageScreenProps) {
  const handle = profile.handle;
  return (
    <SettingsPage
      title={strings.title}
      fillsView
      {...(handle === undefined
        ? {}
        : {
            actions: (
              <ButtonLink icon="external-link" href={publicProfileUrl(handle)} isExternal>
                {strings.viewPage}
              </ButtonLink>
            ),
          })}
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
        <Blocks data={data} slug={slug} profile={profile} handle={handle} />
      )}
    </SettingsPage>
  );
}

/** The blocks, their editors and the phone, once the person has a handle. */
function Blocks({
  data,
  slug,
  profile,
  handle,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
  readonly handle: string;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const held = data.linkPage.view(slug);
  const state = useLinkPage(held);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProfileItem | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  // What a menu's move says to screen readers; a drag says its own.
  const [said, setSaid] = useState('');
  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state]);
  const archived = state.status === 'ready' ? state.archived : [];
  const pending = state.status === 'ready' ? state.pendingIds : new Set<string>();

  const move = (id: string, toIndex: number) => {
    const ids = items.map((item) => item.id).filter((each) => each !== id);
    const at = Math.max(0, Math.min(toIndex, ids.length));
    const next = [...ids.slice(0, at), id, ...ids.slice(at)];
    void data.linkPage.order(slug, next);
  };
  const moveFromMenu = (item: ProfileItem, toIndex: number) => {
    setSaid(strings.moved(rowWords(item).title, toIndex + 1, items.length));
    move(item.id, toIndex);
  };
  const copy = (href: string) => {
    navigator.clipboard.writeText(href).then(
      () => toasts.toast({ tone: 'success', message: strings.copied }),
      () => toasts.toast({ tone: 'danger', message: strings.copyFailed }),
    );
  };
  const copyHrefOf = (item: ProfileItem): string | undefined => {
    if (item.kind === 'link') return item.url;
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
    const checked = data.linkPage.check(withHue, items, was?.id);
    if (!checked.ok) return;
    const id = was?.id ?? data.linkPage.newId();
    void data.linkPage.save(slug, id, checked.block, shownItem(id, withHue, was, page));
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
            <MenuItem id="edit" icon="pencil" onAction={() => setEditing({ kind: item.kind, item })}>
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
          <MenuItem id="archive" icon="archive" onAction={() => void data.linkPage.archive(slug, item.id, true)}>
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
    const block = previewBlock(item, handle, data.linkPage.markOf);
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
      chips: [],
      leading: <LinkPageTile block={tileOf(item)} />,
      ...(words.badge === undefined ? {} : { badge: words.badge }),
      ...(words.isOff === true ? { isOff: true } : {}),
      ...(isPending ? { isPending: true } : { actions: rowMenu(item, index) }),
    };
  });

  const addMenu = (
    <MenuTrigger>
      <Button variant="primary" icon="plus" isDisabled={state.status !== 'ready'}>
        {strings.add}
      </Button>
      <Menu label={strings.add}>
        {ADDABLE.map((kind) => {
          const entry = BLOCK_KINDS[kind];
          const full = data.linkPage.limit(items, kind);
          return (
            <MenuItem
              key={kind}
              id={kind}
              icon={entry.icon}
              description={full ?? entry.description}
              isDisabled={full !== undefined}
              onAction={() => setEditing({ kind })}
            >
              {entry.label}
            </MenuItem>
          );
        })}
      </Menu>
    </MenuTrigger>
  );

  const previewBlocks = items.flatMap((item) => {
    const block = previewBlock(item, handle, data.linkPage.markOf);
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
        hasLeading
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
        hasLeading
        rows={rows}
        onOpen={(id) => {
          const item = items.find((each) => each.id === id);
          if (item !== undefined && BLOCK_KINDS[item.kind].isEditable) setEditing({ kind: item.kind, item });
        }}
        onMove={move}
        rowOrder={LinkListRowOrder}
      />
    );
  }

  const Editor = editing === undefined ? undefined : BLOCK_KINDS[editing.kind].Editor;
  return (
    <PreviewLayout preview={preview} previewShare="wide">
      <Card title={strings.blocks} description={strings.blocksText} actions={addMenu}>
        {list}
      </Card>
      {archived.length > 0 && (
        <Card title={strings.archived} description={strings.archivedText}>
          <LinkList
            label={strings.archived}
            searchLabel={strings.archived}
            placement="card"
            isToolbarHidden
            hasLeading
            rows={archived.map((item) => {
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
                    <Button
                      variant="ghost"
                      icon="archive-restore"
                      onPress={() => void data.linkPage.archive(slug, item.id, false)}
                    >
                      {strings.restore}
                    </Button>
                    <Button
                      variant="ghost"
                      icon="trash"
                      label={`${strings.remove} ${words.title}`}
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
          items={items}
          slug={slug}
          handle={handle}
          onSubmit={submit}
          onClose={() => setEditing(undefined)}
        />
      )}
      {deleting !== undefined && (
        <Modal
          title={strings.deleteTitle(rowWords(deleting).title)}
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
                  void data.linkPage.remove(slug, deleting.id).finally(() => {
                    setIsDeleting(false);
                    setDeleting(undefined);
                  });
                }}
              >
                {strings.deleteBlock}
              </Button>
            </>
          }
        >
          {strings.deleteText}
        </Modal>
      )}
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </PreviewLayout>
  );
}
