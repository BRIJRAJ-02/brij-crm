// Brief
// Purpose: Settings › Scheduling › Rotations (spec 0029, AC-728, AC-752, AC-758): the groups of people round robin pages share meetings across.
// Main task: an admin makes a rotation and changes or deletes one; a member sees the rotations they are in and their own share.
// Leaves out: editing in place, the share bars and the reassign offer (milestone 2), and a rotation's history (spec 0037).
import type { DataLayer, MemberSummary, RotationView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Badge,
  Button,
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
import { SettingsPage } from '../settings/SettingsPage.tsx';
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

/** The screen's body while it loads. */
export function RotationsPending() {
  return (
    <SettingsPage title={strings.title} description={strings.description} isLoading>
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    </SettingsPage>
  );
}

/** The screen. */
export function RotationsScreen({ data, slug, people, canManage }: RotationsScreenProps) {
  const state = useCaptureList(data.rotations.view(slug));
  const { toasts } = useRouteContext({ from: '__root__' });
  const [editing, setEditing] = useState<RotationView | 'new' | undefined>(undefined);
  const [deleting, setDeleting] = useState<RotationView | undefined>(undefined);
  const [isDeleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  // A fresh dialog per opening, so its draft and its id start afresh.
  const [opened, setOpened] = useState(0);

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

  return (
    <SettingsPage
      title={strings.title}
      description={canManage ? strings.description : strings.memberDescription}
      {...(newButton === undefined ? {} : { actions: newButton })}
    >
      {state.status === 'loading' ? (
        <Card isBusy>
          <Skeleton width="long" />
        </Card>
      ) : state.status === 'error' ? (
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => data.rotations.view(slug).reload()}>
          {strings.failedText}
        </EmptyState>
      ) : state.items.length === 0 ? (
        <EmptyState title={strings.emptyTitle} {...(newButton === undefined ? {} : { actions: newButton })}>
          {canManage ? strings.emptyText : strings.emptyMemberText}
        </EmptyState>
      ) : (
        <SettingsStack>
          {state.items.map((rotation) => (
            <Card
              key={rotation.id}
              title={rotation.name}
              description={strings.summary(rotation.strategy, rotation.windowDays, rotation.pages)}
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
                          <MenuItem id="delete" icon="trash" isDanger>
                            {strings.delete}
                          </MenuItem>
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
                    columns={COLUMNS}
                    rows={rotation.members}
                    getRowId={(member) => member.memberId}
                    renderCell={cell}
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
            setEditing(undefined);
            toasts.toast({
              tone: 'success',
              message: editing === 'new' ? strings.made(saved.name) : strings.saved(saved.name),
            });
          }}
        />
      )}
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
    </SettingsPage>
  );
}
