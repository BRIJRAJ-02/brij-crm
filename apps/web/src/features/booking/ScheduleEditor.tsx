// Brief
// Purpose: one availability schedule (spec 0035, AC-970): its name, time zone, weekly hours, days off, and the booking pages that use it.
// Main task: change the hours, the zone, the days off or the name (Enter saves, Esc puts it back), then Save; set it as default, duplicate or delete it from the menu.
// Leaves out: which schedule a page uses (each page picks in its own editor) and a calendar view of the hours.
import { isDataError, type DataLayer, type ScheduleView } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  HoursEditor,
  InfoTip,
  Link,
  LinkList,
  PageColumn,
  SaveBar,
  Select,
  Skeleton,
  TopBar,
  type LinkRow,
} from '@crm/ui';
import { useBlocker, useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { bookingsHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DaysOff } from './DaysOff.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { weekRows, WEEKDAYS, withDay, zoneItems, zoneMatches } from './hours.ts';
import { browserZone } from './zone.ts';
import { availabilityHref, linksHref, pageEditorHref, scheduleHref } from './links.ts';
import { SCHEDULE_NAME_MAX, useScheduleDraft } from './scheduleDraft.ts';
import { ScheduleMenu } from './ScheduleMenu.tsx';
import { SCHEDULES_MAX } from './schedules.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the editor: which schedule. */
export interface ScheduleEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The schedule's id, or `default` for whichever is the default, the virtual one included. */
  readonly scheduleId: string;
  /** Whose, when they aren't the reader's: an admin editing a colleague's schedule (AC-971). */
  readonly member: string | undefined;
  /** That colleague's name, for the trail back to their schedules. */
  readonly memberName: string | undefined;
}

/**
 * The schedule from the data layer's held list, so a save in another tab shows here while nothing is being edited
 * (AC-977); or Not found when it isn't there (deleted, or not the reader's).
 */
export function ScheduleEditor({ data, slug, scheduleId, member, memberName }: ScheduleEditorProps) {
  const view = data.schedules.view(slug, member, browserZone());
  const state = useSchedules(view);
  // The id the virtual default is being stored under: the same editor stays for it as it lands.
  const [adopted, setAdopted] = useState<string | undefined>(undefined);
  if (state.status !== 'ready') return <ScheduleEditorPending />;
  const schedule = state.schedules.find((each) =>
    scheduleId === 'default'
      ? each.isDefault
      : each.id === scheduleId || (adopted !== undefined && each.id === adopted),
  );
  if (schedule === undefined) {
    return (
      <Frame slug={slug} member={member} memberName={memberName} title={scheduleStrings.schedule}>
        <PageColumn align="center">
          <EmptyState
            title={scheduleStrings.notFoundTitle}
            actions={<Link href={availabilityHref(slug, member)}>{scheduleStrings.allSchedules}</Link>}
          >
            {scheduleStrings.notFoundText}
          </EmptyState>
        </PageColumn>
      </Frame>
    );
  }
  return (
    <Loaded
      // One editor per schedule, so a draft never crosses from one to another; the virtual default keeps its
      // editor while its first save stores it under the adopted id.
      key={schedule.id === null || schedule.id === adopted ? 'virtual' : schedule.id}
      data={data}
      slug={slug}
      member={member}
      memberName={memberName}
      schedule={schedule}
      schedules={state.schedules}
      onReload={() => view.reload()}
      onAdopt={setAdopted}
    />
  );
}

/** The frame every state of the editor shares: the TopBar with the way back to Availability. */
function Frame({
  slug,
  member,
  memberName,
  title,
  meta,
  actions,
  children,
}: {
  readonly slug: string;
  readonly member: string | undefined;
  readonly memberName: string | undefined;
  readonly title: string;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <WorkspacePage
      currentPage="availability"
      page={{
        topBar: (
          <TopBar
            title={title}
            icon="clock"
            crumbs={[
              { id: 'bookings', label: strings.bookings, href: bookingsHref(slug) },
              {
                id: 'availability',
                label: memberName === undefined ? strings.availability : scheduleStrings.viewingTheirs(memberName),
                href: availabilityHref(slug, member),
              },
            ]}
            {...(meta === undefined ? {} : { meta })}
          >
            {actions}
          </TopBar>
        ),
        body: children,
      }}
    />
  );
}

