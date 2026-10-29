// Brief
// Purpose: Bookings › Availability (spec 0035, AC-969, AC-970), the Calendly way (22 October 2026): the tab is the open schedule's editor, the default first, with a switcher to the member's other schedules.
// Main task: change the open schedule's hours, zone and days off (each saves as it changes), or switch, make, rename, set as default, duplicate or delete a schedule from the switcher.
// Leaves out: a list of schedules as rows (the switcher's menu lists them) and a calendar view of a schedule (a follow up).
import { isDataError, type DataLayer, type ScheduleView, type VisibleMember } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import {
  Button,
  Callout,
  EmptyState,
  focusLater,
  PageColumn,
  RelativeTime,
  SectionBar,
  Select,
  Tooltip,
  TopBar,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsActionSlot, useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { memberZone } from './zone.ts';
import { availabilityHref, scheduleHref } from './links.ts';
import { NewScheduleDialog } from './NewScheduleDialog.tsx';
import { RenameScheduleDialog } from './RenameScheduleDialog.tsx';
import { ScheduleEditor, ScheduleEditorPending } from './ScheduleEditor.tsx';
import { ScheduleSwitcher } from './ScheduleSwitcher.tsx';
import { SCHEDULES_MAX, showsViewing } from './schedules.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the tab: the data layer, whose held schedules the route loaded, and which one is open. */
export interface AvailabilityScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The open schedule (`?schedule=`); undefined opens the default. */
  readonly scheduleId: string | undefined;
  /** Whose schedules show, when they aren't the reader's: an admin viewing a colleague's (AC-971). */
  readonly member: string | undefined;
  /**
   * Whose schedules the reader may see (`members.visible`, spec 0037, AC-1261): the Viewing Select's choices, the
   * reader first, each with whether they may change them.
   */
  readonly members: readonly VisibleMember[];
  /** The reader's own member id. */
  readonly me: string;
  /** The reader may change their own hours (`availability.own`); without it they are set by others (AC-1260). */
  readonly ownHours: boolean;
  /** A member's name by id, for "Changed by" (the workspace's members, AC-1265). */
  readonly nameOf: (memberId: string) => string | undefined;
}

