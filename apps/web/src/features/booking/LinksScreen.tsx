// Brief
// Purpose: Captures › Links (spec 0025, 0025-experience.md, AC-645): the member's booking pages as cards (an admin sees everyone's), the same cards as Forms; the workspace's own links (30 Oct 2026) in a Workspace group first.
// Main task: open a page, copy its link, or make a new one in the dialog and land in its editor.
// Leaves out: editing a page (its editor), forms (their own tab) and the bookings list (Bookings).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, focusLater, Menu, MenuItem, MenuSeparator, MenuTrigger, Tooltip, type LinkGridCard } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { strings as capturesStrings } from '../captures/strings.ts';
import { useCapturesCreate } from '../captures/create.tsx';
import { pageHeading } from '../navigation/focus.ts';
import { DeletePageDialog } from './DeletePageDialog.tsx';
import { pageEditorHref, publicBookingPath, publicBookingUrl, type PageTab } from './links.ts';
import { strings } from './strings.ts';

/** The groups' ids: the workspace's own links, and members' pages. */
const WORKSPACE_GROUP = 'workspace';
const MEMBERS_GROUP = 'members';

/** Props for the list: the data layer, whose held list of pages the route loaded. */
export interface LinksScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/**
 * A page's facts: its lengths, its kind, the schedule it names when it doesn't follow the default (spec 0035), and
 * a location that isn't video ("30 or 60 min · One on one · Evenings").
 */
function factsOf(page: BookingPageView): readonly string[] {
  return [
    ...(page.durations.length === 0 ? [] : [strings.minutesChoice(page.durations)]),
    page.scope === 'workspace' ? strings.workspaceLink : strings.kindLabel[page.kind],
    ...(page.scheduleId === null ? [] : [page.scheduleName]),
    ...(page.location.type === 'video' ? [] : [strings.locationChip[page.location.type]]),
  ];
}

