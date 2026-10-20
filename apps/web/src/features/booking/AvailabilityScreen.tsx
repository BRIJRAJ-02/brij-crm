// Brief
// Purpose: Bookings › Availability (spec 0025 experience, AC-680): the member's own weekly hours and days off, which their pages follow.
// Main task: set the week's windows (all days at once, per day, or copied across), the zone and the days off, then Save.
// Leaves out: a page's own hours (its editor) and anyone else's hours.
import { isDataError, type BookingAvailability, type BookingPageView, type DataLayer } from '@crm/data';
import { Card, HoursEditor, PageColumn, SaveBar, Select, Skeleton, TopBar, type SaveBarStatus } from '@crm/ui';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { bookingsHref } from '../workspace/objects.ts';
import { pageHeading } from '../navigation/focus.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DaysOff } from './DaysOff.tsx';
import { pageEditorHref } from './links.ts';
import { PagesHours } from './PagesHours.tsx';
import { availabilityIsValid, weekRows, withDay, zoneItems, zoneMatches } from './hours.ts';
import { strings } from './strings.ts';

/** Props for the screen: the member's hours its route loaded. */
export interface AvailabilityScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly availability: BookingAvailability;
  /** The member's own pages, listed under the week with the hours each books on. */
  readonly pages: readonly BookingPageView[];
  /** `error` when the pages didn't load: the list says so, with Try again. */
  readonly pagesStatus: 'ready' | 'error';
  readonly onRetryPages: () => void;
  readonly locale: string;
}

/** The week and the days off, saved together. */
export function AvailabilityScreen({
  data,
  slug,
  availability: loaded,
  pages,
  pagesStatus,
  onRetryPages,
  locale,
}: AvailabilityScreenProps) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(loaded);
  const [draft, setDraft] = useState(loaded);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);
  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);
  useBlocker({
    shouldBlockFn: () => isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty,
  });
  const update = (next: BookingAvailability) => {
    setDraft(next);
    setJustSaved(false);
  };
  const save = () => {
    if (isSaving) return;
    setSaving(true);
    setFailure(undefined);
    const sent = draft;
    data.bookings.setHours(slug, sent).then(
      ({ availability }) => {
        setSaving(false);
        setSaved(availability);
        // An edit made while it saved stays, still unsaved.
        setDraft((current) => (JSON.stringify(current) === JSON.stringify(sent) ? availability : current));
        setJustSaved(true);
      },
      (error: unknown) => {
        setSaving(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  const discard = () => {
    setDraft(saved);
    setFailure(undefined);
    setJustSaved(false);
  };
  const status: SaveBarStatus = isSaving
    ? 'saving'
    : isDirty
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';
  const zones = useMemo(() => zoneItems(draft.timeZone, new Date()), [draft.timeZone]);
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
                    value={draft.timeZone}
                    onChange={(zone) => {
                      if (zone !== null) update({ ...draft, timeZone: zone });
                    }}
                  />
                </Card>
                <DaysOff availability={draft} onChange={update} />
              </>
            }
            footer={
              <SaveBar
                status={status}
                {...(failure === undefined ? {} : { error: failure })}
                {...(availabilityIsValid(draft) ? {} : { blockedReason: strings.fixHours })}
                onSave={save}
                onDiscard={discard}
                // When Save or Discard goes with focus on it, the page's title takes it.
                onFocusAway={() => pageHeading(document)?.focus()}
              />
            }
          >
            <Card title={strings.weeklyHours} description={strings.availabilityText}>
              <HoursEditor
                label={strings.weeklyHours}
                rows={weekRows(draft)}
                onChange={(day, ranges) => {
                  setJustSaved(false);
                  setDraft((current) => withDay(current, day, ranges));
                }}
              />
            </Card>
            <PagesHours
              slug={slug}
              pages={pages}
              status={pagesStatus}
              onRetry={onRetryPages}
              mine={draft}
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
                <Card title={strings.timeZone} isBusy>
                  <Skeleton lines={1} />
                </Card>
                <Card title={strings.daysOff} isBusy>
                  <Skeleton lines={3} />
                </Card>
              </>
            }
          >
            <Card title={strings.weeklyHours} isBusy>
              <Skeleton lines={8} />
            </Card>
          </PageColumn>
        ),
      }}
    />
  );
}