/** The tab: the open schedule's editor, its switcher, the admin's Viewing Select and New schedule. */
export function AvailabilityScreen({
  data,
  slug,
  scheduleId,
  member,
  members,
  me,
  ownHours,
  nameOf,
}: AvailabilityScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const view = data.schedules.view(slug, member, memberZone(data, slug));
  // An admin (the server's `canActFor`; today `booking.admin`, AC-971) picks whose show, once there is a colleague.
  const hasColleagues = showsViewing(members, member);
  // A colleague's, by name, for the words that say whose they are.
  const viewed = member === undefined ? undefined : members.find((each) => each.id === member);
  const owner = viewed?.name;
  // Whether the reader may change what shows (spec 0037): a colleague's with Manage over their hours, their own with
  // `availability.own`. The server decides every write anyway; this only spares a save it would refuse.
  const canChange = member === undefined ? ownHours : viewed?.canChangeHours === true;
  // Managed, but their hours set by others (a grant they made themself, AC-1255): read only, and said why.
  const hoursHeldBack = member !== undefined && viewed?.canManage === true && !canChange;
  const state = useSchedules(view);
  const slot = useBookingsToolbarSlot();
  const actionSlot = useBookingsActionSlot();
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleView | undefined>(undefined);
  const [renaming, setRenaming] = useState<ScheduleView | undefined>(undefined);
  // The id the virtual default is being stored under: the same editor stays for it as it lands.
  const [adopted, setAdopted] = useState<string | undefined>(undefined);
  // One toast for the hours at a time: a new save's replaces the last one's.
  const lastToast = useRef<string | undefined>(undefined);
  const schedules = state.status === 'ready' ? state.schedules : [];
  const memberId = state.status === 'ready' ? state.memberId : undefined;
  const fallback = schedules.find((each) => each.isDefault);
  // The open one: the address's, else the default (a deleted or unknown id opens the default too).
  const current = (scheduleId === undefined ? undefined : schedules.find((each) => each.id === scheduleId)) ?? fallback;
  const isFull = schedules.filter((each) => each.id !== null).length >= SCHEDULES_MAX;
  // The switcher's trigger: a switch remounts the editor and the menu's item is gone, so focus comes back here.
  const switcherRef = useRef<HTMLButtonElement>(null);
  const refocus = () => focusLater(() => switcherRef.current);
  const open = (id: string | null, replace = false) => {
    void navigate({ href: scheduleHref(slug, id === null || id === fallback?.id ? 'default' : id, member), replace });
    refocus();
  };
  // An address naming a schedule that isn't here (deleted, maybe in another tab) opens the default, at its own address.
  const isUnknown =
    state.status === 'ready' && scheduleId !== undefined && !schedules.some((each) => each.id === scheduleId);
  useEffect(() => {
    if (isUnknown) void navigate({ href: scheduleHref(slug, 'default', member), replace: true });
  }, [isUnknown, navigate, slug, member]);
  const toast = (notice: {
    readonly tone: 'success' | 'danger';
    readonly message: string;
    readonly action?: { readonly label: string; readonly onAction: () => void };
  }) => {
    if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
    lastToast.current = toasts.toast(notice);
  };
  const failed = (message: string) => (error: unknown) => {
    toast({ tone: 'danger', message: `${message} ${isDataError(error) ? error.message : strings.somethingWrong}` });
  };
  // The address keeps naming the schedule, so it stays open whichever way the server answers.
  const setDefault = (schedule: ScheduleView, isUndo = false) => {
    const was = fallback;
    data.schedules.setDefault(slug, schedule).then(
      () =>
        toast(
          isUndo
            ? { tone: 'success', message: scheduleStrings.setDefaultUndone(schedule.name) }
            : {
                tone: 'success',
                message: scheduleStrings.setDefaultDone(schedule.name, owner),
                ...(was === undefined || was.id === null
                  ? {}
                  : { action: { label: scheduleStrings.undo, onAction: () => setDefault(was, true) } }),
              },
        ),
      failed(scheduleStrings.setDefaultFailed(schedule.name)),
    );
  };
  const duplicate = (schedule: ScheduleView) => {
    data.schedules.duplicate(slug, schedule).then(
      (copy) => {
        toast({ tone: 'success', message: scheduleStrings.duplicated(copy.name) });
        if (copy.id !== null) open(copy.id);
      },
      failed(scheduleStrings.duplicateFailed(schedule.name)),
    );
  };
  const switcher =
    current === undefined ? (
      <SwitcherPending />
    ) : (
      <ScheduleSwitcher
        schedules={schedules}
        current={current}
        isFull={isFull}
        isReadOnly={!canChange}
        triggerRef={switcherRef}
        onOpen={(schedule) => open(schedule.id)}
        onCreate={() => setCreating(true)}
        onRename={() => setRenaming(current)}
        onSetDefault={() => setDefault(current)}
        onDuplicate={() => duplicate(current)}
        onDelete={() => setDeleting(current)}
      />
    );
  // New schedule is the screen's one primary, at the TopBar's end in place of New meeting (the owner, 22 October
  // 2026); with no TopBar slot it stays at the strip's end.
  const newButton = (
    <NewScheduleButton isDisabled={memberId === undefined || isFull} onPress={() => setCreating(true)} />
  );
  // Read only, there is nothing to make: the Callout above the week says why, so no dead button stands here.
  const newAction = !canChange ? null : isFull ? (
    <Tooltip content={scheduleStrings.limitReached}>{newButton}</Tooltip>
  ) : (
    newButton
  );
  // The strip's end, as the Calendar tab's tools are (the owner, 22 October 2026: no row of its own over the card):
  // the schedule switcher, and an admin's compact member filter (AC-971).
  const tools = (
    <SectionBar
      start={switcher}
      end={
        <>
          {hasColleagues && (
            <Viewing
              members={members}
              me={me}
              value={member ?? me}
              onChange={(id) => void navigate({ href: availabilityHref(slug, id === me ? undefined : id) })}
            />
          )}
          {actionSlot === null && newAction}
        </>
      }
    />
  );
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" />,
        body: (
          <>
            {slot !== null && createPortal(tools, slot)}
            {actionSlot !== null && createPortal(newAction, actionSlot)}
            {slot === null && tools}
            {state.status === 'error' ? (
              <PageColumn align="center">
                <EmptyState tone="error" title={scheduleStrings.schedulesFailed} onRetry={() => view.reload()}>
                  {state.error.message}
                </EmptyState>
              </PageColumn>
            ) : current === undefined ? (
              <ScheduleEditorPending />
            ) : (
              <ScheduleEditor
                // One editor per schedule, so unsaved hours never cross from one to another; the virtual default
                // keeps its editor while its first save stores it under the adopted id.
                key={current.id === null || current.id === adopted ? 'virtual' : current.id}
                data={data}
                slug={slug}
                member={member}
                schedule={current}
                onReload={() => view.reload()}
                onAdopt={setAdopted}
                onNotice={toast}
                isReadOnly={!canChange}
                notice={
                  <AccessNotice
                    owner={owner}
                    canChange={canChange}
                    hoursHeldBack={hoursHeldBack}
                    schedule={current}
                    me={me}
                    nameOf={nameOf}
                  />
                }
              />
            )}
            {memberId !== undefined && (
              <NewScheduleDialog
                data={data}
                slug={slug}
                memberId={memberId}
                forMember={member !== undefined}
                isOpen={isCreating}
                onClose={() => setCreating(false)}
                onCreated={(schedule) => {
                  setCreating(false);
                  if (schedule.id !== null) open(schedule.id);
                }}
              />
            )}
            <RenameScheduleDialog
              data={data}
              slug={slug}
              schedule={renaming}
              onClose={() => {
                setRenaming(undefined);
                refocus();
              }}
              onRenamed={(schedule) => {
                setRenaming(undefined);
                refocus();
                toast({ tone: 'success', message: scheduleStrings.renamed(schedule.name) });
              }}
            />
            <DeleteScheduleDialog
              schedule={deleting}
              fallbackName={fallback?.name ?? scheduleStrings.defaultBadge}
              isOwn={member === undefined}
              onClose={() => {
                setDeleting(undefined);
                refocus();
              }}
              onDelete={(schedule) => data.schedules.remove(slug, schedule)}
              onDeleted={(schedule) => {
                setDeleting(undefined);
                toast({ tone: 'success', message: scheduleStrings.deleted(schedule.name) });
                open(null, true);
              }}
            />
          </>
        ),
      }}
    />
  );
}

