// Brief
// Purpose: one booking page's editor (spec 0025, 0025-experience.md, AC-623, AC-624, AC-679): its groups beside a live preview.
// Main task: change the page, the meeting, its hours and limits, and Save from the bar that appears while anything is unsaved.
// Leaves out: questions and the deal step (milestone 2), team members (milestone 3), and scrolling to a group from the preview.
import {
  isDataError,
  type BookingAvailability,
  type BookingPageSettings,
  type BookingPageView,
  type DataLayer,
} from '@crm/data';
import {
  Button,
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  Disclosure,
  Field,
  HoursEditor,
  Link,
  PageColumn,
  PreviewLayout,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  TopBar,
  type SelectItem,
} from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DaysOff } from './DaysOff.tsx';
import { availabilityIsValid, weekRows, withDay, zoneItems, zoneMatches } from './hours.ts';
import { availabilityHref, linksHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Props for the editor: the page its route loaded. */
export interface PageEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The reader's own hours, on their own page: what "Follow my hours" follows. */
  readonly myHours?: BookingAvailability;
}

const DURATIONS = [15, 30, 45, 60, 90] as const;
const LOCATIONS = ['video', 'address', 'phone', 'custom'] as const;

const minutesItems = (values: readonly number[]): SelectItem[] =>
  values.map((value) => ({ id: String(value), label: value === 0 ? strings.none : strings.minutes(value) }));
const BUFFERS = minutesItems([0, 5, 10, 15, 20, 30, 45, 60]);
const NOTICE: SelectItem[] = [
  { id: '0', label: strings.none },
  ...[15, 30].map((value) => ({ id: String(value), label: strings.minutes(value) })),
  ...[1, 2, 4, 12].map((value) => ({ id: String(value * 60), label: strings.hoursCount(value) })),
  ...[1, 2, 3, 7, 14].map((value) => ({ id: String(value * 1440), label: strings.days(value) })),
];
const WINDOW: SelectItem[] = [7, 14, 30, 60, 90, 180, 365].map((value) => ({
  id: String(value),
  label: strings.days(value),
}));
const DAILY: SelectItem[] = [
  { id: 'none', label: strings.noLimit },
  ...[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((value) => ({ id: String(value), label: String(value) })),
];
const STEPS: SelectItem[] = [
  { id: 'duration', label: strings.stepDuration },
  ...[15, 30, 60].map((value) => ({ id: String(value), label: strings.minutes(value) })),
];

/** The settings the editor edits, from the page. */
const settingsOf = (page: BookingPageView): BookingPageSettings => ({
  title: page.title,
  description: page.description,
  slug: page.slug,
  durations: page.durations,
  location: page.location,
  availability: page.availability,
  bufferBefore: page.bufferBefore,
  bufferAfter: page.bufferAfter,
  minNoticeMinutes: page.minNoticeMinutes,
  windowDays: page.windowDays,
  dailyLimit: page.dailyLimit,
  slotStep: page.slotStep,
  status: page.status,
  hoursMode: page.hoursMode,
  isPrivate: page.isPrivate,
});

/** The settings that differ between two drafts. */
function changed(saved: BookingPageSettings, draft: BookingPageSettings): Partial<BookingPageSettings> {
  const keys = Object.keys(draft) as (keyof BookingPageSettings)[];
  const entries = keys
    .filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))
    .map((key) => [key, draft[key]]);
  return Object.fromEntries(entries) as Partial<BookingPageSettings>;
}

/** Whether a draft is fine to send: the server would refuse it otherwise. */
function sendable(draft: BookingPageSettings): boolean {
  return (
    draft.title.trim() !== '' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) &&
    draft.durations.length > 0 &&
    (draft.location.type === 'video' || draft.location.type === 'phone' || draft.location.value.trim() !== '') &&
    availabilityIsValid(draft.availability)
  );
}