/** The cards, New booking page, and each card's switch, Copy link, Open and menu, read from the data layer's held list. */
export function LinksScreen({ data, slug }: LinksScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const list = useCaptureList(data.bookingPages.view(slug));
  const create = useCapturesCreate();
  const [deleting, setDeleting] = useState<BookingPageView | undefined>(undefined);
  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.somethingWrong}` });
  };
  const open = (pageId: string, tab?: PageTab) => void navigate({ href: pageEditorHref(slug, pageId, tab) });
  // Each change shows in the list at once; a refusal puts it back there, and the toast says why. Pause and Resume
  // say theirs with Undo, as a form's switch and both editors do (Q73).
  const setStatus = (page: BookingPageView, status: 'live' | 'paused') => {
    data.bookingPages.update(slug, page.id, { status }).then(
      () => {
        toasts.toast({
          tone: 'success',
          message:
            status === 'live' ? capturesStrings.resumedToast(page.title) : capturesStrings.pausedToast(page.title),
          action: {
            label: capturesStrings.undo,
            onAction: () => setStatus(page, status === 'live' ? 'paused' : 'live'),
          },
        });
      },
      failed(status === 'paused' ? strings.turnOffFailed(page.title) : strings.turnOnFailed(page.title)),
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
  // The card leaves at once and comes back on a refusal; the confirm waits for the answer and says a refusal itself.
  const remove = (page: BookingPageView) =>
    data.bookingPages.remove(slug, page.id).then(() => {
      setDeleting(undefined);
      toasts.toast({ tone: 'success', message: strings.deleted(page.title) });
      // The card's menu went with it: focus goes to the page's title rather than falling to the page.
      focusLater(() => (document.activeElement === document.body ? pageHeading(document) : undefined));
    });
  const pages = list.status === 'ready' ? list.items : [];
  const cards: readonly LinkGridCard[] = pages.map((page) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(page.id);
    const isOff = page.status === 'paused';
    // A member sees the workspace's links to copy and open (owner, 30 Oct 2026): no editor, switch or menu.
    const isViewOnly = page.scope === 'workspace' && !page.canChange;
    return {
      id: page.id,
      groupId: page.scope === 'workspace' ? WORKSPACE_GROUP : MEMBERS_GROUP,
      title: page.title,
      ...(isViewOnly ? {} : { href: pageEditorHref(slug, page.id) }),
      // Pages have no colour of their own yet: the card takes a stable one from the page's id.
      colourKey: page.id,
      facts: factsOf(page),
      // The link Copy link copies, as a path.
      address: publicBookingPath(page),
      // Off shows in the muted title and the switch; the badge is for what they can't say.
      ...(isPending
        ? { badge: strings.copying }
        : isViewOnly
          ? { badge: strings.viewOnly }
          : page.pausedReason === 'host_removed'
            ? { badge: strings.hostRemoved }
            : page.isPrivate
              ? { badge: strings.linkOnly }
              : {}),
      isOff,
      isPending,
      ...(isViewOnly
        ? {}
        : {
            toggle: {
              label: strings.isOn(page.title),
              isSelected: page.status === 'live',
              onChange: (isOn: boolean) => {
                setStatus(page, isOn ? 'live' : 'paused');
              },
              isDisabled: !page.canChange,
              disabledReason: strings.notYours,
              hint: page.status === 'live' ? strings.takingBookings : strings.notTakingBookings,
            },
          }),
      copyValue: publicBookingUrl(page),
      actions: (
        <>
          {/* Off, there is nothing to open: the muted title and the switch say why. */}
          {!isOff && (
            <Tooltip content={strings.openInNewTab} isDisabled={isPending}>
              <Button
                variant="ghost"
                size="lg"
                icon="external-link"
                label={strings.openPage(page.title)}
                isDisabled={isPending}
                onPress={() => {
                  globalThis.open(publicBookingUrl(page), '_blank', 'noopener');
                }}
              />
            </Tooltip>
          )}
          {page.canChange && (
            <MenuTrigger>
              <Button
                variant="ghost"
                size="lg"
                icon="ellipsis"
                label={strings.more(page.title)}
                isDisabled={isPending}
              />
              <Menu
                label={strings.more(page.title)}
                onAction={(key) => {
                  if (key === 'duplicate') duplicate(page);
                  if (key === 'hours') open(page.id, 'hours');
                  if (key === 'delete') setDeleting(page);
                }}
              >
                <MenuItem id="duplicate" icon="copy">
                  {strings.duplicate}
                </MenuItem>
                <MenuItem id="hours" icon="clock">
                  {strings.hours}
                </MenuItem>
                <MenuSeparator />
                <MenuItem id="delete" icon="trash" isDanger>
                  {strings.delete}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )}
        </>
      ),
    };
  });
  // Grouped only once the workspace has a link of its own: the workspace's first, then everyone else's.
  const hasWorkspaceLinks = pages.some((page) => page.scope === 'workspace');
  return (
    <CapturesList
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status={list.status}
      cards={cards}
      {...(hasWorkspaceLinks
        ? {
            groups: [
              { id: WORKSPACE_GROUP, label: strings.workspaceGroup, description: strings.workspaceGroupLine },
              { id: MEMBERS_GROUP, label: strings.membersGroup },
            ],
          }
        : {})}
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
      empty={{ title: strings.emptyTitle, text: strings.emptyText, icon: 'calendar-clock' }}
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.bookingPages.view(slug).reload();
      }}
      dialogs={<DeletePageDialog page={deleting} onClose={() => setDeleting(undefined)} onDelete={remove} />}
    />
  );
}

/** The list while its pages load, inside the Captures layout: skeleton cards in the cards' shape. */
export function LinksPending() {
  return (
    <CapturesList
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status="loading"
      cards={[]}
      empty={{ title: strings.emptyTitle, text: strings.emptyText, icon: 'calendar-clock' }}
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
