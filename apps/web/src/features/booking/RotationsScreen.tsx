// Brief
// Purpose: Settings › Scheduling › Round robin (spec 0029, AC-728, AC-752, AC-758): the groups of people round robin pages share meetings across (rotations in code), with a How round robin works help beside the title.
// Main task: an admin makes a group and changes or deletes one; a member sees the groups they are in and their own share.
// Leaves out: editing in place, the share bars and the reassign offer (milestone 2), and a rotation's history (spec 0037).
import type { DataLayer, MemberSummary, RotationView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  InfoTip,
  Link,
  Callout,
  Card,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  SettingsStack,
  Skeleton,
  Table,
  TabPanel,
  Tabs,
  Tooltip,
  type TableColumn,
  RecordChip,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsActionSlot } from '../bookings/toolbarSlot.ts';
import { linksHref } from '../captures/tabs.ts';
import { InviteTeamDialog } from '../settings/InviteTeamDialog.tsx';
import { membersSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { DistributionPanel } from './DistributionPanel.tsx';
import { RotationDialog } from './RotationDialog.tsx';
import { strings } from './rotation-strings.ts';

/** Props for the screen: what its route loaded through the data layer. */
export interface RotationsScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The workspace's active members, for the dialog's picker. */
  readonly people: readonly MemberSummary[];
  /** The reader holds `booking.admin`: they make, change and delete rotations. */
  readonly canManage: boolean;
  /**
   * Drawn as a tab of Bookings rather than a page of Settings (25 October 2026): the body alone, with New group
   * in the frame's own TopBar where Availability puts New schedule, one primary per screen.
   */
  readonly inFrame?: boolean;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'member', label: strings.columns.member, isRowHeader: true, isInline: true },
  { id: 'share', label: strings.columns.share, align: 'end' },
  { id: 'weight', label: strings.columns.weight, align: 'end' },
  { id: 'priority', label: strings.columns.priority },
  { id: 'cap', label: strings.columns.cap, align: 'end' },
  { id: 'weekly', label: strings.columns.weekly, align: 'end' },
  { id: 'on', label: strings.columns.on },
];

/** An admin's columns: the members', and a last one for handing a switched off member's bookings on (AC-750). */
const ADMIN_COLUMNS: readonly TableColumn[] = [
  ...COLUMNS,
  { id: 'actions', label: strings.hostActions, isLabelHidden: true, align: 'end' },
];

/** A member whose upcoming bookings an admin may hand on. */
interface Handing {
  readonly rotation: RotationView;
  readonly memberId: string;
  readonly name: string;
  readonly count: number;
}

type Member = RotationView['members'][number];

/** One member's cell. */
function cell(member: Member, column: string) {
  switch (column) {
    case 'member':
      return (
        <>
          <RecordChip display={{ type: 'member', id: member.memberId, name: member.name }} isFlat />
          {!member.hasCalendar && (
            <Tooltip content={strings.noCalendarHint} isTextTrigger>
              <Badge text={strings.noCalendar} />
            </Tooltip>
          )}
        </>
      );
    case 'share':
      return member.count === undefined ? strings.hidden : strings.shareOf(member.count);
    case 'weight':
      return String(member.weight);
    case 'priority':
      return strings.priorities[member.priority] ?? '';
    case 'cap':
      return member.dailyCap === null ? strings.noCap : String(member.dailyCap);
    case 'weekly':
      return member.weeklyCap === null ? strings.noCap : String(member.weeklyCap);
    default:
      return member.isOn ? strings.isOn : strings.isOff;
  }
}

/**
 * How round robin works, in three plain steps beside the title (the owner, 22 October 2026; shortened 23 October):
 * true to how the server assigns (spec 0029, `rotation/pick.ts`): the booking goes to a free member by the group's
 * rule, Fair by default.
 */
function RoundRobinHelp({ slug }: { readonly slug: string }) {
  return (
    <InfoTip label={strings.helpLabel}>
      {/* InfoTip's text is a paragraph, so its title and the steps are lines in it, the link last. */}
      <strong>{strings.helpLabel}</strong>
      {strings.helpSteps.map((step, index) => (
        <span key={step}>
          <br />
          {`${String(index + 1)}. ${step}`}
        </span>
      ))}
      <br />
      <Link href={linksHref(slug)}>{strings.createPage}</Link>
    </InfoTip>
  );
}

/** The screen's body while it loads, in whichever frame it is drawn. */
export function RotationsPending({ inFrame = false }: { readonly inFrame?: boolean } = {}) {
  return (
    <SettingsPage title={strings.title} isLoading inFrame={inFrame}>
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    </SettingsPage>
  );
}

