// Brief
// Purpose: Bookings › Availability (spec 0035, AC-969): the member's schedules, each with its Default badge, its week, its zone and how many booking pages use it.
// Main task: open a schedule to edit it, make a new one, or set the default, duplicate or delete one from its menu.
// Leaves out: editing hours (each schedule's own editor) and a calendar view of a schedule (a follow up).
import { isDataError, type DataLayer, type ScheduleMember, type ScheduleView } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import { Button, LinkList, PageColumn, SectionBar, Select, Tooltip, TopBar, type LinkRow } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { browserZone, weekSummary, zoneLabel } from './hours.ts';
import { availabilityHref, scheduleHref } from './links.ts';
import { NewScheduleDialog } from './NewScheduleDialog.tsx';
import { ScheduleMenu } from './ScheduleMenu.tsx';
import { SCHEDULES_MAX } from './schedules.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the list: the data layer, whose held schedules the route loaded. */
export interface AvailabilityScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly locale: string;
  /** Whose schedules show, when they aren't the reader's: an admin viewing a colleague's (AC-971). */
  readonly member: string | undefined;
  /** Whose schedules the reader may view (`schedules.members`): the Viewing Select's choices, for an admin. */
  readonly members: readonly ScheduleMember[];
  /** The reader's own member id. */
  readonly me: string;
}

/** A schedule's row: its name, zone, week, use, the Default badge and its menu (none on the virtual default). */
function rowOf(
  slug: string,
  member: string | undefined,
  schedule: ScheduleView,
  locale: string,
  menu: ReactNode,
): LinkRow {
  // A copy on its way has an id but no version yet: it can't be opened until the server made it.
  const isPending = schedule.id !== null && schedule.updatedAt === null;
  return {
    id: schedule.id ?? 'default',
    title: schedule.name,
    address: zoneLabel(schedule.availability.timeZone),
    description: weekSummary(schedule.availability, locale).join(' · '),
    chips: [schedule.pages.length === 0 ? scheduleStrings.usedByNone : scheduleStrings.usedBy(schedule.pages.length)],
    ...(isPending ? { badge: scheduleStrings.copying, isPending } : {}),
    ...(!isPending && schedule.isDefault ? { badge: scheduleStrings.defaultBadge } : {}),
    ...(schedule.id === null ? {} : { actions: menu }),
    href: scheduleHref(slug, schedule.id ?? 'default', member),
  };
}

