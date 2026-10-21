// Brief
// Purpose: one booking page's editor (spec 0025, 0025-experience.md, AC-623, AC-624, AC-679): its groups beside a live preview.
// Main task: change the page, the meeting, its hours and limits, and Save from the bar that appears while anything is unsaved.
// Each group's header carries a live summary of what it holds (the meeting's lengths and place, the week it books on).
// Leaves out: questions and the deal step (milestone 2), team members (milestone 3), and scrolling to a group from the preview.
import {
  isDataError,
  type BookingAvailability,
  type BookingPageSettings,
  type BookingPageView,
  type DataLayer,
} from '@crm/data';
import {
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  EditorStatus,
  Field,
  HoursEditor,
  Link,
  PreviewDeviceSwitch,
  PreviewFrame,
  PreviewLayout,
  Radio,
  RadioGroup,
  SaveBar,
  Select,
  Skeleton,
  Switch,
  TopBar,
  type SaveBarStatus,
  type PreviewDevice,
  type SelectItem,
} from '@crm/ui';
import { useCalendar } from '@crm/data/react';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { CalendarNote, readDismissed, writeDismissed } from './CalendarNote.tsx';
import { DaysOff } from './DaysOff.tsx';
import { availabilityIsValid, weekRows, weekSummary, withDay, zoneItems, zoneMatches } from './hours.ts';
import { availabilityHref, linksHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Props for the editor: the page its route loaded. */
export interface PageEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The reader's language, for the hours summary's days and clock. */
  readonly locale: string;
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
export function PageEditor({ data, slug, page: loaded, locale, myHours }: PageEditorProps) {
  const [page, setPage] = useState(loaded);
  // A page the reader can't change shows as it is, every control read only, with no Save.
  const isLocked = !page.canChange;
  const saved = settingsOf(page);
  const [draft, setDraft] = useState(saved);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const dirty = changed(saved, draft);
  const isDirty = !isLocked && Object.keys(dirty).length > 0;
  const [justSaved, setJustSaved] = useState(false);
  const change = (patch: Partial<BookingPageSettings>) => {
    setJustSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setAvailability = (availability: BookingAvailability) => change({ availability });
  const [device, setDevice] = useState<PreviewDevice>('phone');
  // The calendar note shows only to someone with no calendar connected yet (their own connections, spec 0024).
  const calendar = useCalendar(data.calendar.view(slug));
  // The route primes the list, so the note is in the first paint's layout and never pushes the cards down.
  const hasNoCalendar = calendar.status === 'ready' && calendar.connections.length === 0;
  const [isNoteDismissed, setNoteDismissed] = useState(() => readDismissed(slug));

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
        // Saved is said for the groups' save, not the Live switch's.
        if (patch.status === undefined) setJustSaved(true);
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
  // The save bar speaks for the groups' changes; the Live switch saves on its own.
  const barError = failure !== undefined && slugError === undefined ? failure.message : undefined;
  const barStatus: SaveBarStatus = !isDirty
    ? justSaved
      ? 'saved'
      : 'hidden'
    : isSaving
      ? 'saving'
      : barError === undefined
        ? 'unsaved'
        : 'error';
  const location = draft.location;
  // The live summaries in the groups' headers: what the meeting is, and the week the page books on.
  const meetingSummary = [
    draft.durations.map((minutes) => strings.minutesShort(minutes)).join(', '),
    strings.locations[location.type],
  ]
    .filter((part) => part !== '')
    .join(' · ');
  const followed = draft.hoursMode === 'mine' ? myHours : draft.availability;
  const hoursSummary = followed === undefined ? strings.followOwnerHint : weekSummary(followed, locale).join(' · ');
  // Page: who can book it.
  const pageSummary =
    page.status === 'paused' ? strings.pausedSummary : draft.isPrivate ? strings.privateSummary : strings.publicSummary;
  // Limits: what holds bookings back, or that nothing does.
  const limitParts = [
    draft.bufferBefore + draft.bufferAfter > 0 ? strings.buffersSummary(draft.bufferBefore, draft.bufferAfter) : '',
    draft.minNoticeMinutes > 0
      ? strings.noticeSummary(NOTICE.find((item) => item.id === String(draft.minNoticeMinutes))?.label ?? '')
      : '',
    strings.aheadSummary(draft.windowDays),
    draft.dailyLimit === null ? '' : strings.dailySummary(draft.dailyLimit),
  ].filter((part) => part !== '');
  const limitsSummary = limitParts.join(' · ');
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
            // The state, as the form editor shows its own; the Live switch beside it is what changes it.
            meta={
              <EditorStatus
                tone={page.status === 'live' ? 'live' : 'paused'}
                text={page.status === 'live' ? strings.statusLive : strings.statusOff}
              />
            }
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
            previewControls={<PreviewDeviceSwitch value={device} onChange={setDevice} />}
            preview={
              <PreviewFrame
                src={`/b/${page.publicKey}`}
                title={page.title}
                device={device}
                version={page.updatedAt}
                draft={{
                  title: draft.title,
                  description: draft.description,
                  durations: draft.durations,
                  location: draft.location,
                }}
              />
            }
            {...(page.status === 'paused'
              ? { previewNote: <Callout tone="info">{strings.pausedPreview}</Callout> }
              : {})}
            notices={
              <>
                {isLocked && (
                  <Callout tone="info" title={strings.readOnlyTitle}>
                    {strings.readOnlyText}
                  </Callout>
                )}
                {hasNoCalendar && !isNoteDismissed && (
                  <CalendarNote
                    slug={slug}
                    canConnect={calendar.enabled}
                    onDismiss={() => {
                      setNoteDismissed(true);
                      writeDismissed(slug);
                    }}
                  />
                )}
              </>
            }
            footer={
              <SaveBar
                status={barStatus}
                {...(barError === undefined ? {} : { error: barError })}
                {...(sendable(draft) ? {} : { blockedReason: strings.fixPage })}
                onSave={() => save(dirty)}
                onDiscard={() => {
                  setDraft(saved);
                  setFailure(undefined);
                  setJustSaved(false);
                }}
                onFocusAway={() => pageHeading(document)?.focus()}
              />
            }
          >
            <Card title={strings.page} description={pageSummary}>
              <Field
                label={strings.publicLink}
                variant="copy"
                copyLabel={strings.copyLink}
                value={publicBookingUrl(page.publicKey)}
              />
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
              <Switch
                label={strings.private}
                description={strings.privateHint}
                isSelected={draft.isPrivate}
                isReadOnly={isLocked}
                onChange={(isPrivate) => change({ isPrivate })}
              />
            </Card>
            <Card title={strings.meeting} description={meetingSummary}>
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
              <Card
                title={strings.hours}
                description={hoursSummary}
                {...(draft.hoursMode === 'mine' && myHours !== undefined
                  ? { actions: <Link href={availabilityHref(slug)}>{strings.editMyHours}</Link> }
                  : {})}
              >
                {/* A saved setting, so a RadioGroup: SegmentedControl only switches how a screen shows. */}
                <RadioGroup
                  label={strings.hours}
                  isLabelHidden
                  orientation="horizontal"
                  value={draft.hoursMode}
                  isReadOnly={isLocked}
                  onChange={(value) => {
                    if (value === 'mine' || value === 'own') change({ hoursMode: value });
                  }}
                >
                  <Radio value="mine">{strings.followMine}</Radio>
                  <Radio value="own">{strings.ownHoursMode}</Radio>
                </RadioGroup>
                {draft.hoursMode === 'own' && (
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
                      onChange={(day, ranges) => {
                        setJustSaved(false);
                        setDraft((current) => ({
                          ...current,
                          availability: withDay(current.availability, day, ranges),
                        }));
                      }}
                    />
                  </>
                )}
              </Card>
            </div>
            {draft.hoursMode === 'own' && (
              <DaysOff availability={draft.availability} isReadOnly={isLocked} onChange={setAvailability} />
            )}
            <Card title={strings.limits} description={limitsSummary}>
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
            </Card>
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
          <PreviewLayout>
            <Skeleton lines={10} />
          </PreviewLayout>
        ),
      }}
    />
  );
}