/** The screen. */
export function RotationsScreen({ data, slug, people, canManage, inFrame = false }: RotationsScreenProps) {
  const state = useCaptureList(data.rotations.view(slug));
  const { toasts } = useRouteContext({ from: '__root__' });
  const [editing, setEditing] = useState<RotationView | 'new' | undefined>(undefined);
  const [deleting, setDeleting] = useState<RotationView | undefined>(undefined);
  const [isDeleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  // A fresh dialog per opening, so its draft and its id start afresh.
  const [opened, setOpened] = useState(0);
  // Invite teammates opens the one Invite dialog in place for someone who may invite; anyone else is sent to
  // Settings › Members, which says who can.
  const canInvite = useCan('members.invite');
  // Where the frame wants this tab's one primary action, when the frame is Bookings rather than Settings.
  const actionSlot = useBookingsActionSlot();
  const [isInviting, setInviting] = useState(false);
  // Members whose upcoming bookings an admin may hand on, one prompt at a time (every member a save removed).
  const [queue, setQueue] = useState<readonly Handing[]>([]);
  const handing = queue[0];
  const setHanding = (next: Handing | undefined) => {
    setQueue(next === undefined ? [] : [next]);
  };
  const nextHanding = () => {
    setQueue((current) => current.slice(1));
  };
  const [isHandingBusy, setHandingBusy] = useState(false);
  const handOn = () => {
    if (handing === undefined || isHandingBusy) return;
    setHandingBusy(true);
    const target = handing;
    data.rotations.reassignUpcoming(slug, target.rotation.id, target.memberId).then(
      (done) => {
        setHandingBusy(false);
        nextHanding();
        toasts.toast({ tone: 'success', message: strings.handedOn(done.queued) });
      },
      () => {
        setHandingBusy(false);
        toasts.toast({ tone: 'danger', message: strings.somethingWrong });
      },
    );
  };
  const rowCell = (rotation: RotationView) => (member: Member, column: string) =>
    column !== 'actions' ? (
      cell(member, column)
    ) : member.isOn || (member.upcoming ?? 0) === 0 ? null : (
      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          setHanding({ rotation, memberId: member.memberId, name: member.name, count: member.upcoming ?? 0 });
        }}
      >
        {strings.handOnAction(member.upcoming ?? 0)}
      </Button>
    );

  const open = (target: RotationView | 'new') => {
    setOpened((count) => count + 1);
    setEditing(target);
  };
  const remove = () => {
    if (deleting === undefined || isDeleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    const target = deleting;
    data.rotations.remove(slug, target.id).then(
      () => {
        setDeleteBusy(false);
        setDeleting(undefined);
        toasts.toast({ tone: 'success', message: strings.deleted(target.name) });
      },
      (error: unknown) => {
        setDeleteBusy(false);
        // The answer says why ("Used by 2 pages"); it stays in the open dialog.
        setDeleteError(error instanceof Error ? error.message : strings.deleteFailed(target.name));
      },
    );
  };

  const newButton = canManage ? (
    <Button variant="primary" icon="plus" onPress={() => open('new')}>
      {strings.newRotation}
    </Button>
  ) : undefined;

  const isEmpty = state.status === 'ready' && state.items.length === 0;
  const isAloneEmpty = canManage && people.length < 2 && isEmpty;
  // The one New group, in whichever bar this frame has: Settings' own TopBar takes it as an action, and the
  // Bookings frame takes it through the slot its layout lends the chosen tab.
  const action = newButton === undefined || isEmpty ? undefined : newButton;
  return (
    <SettingsPage
      title={strings.title}
      meta={<RoundRobinHelp slug={slug} />}
      inFrame={inFrame}
      // One New group at a time: the empty state's while there are no groups (or Invite teammates, alone), then the
      // bar's once a group exists (SS-R2).
      {...(inFrame || action === undefined ? {} : { actions: action })}
    >
      {inFrame && action !== undefined && actionSlot !== null && createPortal(action, actionSlot)}
      {state.status === 'loading' ? (
        <Card isBusy>
          <Skeleton width="long" />
        </Card>
      ) : state.status === 'error' ? (
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => data.rotations.view(slug).reload()}>
          {strings.failedText}
        </EmptyState>
      ) : state.items.length === 0 ? (
        isAloneEmpty ? (
          // Alone in the workspace: round robin needs teammates first.
          <EmptyState
            icon="users-round"
            title={strings.emptyAloneTitle}
            // The help sits once, beside the page's title.
            actions={
              canInvite ? (
                <Button
                  variant="primary"
                  icon="user-plus"
                  onPress={() => {
                    setInviting(true);
                  }}
                >
                  {strings.inviteTeammates}
                </Button>
              ) : (
                <ButtonLink variant="primary" icon="user-plus" href={membersSettingsHref(slug)}>
                  {strings.inviteTeammates}
                </ButtonLink>
              )
            }
          >
            {strings.emptyAloneText}
          </EmptyState>
        ) : (
          <EmptyState
            icon="users-round"
            title={strings.emptyTitle}
            // No groups yet: New group is the page's one primary, here; the help sits once, beside the page's title.
            {...(canManage ? { actions: newButton } : {})}
          >
            {canManage ? strings.emptyText : strings.emptyMemberText}
          </EmptyState>
        )
      ) : (
        <SettingsStack>
          {state.items.map((rotation) => (
            <Card
              key={rotation.id}
              title={rotation.name}
              description={
                rotation.follows === 'everyone'
                  ? strings.rosterSummary(rotation.members.filter((member) => member.isOn).length, rotation.pages)
                  : strings.summary(rotation.strategy, rotation.windowDays, rotation.pages)
              }
              {...(rotation.canChange
                ? {
                    actions: (
                      <MenuTrigger>
                        <Button variant="ghost" icon="ellipsis" label={strings.rowActions(rotation.name)} />
                        <Menu
                          label={strings.rowActions(rotation.name)}
                          onAction={(key) => {
                            if (key === 'edit') open(rotation);
                            if (key === 'delete') {
                              setDeleteError(undefined);
                              setDeleting(rotation);
                            }
                          }}
                        >
                          <MenuItem id="edit" icon="pencil">
                            {strings.edit}
                          </MenuItem>
                          {/* Everyone on the roster follows the workspace: its link keeps it, so it isn't deleted here. */}
                          {rotation.follows !== 'everyone' && (
                            <MenuItem id="delete" icon="trash" isDanger>
                              {strings.delete}
                            </MenuItem>
                          )}
                        </Menu>
                      </MenuTrigger>
                    ),
                  }
                : {})}
            >
              <Tabs
                label={strings.views(rotation.name)}
                tabs={[
                  { id: 'members', label: strings.membersTab },
                  { id: 'distribution', label: strings.distributionTab },
                ]}
              >
                <TabPanel id="members">
                  <Table
                    label={strings.members(rotation.name)}
                    isScrollable
                    columns={rotation.canChange ? ADMIN_COLUMNS : COLUMNS}
                    rows={rotation.members}
                    getRowId={(member) => member.memberId}
                    renderCell={rowCell(rotation)}
                  />
                </TabPanel>
                <TabPanel id="distribution">
                  <DistributionPanel
                    data={data}
                    slug={slug}
                    rotation={rotation}
                    onNotice={(message) => toasts.toast({ tone: 'success', message })}
                  />
                </TabPanel>
              </Tabs>
            </Card>
          ))}
        </SettingsStack>
      )}
      {editing !== undefined && (
        <RotationDialog
          key={opened}
          data={data}
          slug={slug}
          people={people}
          {...(editing === 'new' ? {} : { rotation: editing })}
          isOpen
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            const before = editing;
            setEditing(undefined);
            toasts.toast({
              tone: 'success',
              message: before === 'new' ? strings.made(saved.name) : strings.saved(saved.name),
            });
            // Everyone removed who still has upcoming bookings here: offer to hand each on (AC-750).
            if (before !== 'new') {
              setQueue(
                before.members
                  .filter(
                    (member) =>
                      (member.upcoming ?? 0) > 0 && !saved.members.some((each) => each.memberId === member.memberId),
                  )
                  .map((member) => ({
                    rotation: saved,
                    memberId: member.memberId,
                    name: member.name,
                    count: member.upcoming ?? 0,
                  })),
              );
            }
          }}
        />
      )}
      <Modal
        title={strings.handOnTitle(handing?.name ?? '', handing?.count ?? 0)}
        isOpen={handing !== undefined}
        isBusy={isHandingBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isHandingBusy) {
            nextHanding();
            toasts.toast({ tone: 'info', message: strings.keptNote });
          }
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isHandingBusy} kbd="ESC">
              {strings.keepThem}
            </Button>
            <Button variant="primary" isPending={isHandingBusy} onPress={handOn}>
              {strings.handOnConfirm(handing?.count ?? 0)}
            </Button>
          </>
        }
      >
        {strings.handOnText(handing?.rotation.name ?? '', handing?.count ?? 0)}
      </Modal>
      <Modal
        title={strings.deleteTitle(deleting?.name ?? '')}
        tone="danger"
        isOpen={deleting !== undefined}
        isBusy={isDeleteBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeleteBusy) setDeleting(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isDeleteBusy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isDeleteBusy} onPress={remove}>
              {isDeleteBusy ? strings.deleting : strings.deleteAction}
            </Button>
          </>
        }
      >
        <SettingsStack>
          {deleteError !== undefined && <Callout tone="danger">{deleteError}</Callout>}
          {strings.deleteText}
        </SettingsStack>
      </Modal>
      {canInvite && (
        <InviteTeamDialog
          data={data}
          slug={slug}
          isOpen={isInviting}
          onClose={() => {
            setInviting(false);
          }}
        />
      )}
    </SettingsPage>
  );
}