/** The editor. */
export function PageEditor({ data, slug, page: loaded, myHours }: PageEditorProps) {
  const [page, setPage] = useState(loaded);
  // A page the reader can't change shows as it is, every control read only, with no Save.
  const isLocked = !page.canChange;
  const saved = settingsOf(page);
  const [draft, setDraft] = useState(saved);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const dirty = changed(saved, draft);
  const isDirty = !isLocked && Object.keys(dirty).length > 0;
  const change = (patch: Partial<BookingPageSettings>) => setDraft((current) => ({ ...current, ...patch }));
  const setAvailability = (availability: BookingAvailability) => change({ availability });

  // Leaving with unsaved changes asks first, in the app and when the tab closes.
  useBlocker({
    shouldBlockFn: () => isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty,
  });
  // Arriving at #hours (the list's Hours) scrolls to that group.
  useEffect(() => {
    if (globalThis.location.hash === '#hours') globalThis.document.getElementById('hours')?.scrollIntoView();
  }, []);

  const save = (patch: Partial<BookingPageSettings>) => {
    if (isSaving || Object.keys(patch).length === 0) return;
    setSaving(true);
    setFailure(undefined);
    data.bookingPages.update(slug, page.id, patch).then(
      (next) => {
        setSaving(false);
        setPage(next);
        setDraft((current) => ({ ...settingsOf(next), ...changed(settingsOf(next), current) }));
      },
      (error: unknown) => {
        setSaving(false);
        if (patch.status !== undefined) setDraft((current) => ({ ...current, status: page.status }));
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        setFailure({
          message: isDataError(error) ? error.message : strings.somethingWrong,
          ...(field === undefined ? {} : { field }),
        });
      },
    );
  };
  const slugError = failure?.field === 'slug' ? failure.message : undefined;
  const location = draft.location;
  const zones = useMemo(() => zoneItems(draft.availability.timeZone, new Date()), [draft.availability.timeZone]);

  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: (
          <TopBar
            title={draft.title.trim() === '' ? strings.listLabel : draft.title}
            icon="link"
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
          >
            <Switch
              label={strings.live}
              isSelected={page.status === 'live'}
              isDisabled={isSaving}
              isReadOnly={isLocked}
              onChange={(isLive) => {
                // The switch saves at once, apart from the other groups.
                const status = isLive ? 'live' : 'paused';
                change({ status });
                save({ status });
              }}
            />
            <CopyButton value={publicBookingUrl(page.publicKey)} label={strings.copyLink} />
          </TopBar>
        ),
        body: (
          <PreviewLayout
            previewSrc={`/b/${page.publicKey}`}
            previewTitle={page.title}
            previewVersion={page.updatedAt}
            {...(page.status === 'paused'
              ? { previewNote: <Callout tone="info">{strings.pausedPreview}</Callout> }
              : {})}
            previewDraft={{
              title: draft.title,
              description: draft.description,
              durations: draft.durations,
              location: draft.location,
            }}
            {...(isDirty
              ? {
                  footer: (
                    <Callout
                      tone={failure !== undefined && slugError === undefined ? 'danger' : 'info'}
                      actions={
                        <Button
                          variant="primary"
                          isPending={isSaving}
                          isDisabled={!sendable(draft)}
                          onPress={() => save(dirty)}
                        >
                          {isSaving ? strings.saving : strings.save}
                        </Button>
                      }
                    >
                      {failure !== undefined && slugError === undefined ? failure.message : strings.unsaved}
                    </Callout>
                  ),
                }
              : {})}
          >
            {isLocked && (
              <Callout tone="info" title={strings.readOnlyTitle}>
                {strings.readOnlyText}
              </Callout>
            )}
            <Callout tone="info" title={strings.noCalendarTitle}>
              {strings.noCalendar}
            </Callout>
            <Card title={strings.page}>
              <Field
                label={strings.description}
                value={draft.description}
                isMultiline
                maxLength={2000}
                showCounter
                isReadOnly={isLocked}
                onChange={(description) => change({ description })}
              />
              <Field
                label={strings.address}
                value={draft.slug}
                hint={strings.addressHint}
                maxLength={60}
                isRequired
                isReadOnly={isLocked}
                onChange={(value) => change({ slug: value.toLowerCase() })}
                {...(slugError === undefined ? {} : { error: slugError })}
              />
              <Field label={strings.publicLink} value={publicBookingUrl(page.publicKey)} isReadOnly />
            </Card>
            <Card title={strings.meeting}>
              <Field
                label={strings.title}
                value={draft.title}
                maxLength={120}
                isRequired
                isReadOnly={isLocked}
                onChange={(title) => change({ title })}
                {...(draft.title.trim() === '' ? { error: strings.titleRequired } : {})}
              />
              <ChoiceChips
                label={strings.durations}
                choices={DURATIONS.map((minutes) => ({ id: String(minutes), label: strings.minutesShort(minutes) }))}
                selected={draft.durations.map(String)}
                isDisabled={isLocked}
                onChange={(ids) => change({ durations: DURATIONS.filter((minutes) => ids.includes(String(minutes))) })}
                {...(draft.durations.length === 0 ? { error: strings.durationRequired } : {})}
              />
              <Select
                label={strings.location}
                items={LOCATIONS.map((type) => ({ id: type, label: strings.locations[type] }))}
                value={location.type}
                isReadOnly={isLocked}
                onChange={(type) => {
                  if (type === 'video' || type === 'phone') change({ location: { type } });
                  if (type === 'address' || type === 'custom')
                    change({ location: { type, value: 'value' in location ? location.value : '' } });
                }}
              />
              {(location.type === 'address' || location.type === 'custom') && (
                <Field
                  label={location.type === 'address' ? strings.addressOrRoom : strings.where}
                  value={location.value}
                  maxLength={500}
                  isRequired
                  isReadOnly={isLocked}
                  {...(location.value.trim() === '' ? { error: strings.whereRequired } : {})}
                  onChange={(value) => change({ location: { type: location.type, value } })}
                />
              )}
            </Card>
            <div id="hours">
              <Card title={strings.hours}>
                <SegmentedControl
                  label={strings.hours}
                  segments={[
                    { value: 'mine', label: strings.followMine },
                    { value: 'own', label: strings.ownHoursMode },
                  ]}
                  value={draft.hoursMode}
                  isDisabled={isLocked}
                  onChange={(value) => {
                    if (value === 'mine' || value === 'own') change({ hoursMode: value });
                  }}
                />
                {draft.hoursMode === 'mine' ? (
                  myHours === undefined ? (
                    <Callout tone="info">{strings.followOwnerHint}</Callout>
                  ) : (
                    <>
                      <Callout tone="info" actions={<Link href={availabilityHref(slug)}>{strings.editMyHours}</Link>}>
                        {strings.followHint}
                      </Callout>
                      <HoursEditor
                        label={strings.weeklyHours}
                        rows={weekRows(myHours)}
                        isReadOnly
                        onChange={() => undefined}
                      />
                    </>
                  )
                ) : (
                  <>
                    <Select
                      label={strings.timeZone}
                      items={zones}
                      filter={zoneMatches}
                      isSearchable
                      isReadOnly={isLocked}
                      value={draft.availability.timeZone}
                      onChange={(zone) => {
                        if (zone !== null) setAvailability({ ...draft.availability, timeZone: zone });
                      }}
                    />
                    <HoursEditor
                      label={strings.weeklyHours}
                      rows={weekRows(draft.availability)}
                      isReadOnly={isLocked}
                      onChange={(day, ranges) =>
                        setDraft((current) => ({
                          ...current,
                          availability: withDay(current.availability, day, ranges),
                        }))
                      }
                    />
                  </>
                )}
              </Card>
            </div>
            {draft.hoursMode === 'own' && (
              <DaysOff availability={draft.availability} isReadOnly={isLocked} onChange={setAvailability} />
            )}
            <Disclosure title={strings.limits}>
              <Select
                label={strings.bufferBefore}
                items={BUFFERS}
                isReadOnly={isLocked}
                value={String(draft.bufferBefore)}
                onChange={(id) => change({ bufferBefore: Number(id ?? 0) })}
              />
              <Select
                label={strings.bufferAfter}
                items={BUFFERS}
                isReadOnly={isLocked}
                value={String(draft.bufferAfter)}
                onChange={(id) => change({ bufferAfter: Number(id ?? 0) })}
              />
              <Select
                label={strings.notice}
                items={NOTICE}
                isReadOnly={isLocked}
                value={String(draft.minNoticeMinutes)}
                onChange={(id) => change({ minNoticeMinutes: Number(id ?? 0) })}
              />
              <Select
                label={strings.window}
                items={WINDOW}
                isReadOnly={isLocked}
                value={String(draft.windowDays)}
                onChange={(id) => change({ windowDays: Number(id ?? 60) })}
              />
              <Select
                label={strings.dailyLimit}
                items={DAILY}
                isReadOnly={isLocked}
                value={draft.dailyLimit === null ? 'none' : String(draft.dailyLimit)}
                onChange={(id) => change({ dailyLimit: id === null || id === 'none' ? null : Number(id) })}
              />
              <Select
                label={strings.step}
                items={STEPS}
                isReadOnly={isLocked}
                value={draft.slotStep === null ? 'duration' : String(draft.slotStep)}
                onChange={(id) => change({ slotStep: id === '15' ? 15 : id === '30' ? 30 : id === '60' ? 60 : null })}
              />
              <Switch
                label={strings.private}
                description={strings.privateHint}
                isSelected={draft.isPrivate}
                isReadOnly={isLocked}
                onChange={(isPrivate) => change({ isPrivate })}
              />
            </Disclosure>
          </PreviewLayout>
        ),
      }}
    />
  );
}

/** The editor while its page loads. */
export function PageEditorPending() {
  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: <TopBar title={strings.listLabel} icon="link" isLoading />,
        body: (
          <PageColumn>
            <Skeleton lines={10} />
          </PageColumn>
        ),
      }}
    />
  );
}
