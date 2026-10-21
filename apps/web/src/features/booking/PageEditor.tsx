// Brief
// Purpose: one booking page's editor (spec 0025, 0025-experience.md, AC-623, AC-624, AC-679): its groups beside a live preview.
// Main task: change the page, the meeting, its hours and limits, and Save from the bar that appears while anything is unsaved.
// Each group's header carries a live summary of what it holds (the meeting's lengths and place, the week it books on).
// The hours are a schedule's (spec 0035, AC-965): the card picks one of the owner's, says its week, and links to it.
// Leaves out: questions and the deal step (milestone 2), team members (milestone 3), and scrolling to a group from the preview.
import {
  isDataError,
  type BookingPageSettings,
  type BookingPageView,
  type DataLayer,
  type SchedulesView,
} from '@crm/data';
import { useCalendar, useSchedules } from '@crm/data/react';
import {
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  EditorStatus,
  Field,
  InfoTip,
  Link,
  PreviewDeviceSwitch,
  PreviewFrame,
  PreviewLayout,
  SaveBar,
  Select,
  SettingsRow,
  SettingsRowGroup,
  Skeleton,
  Switch,
  TopBar,
  type SaveBarStatus,
  type PreviewDevice,
  type SelectItem,
} from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { calendarSettingsHref } from '../settings/nav.ts';
import { CalendarNote, readDismissed, writeDismissed } from './CalendarNote.tsx';
import { PageDestination } from './PageDestination.tsx';
import { weekSummary, zoneLabel } from './hours.ts';
import { linksHref, publicBookingUrl, scheduleHref } from './links.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the editor: the page its route loaded. */
export interface PageEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The reader's language, for the hours summary's days and clock. */
  readonly locale: string;
  /** The page owner's schedules (spec 0035), when the reader may read them: the Hours card's choices. */
  readonly schedules?: SchedulesView;
  /** The owner's id as `?member=` takes it, when the owner isn't the reader (an admin's view). */
  readonly ownerMember?: string;
}

const DURATIONS = [15, 30, 45, 60, 90] as const;
const LOCATIONS = ['video', 'address', 'phone', 'custom'] as const;

/** The help beside a setting's label, from its `strings.tips` entry. */
function tipFor(label: string, tip: { readonly text: string; readonly example: string }) {
  return (
    <InfoTip label={label} example={tip.example}>
      {tip.text}
    </InfoTip>
  );
}

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
  bufferBefore: page.bufferBefore,
  bufferAfter: page.bufferAfter,
  minNoticeMinutes: page.minNoticeMinutes,
  windowDays: page.windowDays,
  dailyLimit: page.dailyLimit,
  slotStep: page.slotStep,
  status: page.status,
  scheduleId: page.scheduleId,
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
    (draft.location.type === 'video' || draft.location.type === 'phone' || draft.location.value.trim() !== '')
  );
}

