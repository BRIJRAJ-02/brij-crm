// Brief
// Purpose: Bookings › Availability (spec 0025 experience, AC-680; spec 0035): the member's default schedule, its weekly hours, zone and days off, which every page following the default books by.
// Main task: set the week's windows (all days at once, per day, or copied across), the zone and the days off, then Save.
// Leaves out: the member's other schedules (their list and editor are milestone 2), a page's choice of schedule (its editor) and anyone else's hours.
import type { BookingPageView, DataLayer, ScheduleView } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import { Card, HoursEditor, LinkList, PageColumn, SaveBar, Select, Skeleton, TopBar } from '@crm/ui';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { bookingsHref } from '../workspace/objects.ts';
import { pageHeading } from '../navigation/focus.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DaysOff } from './DaysOff.tsx';
import { pageEditorHref } from './links.ts';
import { PagesHours } from './PagesHours.tsx';
import { browserZone, weekRows, WEEKDAYS, withDay, zoneItems, zoneMatches } from './hours.ts';
import { useScheduleDraft } from './scheduleDraft.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the screen: the member's pages its route loaded; the schedules come from the data layer. */
export interface AvailabilityScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The member's own pages, listed under the week with the hours each books on. */
  readonly pages: readonly BookingPageView[];
  /** `error` when the pages didn't load: the list says so, with Try again. */
  readonly pagesStatus: 'ready' | 'error';
  readonly onRetryPages: () => void;
  readonly locale: string;
}

/**
 * The member's default schedule (spec 0035), read from the data layer's held list, so a save in another tab shows
 * here while nothing is being edited (AC-977). Until they save any hours it is the virtual default, weekdays 9 to 5
 * in the browser's zone, stored the first time they save (AC-963).
 */
export function AvailabilityScreen(props: AvailabilityScreenProps) {
  const { data, slug } = props;
  const view = data.schedules.view(slug, undefined, browserZone());
  const state = useSchedules(view);
  // The id the virtual default is being stored under: the same editor stays for it as it lands.
  const [adopted, setAdopted] = useState<string | undefined>(undefined);
  const schedule = state.status === 'ready' ? state.schedules.find((each) => each.isDefault) : undefined;
  if (state.status !== 'ready' || schedule === undefined) return <AvailabilityPending />;
  // One editor per schedule, so a draft never crosses from one to another should the default move elsewhere.
  return (
    <Loaded
      key={schedule.id === null || schedule.id === adopted ? 'virtual' : schedule.id}
      {...props}
      schedule={schedule}
      schedules={state.schedules}
      onReload={() => view.reload()}
      onAdopt={setAdopted}
    />
  );
}

/** The week and the days off, saved together. */
function Loaded({
  data,
  slug,
  pages,
  pagesStatus,
  onRetryPages,
  locale,
  schedule,
  schedules,
  onReload,
  onAdopt,
}: AvailabilityScreenProps & {
  readonly schedule: ScheduleView;
  readonly schedules: readonly ScheduleView[];
  readonly onReload: () => void;
  readonly onAdopt: (id: string) => void;
}) {
  const navigate = useNavigate();
  const draft = useScheduleDraft({ data, slug, schedule, forMember: false, reload: onReload, onAdopt });
  useBlocker({
    shouldBlockFn: () => draft.isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => draft.isDirty,
  });
  const shown = draft.shown;
  const zones = useMemo(() => zoneItems(shown.timeZone, new Date()), [shown.timeZone]);
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: (
          <TopBar
            title={strings.availability}
            icon="clock"
            crumbs={[{ id: 'bookings', label: strings.bookings, href: bookingsHref(slug) }]}
          />
        ),
        body: (
          <PageColumn
            // On a phone the time zone comes first: the week below reads in it.
            stack="aside-first"
            aside={
              <>
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
                {...(draft.isValid ? {} : { blockedReason: strings.fixHours })}
                onSave={draft.save}
                onDiscard={draft.discard}
                // When Save or Discard goes with focus on it, the page's title takes it.
                onFocusAway={() => pageHeading(document)?.focus()}
              />
            }
          >
            <Card title={strings.weeklyHours} description={scheduleStrings.defaultHoursText}>
              <HoursEditor
                label={strings.weeklyHours}
                rows={weekRows(shown)}
                onChange={(day, ranges) => {
                  draft.change((current) => withDay(current, day, ranges));
                }}
              />
            </Card>
            <PagesHours
              slug={slug}
              pages={pages}
              status={pagesStatus}
              onRetry={onRetryPages}
              mine={shown}
              schedules={schedules}
              locale={locale}
              onOpen={(pageId) => void navigate({ href: pageEditorHref(slug, pageId) })}
            />
          </PageColumn>
        ),
      }}
    />
  );
}

/** The screen while the hours load. */
export function AvailabilityPending() {
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" isLoading />,
        body: (
          // The cards the page will show, each holding its place, so the page lands where the skeleton was.
          <PageColumn
            stack="aside-first"
            aside={
              <>
                <Card title={strings.timeZone} description={strings.timeZoneText} isBusy>
                  <Skeleton lines={1} />
                </Card>
                <Card title={strings.daysOff} description={strings.daysOffText} isBusy>
                  <Skeleton lines={3} />
                </Card>
              </>
            }
          >
            <Card title={strings.weeklyHours} description={scheduleStrings.defaultHoursText} isBusy>
              <HoursEditor
                label={strings.weeklyHours}
                rows={WEEKDAYS.map((day) => ({ id: day, label: strings.weekday[day], ranges: [] }))}
                onChange={() => undefined}
                isLoading
              />
            </Card>
            <Card title={strings.yourPages} description={strings.yourPagesText} isBusy>
              <LinkList
                density="compact"
                placement="card"
                label={strings.yourPages}
                rows={[]}
                onOpen={() => undefined}
                searchLabel={strings.yourPages}
                isToolbarHidden
                status="loading"
              />
            </Card>
          </PageColumn>
        ),
      }}
    />
  );
}