/** The member's schedules as rows, New schedule at the end of the tab strip, and each row's menu. */
export function AvailabilityScreen({ data, slug, locale, member, members, me }: AvailabilityScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const view = data.schedules.view(slug, member, browserZone());
  // An admin sees whose schedules show, and may pick a colleague's (AC-971); the Select is the same one loading.
  const isAdmin = useCan('booking.admin');
  // A colleague's, by name, for the words that say whose they are.
  const owner = member === undefined ? undefined : members.find((each) => each.id === member)?.name;
  const state = useSchedules(view);
  const slot = useBookingsToolbarSlot();
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleView | undefined>(undefined);
  const schedules = state.status === 'ready' ? state.schedules : [];
  const memberId = state.status === 'ready' ? state.memberId : undefined;
  const fallback = schedules.find((each) => each.isDefault);
  const isFull = schedules.filter((each) => each.id !== null).length >= SCHEDULES_MAX;
  const failed = (message: string) => (error: unknown) => {
    toasts.toast({
      tone: 'danger',
      message: `${message} ${isDataError(error) ? error.message : strings.somethingWrong}`,
    });
  };
  const setDefault = (schedule: ScheduleView) => {
    data.schedules
      .setDefault(slug, schedule)
      .then(
        () => toasts.toast({ tone: 'success', message: scheduleStrings.setDefaultDone(schedule.name, owner) }),
        failed(scheduleStrings.setDefaultFailed(schedule.name)),
      );
  };
  const duplicate = (schedule: ScheduleView) => {
    data.schedules
      .duplicate(slug, schedule)
      .then(
        (copy) => toasts.toast({ tone: 'success', message: scheduleStrings.duplicated(copy.name) }),
        failed(scheduleStrings.duplicateFailed(schedule.name)),
      );
  };
  const rows = schedules.map((schedule) =>
    rowOf(
      slug,
      member,
      schedule,
      locale,
      <ScheduleMenu
        schedule={schedule}
        isFull={isFull}
        isDisabled={schedule.updatedAt === null}
        onSetDefault={() => setDefault(schedule)}
        onDuplicate={() => duplicate(schedule)}
        onDelete={() => setDeleting(schedule)}
      />,
    ),
  );
  // At the end of the Calendar · List · Availability strip, as each tab's tools are; alone, at the column's top end.
  const newButton = (
    <NewScheduleButton isDisabled={memberId === undefined || isFull} onPress={() => setCreating(true)} />
  );
  // One row at the strip's end, as the Calendar tab's tools are.
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
          {isFull ? <Tooltip content={scheduleStrings.limitReached}>{newButton}</Tooltip> : newButton}
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
            <PageColumn {...(slot === null ? { actions: tools } : {})}>
              <AvailabilityList
                label={owner === undefined ? scheduleStrings.schedules : scheduleStrings.viewingTheirs(owner)}
                rows={rows}
                status={state.status === 'ready' ? 'ready' : state.status}
                onOpen={(id) => void navigate({ href: scheduleHref(slug, id, member) })}
                onRetry={() => view.reload()}
              />
            </PageColumn>
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
                  if (schedule.id !== null) void navigate({ href: scheduleHref(slug, schedule.id, member) });
                }}
              />
            )}
            <DeleteScheduleDialog
              schedule={deleting}
              fallbackName={fallback?.name ?? scheduleStrings.defaultBadge}
              isOwn={member === undefined}
              onClose={() => setDeleting(undefined)}
              onDelete={(schedule) => data.schedules.remove(slug, schedule)}
              onDeleted={(schedule) => {
                setDeleting(undefined);
                toasts.toast({ tone: 'success', message: scheduleStrings.deleted(schedule.name) });
              }}
            />
          </>
        ),
      }}
    />
  );
}

/** The rows, in every state: loading draws the rows' shape, a failed read says so with Try again. */
function AvailabilityList({
  label,
  rows,
  status,
  onOpen,
  onRetry,
}: {
  readonly label: string;
  readonly rows: readonly LinkRow[];
  readonly status: 'loading' | 'error' | 'ready';
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
}) {
  return (
    <LinkList
      label={label}
      searchLabel={label}
      isToolbarHidden
      rows={rows}
      onOpen={onOpen}
      status={status}
      onRetry={onRetry}
      errorTitle={scheduleStrings.schedulesFailed}
    />
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

/** New schedule, the tab's one tool. */
function NewScheduleButton({ isDisabled, onPress }: { readonly isDisabled: boolean; readonly onPress: () => void }) {
  return (
    <Button icon="plus" isDisabled={isDisabled} onPress={onPress}>
      {scheduleStrings.newSchedule}
    </Button>
  );
}

/**
 * The list while it loads: the same column and rows, and New schedule waiting in the strip, so the strip and the
 * page land where the skeleton put them.
 */
export function AvailabilityPending() {
  const slot = useBookingsToolbarSlot();
  // An admin's Viewing Select stands in the strip while it loads, so the strip doesn't move when it arrives.
  const isAdmin = useCan('booking.admin');
  const tools = (
    <SectionBar
      end={
        <>
          {isAdmin && (
            <Viewing members={[{ id: 'me', name: '' }]} me="me" value="me" onChange={() => undefined} isDisabled />
          )}
          <NewScheduleButton isDisabled onPress={() => undefined} />
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
            <PageColumn {...(slot === null ? { actions: tools } : {})}>
              <AvailabilityList
                label={scheduleStrings.schedules}
                rows={[]}
                status="loading"
                onOpen={() => undefined}
                onRetry={() => undefined}
              />
            </PageColumn>
          </>
        ),
      }}
    />
  );
}