function Loaded({
  data,
  slug,
  member,
  memberName,
  schedule,
  schedules,
  onReload,
  onAdopt,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly member: string | undefined;
  readonly memberName: string | undefined;
  readonly schedule: ScheduleView;
  readonly schedules: readonly ScheduleView[];
  readonly onReload: () => void;
  readonly onAdopt: (id: string) => void;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const draft = useScheduleDraft({
    data,
    slug,
    schedule,
    forMember: member !== undefined,
    reload: onReload,
    onAdopt,
    onStored: (stored) => {
      // Saved the first time: its own address from now on, the editor kept.
      if (stored.id !== null) void navigate({ href: scheduleHref(slug, stored.id, member), replace: true });
    },
  });
  useBlocker({
    shouldBlockFn: () => draft.isDirty && !isDeleting && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => draft.isDirty,
  });
  const shown = draft.shown;
  const zones = useMemo(() => zoneItems(shown.timeZone, new Date()), [shown.timeZone]);
  const fallback = schedules.find((each) => each.isDefault);
  const isFull = schedules.filter((each) => each.id !== null).length >= SCHEDULES_MAX;
  const failed = (message: string) => (error: unknown) => {
    toasts.toast({
      tone: 'danger',
      message: `${message} ${isDataError(error) ? error.message : strings.somethingWrong}`,
    });
  };
  const isStored = schedule.id !== null && schedule.updatedAt !== null;
  const menu = isStored ? (
    <ScheduleMenu
      schedule={schedule}
      isFull={isFull}
      onSetDefault={() => {
        data.schedules
          .setDefault(slug, schedule)
          .then(
            () => toasts.toast({ tone: 'success', message: scheduleStrings.setDefaultDone(schedule.name, memberName) }),
            failed(scheduleStrings.setDefaultFailed(schedule.name)),
          );
      }}
      onDuplicate={() => {
        data.schedules.duplicate(slug, schedule).then(
          (copy) => {
            toasts.toast({ tone: 'success', message: scheduleStrings.duplicated(copy.name) });
            if (copy.id !== null) void navigate({ href: scheduleHref(slug, copy.id, member) });
          },
          failed(scheduleStrings.duplicateFailed(schedule.name)),
        );
      }}
      onDelete={() => setDeleting(true)}
    />
  ) : undefined;
  const title = draft.name.trim() === '' ? schedule.name : draft.name.trim();
  return (
    <Frame
      slug={slug}
      member={member}
      memberName={memberName}
      title={title}
      {...(schedule.isDefault
        ? {
            meta: (
              <>
                <Badge text={scheduleStrings.defaultBadge} />
                <InfoTip label={scheduleStrings.defaultBadge}>{scheduleStrings.defaultHelp}</InfoTip>
              </>
            ),
          }
        : {})}
      {...(menu === undefined ? {} : { actions: menu })}
    >
      <PageColumn
        // On a phone the name and the zone come first: the week below reads in that zone.
        stack="aside-first"
        aside={
          <>
            <Card title={scheduleStrings.name}>
              <Field
                label={scheduleStrings.name}
                isLabelHidden
                value={draft.name}
                maxLength={SCHEDULE_NAME_MAX}
                isRequired
                hint={scheduleStrings.nameHint}
                onChange={draft.rename}
                // Enter saves it (with the hours, as one change); Esc puts the saved name back.
                onSubmit={draft.save}
                onEscape={() => draft.rename(schedule.name)}
                {...(draft.nameError === undefined ? {} : { error: draft.nameError })}
              />
            </Card>
            <Card title={strings.timeZone} description={strings.timeZoneText}>
              <Select
                label={strings.timeZone}
                isLabelHidden
                showsDescription
                items={zones}
                filter={zoneMatches}
                isSearchable
                value={shown.timeZone}
                onChange={(zone) => {
                  if (zone !== null) draft.change((current) => ({ ...current, timeZone: zone }));
                }}
              />
            </Card>
            <DaysOff availability={shown} onChange={(next) => draft.change(() => next)} />
          </>
        }
        footer={
          <SaveBar
            status={draft.status}
            {...(draft.error === undefined ? {} : { error: draft.error })}
            {...(draft.blockedReason === undefined ? {} : { blockedReason: draft.blockedReason })}
            onSave={draft.save}
            onDiscard={draft.discard}
            // When Save or Discard goes with focus on it, the page's title takes it.
            onFocusAway={() => pageHeading(document)?.focus()}
          />
        }
      >
        <Card title={strings.weeklyHours} description={scheduleStrings.weeklyHoursText}>
          <HoursEditor
            label={strings.weeklyHours}
            rows={weekRows(shown)}
            onChange={(day, ranges) => {
              draft.change((current) => withDay(current, day, ranges));
            }}
          />
        </Card>
        <UsedBy
          slug={slug}
          schedule={schedule}
          onOpen={(pageId) => void navigate({ href: pageEditorHref(slug, pageId) })}
        />
      </PageColumn>
      <DeleteScheduleDialog
        schedule={isDeleting ? schedule : undefined}
        fallbackName={fallback?.name ?? scheduleStrings.defaultBadge}
        isOwn={member === undefined}
        onClose={() => setDeleting(false)}
        onDelete={(gone) => data.schedules.remove(slug, gone)}
        onDeleted={(gone) => {
          toasts.toast({ tone: 'success', message: scheduleStrings.deleted(gone.name) });
          void navigate({ href: availabilityHref(slug, member) });
        }}
      />
    </Frame>
  );
}

/** The booking pages that book by the schedule, each opening its editor; none says how a page picks one. */
function UsedBy({
  slug,
  schedule,
  onOpen,
}: {
  readonly slug: string;
  readonly schedule: ScheduleView;
  readonly onOpen: (pageId: string) => void;
}) {
  if (schedule.pages.length === 0) {
    return (
      <Card title={scheduleStrings.usedByLabel} description={scheduleStrings.noPagesUseIt}>
        <Link href={linksHref(slug)}>{scheduleStrings.goToPages}</Link>
      </Card>
    );
  }
  const rows: readonly LinkRow[] = schedule.pages.map((page) => ({
    id: page.id,
    title: page.title,
    address: '',
    chips: [],
    href: pageEditorHref(slug, page.id),
  }));
  return (
    <Card
      title={scheduleStrings.usedByLabel}
      description={schedule.isDefault ? scheduleStrings.usedByDefaultText : scheduleStrings.usedByText}
    >
      <LinkList
        density="compact"
        placement="card"
        label={scheduleStrings.usedByLabel}
        searchLabel={scheduleStrings.usedByLabel}
        isToolbarHidden
        rows={rows}
        onOpen={onOpen}
      />
    </Card>
  );
}

/** The editor while its schedules load: its cards in their places, so the page lands where the skeleton was. */
export function ScheduleEditorPending() {
  return (
    <WorkspacePage
      currentPage="availability"
      page={{
        topBar: <TopBar title={scheduleStrings.schedule} icon="clock" isLoading />,
        body: (
          <PageColumn
            stack="aside-first"
            aside={
              <>
                <Card title={scheduleStrings.name} isBusy>
                  <Skeleton lines={1} />
                </Card>
                <Card title={strings.timeZone} description={strings.timeZoneText} isBusy>
                  <Skeleton lines={1} />
                </Card>
                <Card title={strings.daysOff} description={strings.daysOffText} isBusy>
                  <Skeleton lines={3} />
                </Card>
              </>
            }
          >
            <Card title={strings.weeklyHours} description={scheduleStrings.weeklyHoursText} isBusy>
              <HoursEditor
                label={strings.weeklyHours}
                rows={WEEKDAYS.map((day) => ({ id: day, label: strings.weekday[day], ranges: [] }))}
                onChange={() => undefined}
                isLoading
              />
            </Card>
            <Card title={scheduleStrings.usedByLabel} isBusy>
              <Skeleton lines={2} />
            </Card>
          </PageColumn>
        ),
      }}
    />
  );
}