/** The editor. */
export function PageEditor({ data, slug, page: loaded, locale, schedules, ownerMember }: PageEditorProps) {
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
  const hours = useHours(schedules, draft.scheduleId, page, slug, ownerMember);
  const hoursSummary = [...weekSummary(hours.availability, locale), zoneLabel(hours.availability.timeZone)].join(' · ');
  // Page: who can book it.
  const pageSummary =
    page.status === 'paused'
      ? page.pausedReason === 'host_removed'
        ? strings.hostRemovedSummary
        : strings.pausedSummary
      : draft.isPrivate
        ? strings.privateSummary
        : strings.publicSummary;
  // Limits: what holds bookings back, or that nothing does.
  const limitParts = [
    draft.bufferBefore + draft.bufferAfter > 0 ? strings.buffersSummary(draft.bufferBefore, draft.bufferAfter) : '',
    draft.minNoticeMinutes > 0
      ? strings.noticeSummary(NOTICE.find((item) => item.id === String(draft.minNoticeMinutes))?.label ?? '')
      : '',
    strings.aheadSummary(draft.windowDays),
    draft.dailyLimit === null ? '' : strings.dailySummary(draft.dailyLimit),
    draft.slotStep === null ? '' : strings.stepSummary(draft.slotStep),
  ].filter((part) => part !== '');
  const joined = limitParts.join(' · ');
  const limitsSummary = joined.charAt(0).toUpperCase() + joined.slice(1);

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
              <PageDestination
                destination={data.calendar.pageDestination(slug, page.id)}
                calendars={data.calendar.calendars(slug)}
                isReadOnly={isLocked}
                onChange={(calendarId) => void data.calendar.setPageDestination(slug, page.id, calendarId)}
                settingsHref={calendarSettingsHref(slug)}
              />
            </Card>
            <div id="hours">
              <Card
                title={strings.hours}
                description={hoursSummary}
                {...(hours.editHref === undefined
                  ? {}
                  : { actions: <Link href={hours.editHref}>{scheduleStrings.editHours}</Link> })}
              >
                <Select
                  label={scheduleStrings.schedule}
                  info={tipFor(scheduleStrings.schedule, strings.tips.schedule)}
                  items={hours.items}
                  value={draft.scheduleId ?? 'default'}
                  isReadOnly={isLocked || hours.items.length === 0}
                  {...(hours.items.length === 0 ? { readOnlyReason: strings.followOwnerHint } : {})}
                  hint={scheduleStrings.hoursFromSchedule}
                  onChange={(id) => {
                    if (id !== null) change({ scheduleId: id === 'default' ? null : id });
                  }}
                />
              </Card>
            </div>
            <Card title={strings.limits} description={limitsSummary}>
              <SettingsRowGroup title={strings.limitGroups.buffers}>
                <SettingsRow
                  title={strings.bufferBefore}
                  meta={
                    <InfoTip label={strings.bufferBefore} example={strings.limitHelp.before.example}>
                      {strings.limitHelp.before.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.bufferBefore}
                    isLabelHidden
                    items={BUFFERS}
                    isReadOnly={isLocked}
                    value={String(draft.bufferBefore)}
                    onChange={(id) => change({ bufferBefore: Number(id ?? 0) })}
                  />
                </SettingsRow>
                <SettingsRow
                  title={strings.bufferAfter}
                  meta={
                    <InfoTip label={strings.bufferAfter} example={strings.limitHelp.after.example}>
                      {strings.limitHelp.after.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.bufferAfter}
                    isLabelHidden
                    items={BUFFERS}
                    isReadOnly={isLocked}
                    value={String(draft.bufferAfter)}
                    onChange={(id) => change({ bufferAfter: Number(id ?? 0) })}
                  />
                </SettingsRow>
              </SettingsRowGroup>
              <SettingsRowGroup title={strings.limitGroups.window}>
                <SettingsRow
                  title={strings.notice}
                  meta={
                    <InfoTip label={strings.notice} example={strings.limitHelp.notice.example}>
                      {strings.limitHelp.notice.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.notice}
                    isLabelHidden
                    items={NOTICE}
                    isReadOnly={isLocked}
                    value={String(draft.minNoticeMinutes)}
                    onChange={(id) => change({ minNoticeMinutes: Number(id ?? 0) })}
                  />
                </SettingsRow>
                <SettingsRow
                  title={strings.window}
                  meta={
                    <InfoTip label={strings.window} example={strings.limitHelp.ahead.example}>
                      {strings.limitHelp.ahead.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.window}
                    isLabelHidden
                    items={WINDOW}
                    isReadOnly={isLocked}
                    value={String(draft.windowDays)}
                    onChange={(id) => change({ windowDays: Number(id ?? 60) })}
                  />
                </SettingsRow>
              </SettingsRowGroup>
              <SettingsRowGroup title={strings.limitGroups.pace}>
                <SettingsRow
                  title={strings.dailyLimit}
                  meta={
                    <InfoTip label={strings.dailyLimit} example={strings.limitHelp.daily.example}>
                      {strings.limitHelp.daily.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.dailyLimit}
                    isLabelHidden
                    items={DAILY}
                    isReadOnly={isLocked}
                    value={draft.dailyLimit === null ? 'none' : String(draft.dailyLimit)}
                    onChange={(id) => change({ dailyLimit: id === null || id === 'none' ? null : Number(id) })}
                  />
                </SettingsRow>
                <SettingsRow
                  title={strings.step}
                  meta={
                    <InfoTip label={strings.step} example={strings.limitHelp.step.example}>
                      {strings.limitHelp.step.text}
                    </InfoTip>
                  }
                >
                  <Select
                    label={strings.step}
                    isLabelHidden
                    items={STEPS}
                    isReadOnly={isLocked}
                    value={draft.slotStep === null ? 'duration' : String(draft.slotStep)}
                    onChange={(id) =>
                      change({ slotStep: id === '15' ? 15 : id === '30' ? 30 : id === '60' ? 60 : null })
                    }
                  />
                </SettingsRow>
              </SettingsRowGroup>
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

/**
 * The Hours card's choices and what the chosen one holds (spec 0035, AC-965): "Default schedule (<name>)" first,
 * then each of the owner's stored schedules by name. A page naming a schedule that is gone books by the default, as
 * the server reads it. Until the owner's schedules load (or when they can't be read), the page's own answer stands
 * in: the hours it books by now. Edit hours opens the chosen schedule's editor.
 */
function useHours(
  view: SchedulesView | undefined,
  scheduleId: string | null,
  page: BookingPageView,
  slug: string,
  ownerMember: string | undefined,
) {
  const state = useSchedulesOrNone(view);
  if (state === undefined) {
    return { items: [], availability: page.availability, editHref: undefined } as const;
  }
  const fallback = state.find((each) => each.isDefault);
  const named = scheduleId === null ? undefined : state.find((each) => each.id === scheduleId);
  const chosen = named ?? fallback;
  // The virtual default books in each page's own zone, which the server read for a page that follows it.
  const isVirtualSaved = chosen?.id === null && page.scheduleId === null;
  return {
    items: [
      { id: 'default', label: scheduleStrings.defaultSchedule(fallback?.name) },
      ...state.flatMap((each) => (each.id === null ? [] : [{ id: each.id, label: each.name }])),
    ],
    availability: isVirtualSaved ? page.availability : (chosen?.availability ?? page.availability),
    // The owner's schedule; an admin's view of a colleague's page opens it as theirs (`?member=`).
    editHref: chosen === undefined ? undefined : scheduleHref(slug, chosen.id ?? 'default', ownerMember),
  };
}

/** The owner's schedules once read, or undefined (none read for a reader who can't read them). */
function useSchedulesOrNone(view: SchedulesView | undefined) {
  const state = useSchedules(view);
  return state.status === 'ready' ? state.schedules : undefined;
}