/**
 * What the reader should know above the week (spec 0037): a colleague's hours they may only See (AC-1268), a
 * colleague who is told about their changes, their own hours set by others (AC-1260), and who changed them last when
 * that wasn't their member (AC-1265). Nothing for one's own hours one changes oneself.
 */
function AccessNotice({
  owner,
  canChange,
  hoursHeldBack,
  schedule,
  me,
  nameOf,
}: {
  readonly owner: string | undefined;
  readonly canChange: boolean;
  /** The reader manages the colleague but not their hours (AC-1255): they still book and block for them. */
  readonly hoursHeldBack: boolean;
  readonly schedule: ScheduleView;
  readonly me: string;
  readonly nameOf: (memberId: string) => string | undefined;
}) {
  let line: string | undefined;
  if (owner !== undefined) {
    line = canChange
      ? scheduleStrings.toldAboutChanges(owner)
      : hoursHeldBack
        ? scheduleStrings.hoursHeldBack(owner)
        : scheduleStrings.seeOnly(owner);
  } else if (!canChange) line = scheduleStrings.hoursSetByOthers;
  const changed = schedule.changedBy;
  const by =
    changed === undefined
      ? undefined
      : changed.memberId === me
        ? scheduleStrings.you
        : (nameOf(changed.memberId) ?? scheduleStrings.someone);
  if (line === undefined && by === undefined) return null;
  return (
    <Callout tone="info">
      {line}
      {line !== undefined && by !== undefined && ' '}
      {changed !== undefined && by !== undefined && (
        <>
          {scheduleStrings.changedBy(by)}, <RelativeTime value={changed.at} />.
        </>
      )}
    </Callout>
  );
}

/** The switcher's place while the schedules load: a disabled button the width of a name. */
function SwitcherPending() {
  return (
    <Button variant="ghost" iconRight="chevron-down" isDisabled>
      {scheduleStrings.schedule}
    </Button>
  );
}

/**
 * The Viewing Select (AC-971; spec 0037, AC-1268): the reader's own schedules or a colleague's in their See reach, by
 * name, each at its own address, the ones they may only See marked so. `members.visible` answers the choices.
 */
function Viewing({
  members,
  me,
  value,
  onChange,
  isDisabled = false,
}: {
  readonly members: readonly VisibleMember[];
  readonly me: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly isDisabled?: boolean;
}) {
  return (
    <Select
      label={scheduleStrings.viewing}
      isLabelHidden
      size="sm"
      isSearchable
      isDisabled={isDisabled}
      // A colleague the reader may only See says so in the list, before they open them (AC-1268).
      showsDescription
      items={members.map((each) => ({
        id: each.id,
        label: each.id === me ? scheduleStrings.viewingMine : scheduleStrings.viewingTheirs(each.name),
        ...(each.id === me || each.canManage ? {} : { description: scheduleStrings.seeOnlyShort }),
      }))}
      value={value}
      onChange={(id) => {
        if (id !== null && id !== value) onChange(id);
      }}
    />
  );
}

/** New schedule, the screen's one primary. */
function NewScheduleButton({ isDisabled, onPress }: { readonly isDisabled: boolean; readonly onPress: () => void }) {
  return (
    <Button variant="primary" icon="plus" isDisabled={isDisabled} onPress={onPress}>
      {scheduleStrings.newSchedule}
    </Button>
  );
}

/**
 * The tab while it loads: the editor's shape, and New schedule waiting in the TopBar, so the strip and the page land
 * where the skeleton put them.
 */
export function AvailabilityPending() {
  const slot = useBookingsToolbarSlot();
  const actionSlot = useBookingsActionSlot();
  // New schedule waits in the TopBar, so it doesn't move when the editor arrives. The Viewing Select shows only
  // once colleagues are known, so it doesn't stand here.
  const waiting = <NewScheduleButton isDisabled onPress={() => undefined} />;
  const tools = <SectionBar start={<SwitcherPending />} end={<>{actionSlot === null && waiting}</>} />;
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" isLoading />,
        body: (
          <>
            {slot !== null && createPortal(tools, slot)}
            {actionSlot !== null && createPortal(waiting, actionSlot)}
            {slot === null && tools}
            <ScheduleEditorPending />
          </>
        ),
      }}
    />
  );
}
