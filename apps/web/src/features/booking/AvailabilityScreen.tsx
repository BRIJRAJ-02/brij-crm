// Brief
// Purpose: Bookings › Availability (spec 0025 experience, AC-680): the member's own weekly hours and days off, which their pages follow.
// Main task: set the week's windows (all days at once, per day, or copied across) and the days off, then Save.
// Leaves out: a page's own hours (its editor) and anyone else's hours.
import { isDataError, type BookingAvailability, type DataLayer } from '@crm/data';
import { Button, Callout, Card, HoursEditor, PageColumn, Select, Skeleton, TopBar } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DaysOff } from './DaysOff.tsx';
import { availabilityIsValid, timeZones, weekRows, withDay } from './hours.ts';
import { strings } from './strings.ts';

/** Props for the screen: the member's hours its route loaded. */
export interface AvailabilityScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly availability: BookingAvailability;
}

/** The week and the days off, saved together. */
export function AvailabilityScreen({ data, slug, availability: loaded }: AvailabilityScreenProps) {
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
    data.bookings.setHours(slug, draft).then(
      ({ availability }) => {
        setSaving(false);
        setSaved(availability);
        setDraft(availability);
        setJustSaved(true);
      },
      (error: unknown) => {
        setSaving(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  const zones = timeZones(draft.timeZone).map((zone) => ({ id: zone, label: zone.replaceAll('_', ' ') }));
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar title={strings.availability} icon="clock" crumbs={[{ id: 'bookings', label: strings.bookings }]} />
        ),
        body: (
          <PageColumn
            footer={
              isDirty || justSaved ? (
                <Callout
                  tone={failure !== undefined ? 'danger' : isDirty ? 'info' : 'success'}
                  isAnnounced={!isDirty}
                  {...(isDirty
                    ? {
                        actions: (
                          <Button
                            variant="primary"
                            isPending={isSaving}
                            isDisabled={!availabilityIsValid(draft)}
                            onPress={save}
                          >
                            {isSaving ? strings.saving : strings.save}
                          </Button>
                        ),
                      }
                    : {})}
                >
                  {failure ?? (isDirty ? strings.unsaved : strings.saved)}
                </Callout>
              ) : undefined
            }
          >
            <Card title={strings.weeklyHours} description={strings.availabilityText}>
              <Select
                label={strings.timeZone}
                items={zones}
                isSearchable
                value={draft.timeZone}
                onChange={(zone) => {
                  if (zone !== null) update({ ...draft, timeZone: zone });
                }}
              />
              <HoursEditor
                label={strings.weeklyHours}
                rows={weekRows(draft)}
                onChange={(day, ranges) => {
                  setJustSaved(false);
                  setDraft((current) => withDay(current, day, ranges));
                }}
              />
            </Card>
            <DaysOff availability={draft} onChange={update} />
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
      page={{
        topBar: <TopBar title={strings.availability} icon="clock" isLoading />,
        body: (
          <PageColumn>
            <Skeleton lines={8} />
          </PageColumn>
        ),
      }}
    />
  );
}
