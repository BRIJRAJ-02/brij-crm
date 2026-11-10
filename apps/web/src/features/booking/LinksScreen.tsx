// Brief
// Purpose: Bookings › Pages and Captures › Links (spec 0025, AC-645; the owner's mock of 9 November 2026): the booking
// pages as cards in groups, Your pages, Workspace, Members' pages (whose scheduling the reader Manages; an admin's,
// everyone's, AC-1273) and Managed pages, each card saying its facts, who it books with and its link once.
// Main task: open a page (the whole card), copy its link, make it Live or Hidden from its pill, or delete it with Undo.
// Leaves out: editing a page (its editor), forms (their own tab) and the bookings list (Bookings › Meetings).
import { isDataError, type BookingPageView, type DataLayer, type ManagedPageView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  focusLater,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Tooltip,
  type LinkGridCard,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { strings as capturesStrings } from '../captures/strings.ts';
import { useCapturesCreate } from '../captures/create.tsx';
import { pageHeading } from '../navigation/focus.ts';
import { useMyName } from '../workspace/WorkspacePage.tsx';
import { managedStrings } from './managed-strings.ts';
import { managedPageHref, pageEditorHref, publicBookingUrl, type PageTab } from './links.ts';
import { cardFacts, cardIcon, cardPeople } from './page-card.ts';
import { liveRefusal, setPageLive } from './page-status.ts';
import { PageStatusMenu } from './PageStatusMenu.tsx';
import { sharingStrings } from './sharing-strings.ts';
import { strings } from './strings.ts';
import { deletePageWithUndo } from './delete-page.ts';
import { hasNoHostsOn } from './team-readiness.ts';

/** The groups, in the mock's order: the reader's own, the workspace's links, colleagues' pages, managed pages. */
const MINE_GROUP = 'mine';
const WORKSPACE_GROUP = 'workspace';
const MEMBERS_GROUP = 'members';
/** The managed pages an admin sets up (spec 0037, AC-1333): templates, not bookable pages, so a group of their own. */
const MANAGED_GROUP = 'managed';

/** A page's group: the workspace's, a colleague's (AC-1273), or the reader's own. */
const groupOf = (page: BookingPageView) =>
  page.scope === 'workspace' ? WORKSPACE_GROUP : page.ownerName === undefined ? MINE_GROUP : MEMBERS_GROUP;

/**
 * The list's groups, once it holds more than the reader's own: Your pages, Workspace, Members' pages, then Managed
 * pages, each only when it has a card. Undefined while every page is the reader's own, so a lone list draws no heading.
 */
function groupsOf(pages: readonly BookingPageView[], templates: readonly ManagedPageView[]) {
  const hasWorkspace = pages.some((page) => groupOf(page) === WORKSPACE_GROUP);
  const hasMembers = pages.some((page) => groupOf(page) === MEMBERS_GROUP);
  if (!hasWorkspace && !hasMembers && templates.length === 0) return undefined;
  return [
    { id: MINE_GROUP, label: strings.yourGroup },
    ...(hasWorkspace ? [{ id: WORKSPACE_GROUP, label: strings.workspaceGroup }] : []),
    ...(hasMembers ? [{ id: MEMBERS_GROUP, label: strings.membersGroup }] : []),
    ...(templates.length === 0 ? [] : [{ id: MANAGED_GROUP, label: managedStrings.group }]),
  ];
}

/** Props for the list: the data layer, whose held list of pages the route loaded. */
export interface LinksScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/** The cards, each with its pill, Copy link and ⋯, read from the data layer's held list. */
export function LinksScreen({ data, slug }: LinksScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const me = useMyName();
  const list = useCaptureList(data.bookingPages.view(slug));
  // The groups, to say who a team page books and whether anyone is on it; while they read, nothing is said.
  const rotations = useCaptureList(data.rotations.view(slug));
  const rotationList = rotations.status === 'ready' ? rotations.items : [];
  // The managed pages the reader may change (AC-1333): an empty list for anyone who isn't an admin or an editor.
  const templateList = useCaptureList(data.managedPages.view(slug));
  const [deletingTemplate, setDeletingTemplate] = useState<ManagedPageView | undefined>(undefined);
  const create = useCapturesCreate();
  const removal = useUndoableRemove(data, slug);
  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.somethingWrong}` });
  };
  const open = (pageId: string, tab?: PageTab) => void navigate({ href: pageEditorHref(slug, pageId, tab) });
  // Live or Hidden shows on the card at once; a refusal puts it back and the toast says why. Each says theirs with Undo.
  // Undo reads the page as the list holds it then, not as it stood when its toast was made.
  const itemsNow = useRef<readonly BookingPageView[]>([]);
  useLayoutEffect(() => {
    itemsNow.current = list.status === 'ready' ? list.items : [];
  });
  const setStatus = (page: BookingPageView, isLive: boolean) => {
    const current = itemsNow.current.find((each) => each.id === page.id) ?? page;
    setPageLive(data, slug, current, isLive).then(
      () => {
        toasts.toast({
          tone: 'success',
          message: isLive ? strings.pageCard.madeLive(page.title) : strings.pageCard.madeHidden(page.title),
          action: { label: capturesStrings.undo, onAction: () => setStatus(page, !isLive) },
        });
      },
      (error: unknown) => {
        toasts.toast(liveRefusal(error, page.title, () => open(page.id, 'hosts')));
      },
    );
  };
  const duplicate = (page: BookingPageView) => {
    data.bookingPages.duplicate(slug, page, strings.copyOf(page.title)).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.title) });
      },
      failed(strings.duplicateFailed(page.title)),
    );
  };
  const pages = list.status === 'ready' ? list.items : [];
  const templates = templateList.status === 'ready' ? templateList.items : [];
  // A template is not a bookable page: no pill and no Copy link. Its card opens its editor, and its menu holds the
  // one ending that is its own (deleting it keeps every member page, AC-1335).
  const templateCards: readonly LinkGridCard[] = templates.map((template) => ({
    id: template.id,
    variant: 'page',
    icon: 'copy',
    groupId: MANAGED_GROUP,
    title: template.title,
    href: managedPageHref(slug, template.id),
    facts: [managedStrings.memberBadge(template.members.length)],
    badge: managedStrings.badge,
    isPending: templateList.status === 'ready' && templateList.pendingIds.has(template.id),
    actions: (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={managedStrings.more(template.title)} />
        <Menu
          label={managedStrings.more(template.title)}
          onAction={(key) => {
            if (key === 'delete') setDeletingTemplate(template);
          }}
        >
          <MenuItem id="delete" icon="trash" isDanger>
            {managedStrings.deleteTemplate}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    ),
  }));
  const cards: readonly LinkGridCard[] = pages.map((page) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(page.id);
    const isLive = page.status === 'live';
    // A member sees the workspace's links to copy and open (owner, 30 Oct 2026): no editor or menu, and the pill
    // shows the state without changing it.
    const isViewOnly = page.scope === 'workspace' && !page.canChange;
    const people = cardPeople(page, rotationList, me);
    // One badge at most: what the pill can't say.
    const badge = isPending
      ? strings.copying
      : isViewOnly
        ? strings.viewOnly
        : page.pausedReason === 'host_removed'
          ? strings.hostRemoved
          : isLive && hasNoHostsOn(page, rotations.status === 'ready' ? rotationList : undefined)
            ? strings.cantBookShort
            : page.isPrivate
              ? strings.linkOnly
              : page.isEditor === true
                ? sharingStrings.editorBadge
                : undefined;
    return {
      id: page.id,
      variant: 'page',
      groupId: groupOf(page),
      title: page.title,
      icon: cardIcon(page, rotationList),
      ...(isViewOnly ? {} : { href: pageEditorHref(slug, page.id) }),
      facts: cardFacts(page, rotationList),
      ...(people === undefined ? {} : { people: { people: people.people, label: people.label } }),
      // The link, once: shown as an address, copied whole.
      address: publicBookingUrl(page).replace(/^https?:\/\//, ''),
      ...(badge === undefined ? {} : { badge }),
      isOff: !isLive,
      isPending,
      copyValue: publicBookingUrl(page),
      footEnd: (
        <PageStatusMenu
          title={page.title}
          isLive={isLive}
          isPending={isPending}
          onChange={(next) => setStatus(page, next)}
          // A reader who can't change it sees its state, turned off; its View only badge says why.
          isLocked={!page.canChange}
        />
      ),
      ...(page.canChange
        ? {
            actions: (
              <MenuTrigger>
                <Tooltip content={strings.moreTip}>
                  <Button variant="ghost" icon="ellipsis" label={strings.more(page.title)} isDisabled={isPending} />
                </Tooltip>
                <Menu
                  label={strings.more(page.title)}
                  onAction={(key) => {
                    if (key === 'view') globalThis.open(publicBookingUrl(page), '_blank', 'noopener');
                    if (key === 'duplicate') duplicate(page);
                    if (key === 'hours') open(page.id, 'hours');
                    if (key === 'embed') open(page.id, 'share');
                    if (key === 'delete') removal.remove(page);
                  }}
                >
                  <MenuItem id="view" icon="external-link" isDisabled={!isLive}>
                    {strings.pageCard.viewLive}
                  </MenuItem>
                  {/* A copy is the reader's own page: offered on their own and the workspace's, not a colleague's,
                      nor one they only edit (spec 0037, AC-1331). */}
                  {page.ownerName === undefined && page.isEditor !== true && (
                    <MenuItem id="duplicate" icon="copy">
                      {strings.duplicate}
                    </MenuItem>
                  )}
                  <MenuItem id="hours" icon="clock">
                    {strings.hours}
                  </MenuItem>
                  <MenuItem id="embed" icon="code">
                    {strings.pageCard.embed}
                  </MenuItem>
                  {/* An editor changes a page but never deletes it (AC-1331). */}
                  {page.isEditor !== true && <MenuSeparator />}
                  {page.isEditor !== true && (
                    <MenuItem id="delete" icon="trash" isDanger>
                      {strings.delete}
                    </MenuItem>
                  )}
                </Menu>
              </MenuTrigger>
            ),
          }
        : {}),
    };
  });
  const groups = groupsOf(pages, templates);
  return (
    <CapturesList
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status={list.status}
      cards={[...cards, ...templateCards]}
      {...(groups === undefined ? {} : { groups })}
      // An empty list offers New in its middle too, as a secondary: the TopBar's New stays the one primary.
      {...(create?.create === undefined
        ? {}
        : {
            newAction: (
              <Button icon="plus" onPress={create.create}>
                {strings.newPage}
              </Button>
            ),
          })}
      empty={{ title: strings.emptyTitle, icon: 'calendar-clock' }}
      cardVariant="page"
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.bookingPages.view(slug).reload();
      }}
      dialogs={
        // Deleting a managed page KEEPS every page made from it, the opposite of taking someone off it: the question
        // says so in as many words, since getting these two the wrong way round loses people's pages.
        <Modal
          title={managedStrings.deleteTitle(deletingTemplate?.title ?? '')}
          variant="confirm"
          tone="danger"
          isOpen={deletingTemplate !== undefined}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDeletingTemplate(undefined);
          }}
          actions={
            <>
              <Button slot="close">{managedStrings.deleteKeep}</Button>
              <Button
                variant="danger-solid"
                onPress={() => {
                  const gone = deletingTemplate;
                  setDeletingTemplate(undefined);
                  if (gone === undefined) return;
                  data.managedPages.remove(slug, gone.id).then(
                    () => {
                      toasts.toast({ tone: 'success', message: managedStrings.deleted(gone.title) });
                      // The card's menu went with it: focus goes to the page's title rather than falling to the page.
                      focusLater(() => (document.activeElement === document.body ? pageHeading(document) : undefined));
                    },
                    failed(managedStrings.deleteFailed(gone.title)),
                  );
                }}
              >
                {managedStrings.deleteAction}
              </Button>
            </>
          }
        >
          <p>{managedStrings.deleteText(deletingTemplate?.members.length ?? 0)}</p>
        </Modal>
      }
    />
  );
}

/**
 * Delete with Undo and no confirm (the owner, 9 November 2026): the card leaves at once and a toast offers Undo for
 * ten seconds (`deletePageWithUndo`, the editor's Delete too); only then is the page deleted on the server.
 */
function useUndoableRemove(data: DataLayer, slug: string) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const remove = (page: BookingPageView) => {
    deletePageWithUndo(data, toasts, slug, page);
    // The card's menu went with it: focus goes to the page's title rather than falling to the page.
    focusLater(() => (document.activeElement === document.body ? pageHeading(document) : undefined));
  };
  return { remove };
}

/** The list while its pages load, inside the Captures layout: skeleton cards in the cards' shape. */
export function LinksPending() {
  return (
    <CapturesList
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status="loading"
      cards={[]}
      empty={{ title: strings.emptyTitle, icon: 'calendar-clock' }}
      cardVariant="page"
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
