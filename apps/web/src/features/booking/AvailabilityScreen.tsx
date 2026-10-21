// Brief
// Purpose: Bookings › Availability (spec 0035, AC-969): the member's schedules, each with its Default badge, its week, its zone and how many booking pages use it.
// Main task: open a schedule to edit it, make a new one, or set the default, duplicate or delete one from its menu.
// Leaves out: editing hours (each schedule's own editor) and a calendar view of a schedule (a follow up).
import { isDataError, type DataLayer, type ScheduleView } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import { Button, LinkList, PageColumn, Tooltip, TopBar, type LinkRow } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { browserZone, weekSummary, zoneLabel } from './hours.ts';
import { scheduleHref } from './links.ts';
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
}

/** A schedule's row: its name, zone, week, use, the Default badge and its menu (none on the virtual default). */
function rowOf(slug: string, schedule: ScheduleView, locale: string, menu: ReactNode): LinkRow {
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
    href: scheduleHref(slug, schedule.id ?? 'default'),
  };
}

/** The member's schedules as rows, New schedule at the end of the tab strip, and each row's menu. */
export function AvailabilityScreen({ data, slug, locale }: AvailabilityScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const view = data.schedules.view(slug, undefined, browserZone());
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
        () => toasts.toast({ tone: 'success', message: scheduleStrings.setDefaultDone(schedule.name) }),
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
  const tools = isFull ? <Tooltip content={scheduleStrings.limitReached}>{newButton}</Tooltip> : newButton;
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
                rows={rows}
                status={state.status === 'ready' ? 'ready' : state.status}
                onOpen={(id) => void navigate({ href: scheduleHref(slug, id) })}
                onRetry={() => view.reload()}
              />
            </PageColumn>
            {memberId !== undefined && (
              <NewScheduleDialog
                data={data}
                slug={slug}
                memberId={memberId}
                forMember={false}
                isOpen={isCreating}
                onClose={() => setCreating(false)}
                onCreated={(schedule) => {
                  setCreating(false);
                  if (schedule.id !== null) void navigate({ href: scheduleHref(slug, schedule.id) });
                }}
              />
            )}
            <DeleteScheduleDialog
              schedule={deleting}
              fallbackName={fallback?.name ?? scheduleStrings.defaultBadge}
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
  rows,
  status,
  onOpen,
  onRetry,
}: {
  readonly rows: readonly LinkRow[];
  readonly status: 'loading' | 'error' | 'ready';
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
}) {
  return (
    <LinkList
      label={scheduleStrings.schedules}
      searchLabel={scheduleStrings.schedules}
      isToolbarHidden
      rows={rows}
      onOpen={onOpen}
      status={status}
      onRetry={onRetry}
      errorTitle={scheduleStrings.schedulesFailed}
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
  const tools = <NewScheduleButton isDisabled onPress={() => undefined} />;
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" isLoading />,
        body: (
          <>
            {slot !== null && createPortal(tools, slot)}
            <PageColumn {...(slot === null ? { actions: tools } : {})}>
              <AvailabilityList rows={[]} status="loading" onOpen={() => undefined} onRetry={() => undefined} />
            </PageColumn>
          </>
        ),
      }}
    />
  );
}
