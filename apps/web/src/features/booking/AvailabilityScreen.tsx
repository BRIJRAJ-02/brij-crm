// Brief
// Purpose: Bookings › Availability (spec 0035, AC-969, AC-970), the Calendly way (22 October 2026): the tab is the open schedule's editor, the default first, with a switcher to the member's other schedules.
// Main task: change the open schedule's hours, zone and days off (each saves as it changes), or switch, make, rename, set as default, duplicate or delete a schedule from the switcher.
// Leaves out: a list of schedules as rows (the switcher's menu lists them) and a calendar view of a schedule (a follow up).
import { isDataError, type DataLayer, type ScheduleMember, type ScheduleView } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import { Button, EmptyState, focusLater, PageColumn, SectionBar, Select, Tooltip, TopBar } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsActionSlot, useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { browserZone } from './zone.ts';
import { availabilityHref, scheduleHref } from './links.ts';
import { NewScheduleDialog } from './NewScheduleDialog.tsx';
import { RenameScheduleDialog } from './RenameScheduleDialog.tsx';
import { ScheduleEditor, ScheduleEditorPending } from './ScheduleEditor.tsx';
import { ScheduleSwitcher } from './ScheduleSwitcher.tsx';
import { SCHEDULES_MAX } from './schedules.ts';
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
  /** Whose schedules the reader may view (`schedules.members`): the Viewing Select's choices, for an admin. */
  readonly members: readonly ScheduleMember[];
  /** The reader's own member id. */
  readonly me: string;
}

/** The tab: the open schedule's editor, its switcher, the admin's Viewing Select and New schedule. */
export function AvailabilityScreen({ data, slug, scheduleId, member, members, me }: AvailabilityScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const view = data.schedules.view(slug, member, browserZone());
  // A reader who reaches colleagues (the server's `canActFor`; today `booking.admin`, AC-971) picks whose show.
  const reachesColleagues = useCan('booking.admin');
  const isAdmin = members.length > 1 || reachesColleagues;
  // A colleague's, by name, for the words that say whose they are.
  const owner = member === undefined ? undefined : members.find((each) => each.id === member)?.name;
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
        isOwn={member === undefined}
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
  const newAction = isFull ? <Tooltip content={scheduleStrings.limitReached}>{newButton}</Tooltip> : newButton;
  // The strip's end: an admin's compact member filter (AC-971), as the Calendar tab's tools are.
  const tools = (
    <SectionBar
      end={
        <>
          {isAdmin && (
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
              <ScheduleEditorPending switcher={switcher} />
            ) : (
              <ScheduleEditor
                // One editor per schedule, so unsaved hours never cross from one to another; the virtual default
                // keeps its editor while its first save stores it under the adopted id.
                key={current.id === null || current.id === adopted ? 'virtual' : current.id}
                data={data}
                slug={slug}
                member={member}
                schedule={current}
                switcher={switcher}
                onReload={() => view.reload()}
                onAdopt={setAdopted}
                onNotice={toast}
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

/** The switcher's place while the schedules load: a disabled button the width of a name. */
function SwitcherPending() {
  return (
    <Button variant="ghost" iconRight="chevron-down" isDisabled>
      {scheduleStrings.schedule}
    </Button>
  );
}

/**
 * An admin's Viewing Select (AC-971): their own schedules or a colleague's, by name, each at its own address. One
 * service answers the choices (`schedules.members`), so spec 0037's reach changes it there.
 */
function Viewing({
  members,
  me,
  value,
  onChange,
  isDisabled = false,
}: {
  readonly members: readonly ScheduleMember[];
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
      items={members.map((each) => ({
        id: each.id,
        label: each.id === me ? scheduleStrings.viewingMine : scheduleStrings.viewingTheirs(each.name),
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
  // An admin's Viewing Select stands in the strip while it loads, and New schedule waits in the TopBar, so
  // neither moves when the editor arrives.
  const isAdmin = useCan('booking.admin');
  const waiting = <NewScheduleButton isDisabled onPress={() => undefined} />;
  const tools = (
    <SectionBar
      end={
        <>
          {isAdmin && (
            <Viewing members={[{ id: 'me', name: '' }]} me="me" value="me" onChange={() => undefined} isDisabled />
          )}
          {actionSlot === null && waiting}
        </>
      }
    />
  );
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
            <ScheduleEditorPending switcher={<SwitcherPending />} />
          </>
        ),
      }}
    />
  );
}
