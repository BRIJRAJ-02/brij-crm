// Brief
// Purpose: one booking page's builder (spec 0025, AC-623, AC-624, AC-631): details, availability and limits.
// Main task: change a setting and have it saved as you go (half a second after the last change), with what failed said where it happened.
// Leaves out: questions and the deal step (milestone 2), team members (milestone 3) and a live preview of the public page.
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
  Checkbox,
  CopyButton,
  DatePicker,
  Field,
  HoursEditor,
  Select,
  SettingsStack,
  Switch,
  type SelectItem,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { settingsCrumbs, SettingsPage } from '../settings/SettingsPage.tsx';
import { availabilityIsValid, overrideRows, timeZones, weekRows, withDay, withOverride } from './hours.ts';
import { bookingPagesHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Props for the builder: the page its route loaded. */
export interface BookingPageBuilderProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
}

/** How long after the last change a save goes out. */
const SAVE_AFTER_MS = 500;

const DURATIONS = [15, 30, 45, 60, 90] as const;
const LOCATIONS = ['video', 'phone', 'address', 'custom'] as const;

const minutesItems = (values: readonly number[]): SelectItem[] =>
  values.map((value) => ({ id: String(value), label: value === 0 ? strings.none : strings.minutes(value) }));
const BUFFERS = minutesItems([0, 5, 10, 15, 20, 30, 45, 60]);
const NOTICE: SelectItem[] = [
  { id: '0', label: strings.none },
  ...[15, 30].map((value) => ({ id: String(value), label: strings.minutes(value) })),
  ...[1, 2, 4, 12].map((value) => ({ id: String(value * 60), label: strings.hours(value) })),
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

type Saving =
  | { readonly state: 'idle' | 'saving' | 'saved' }
  | { readonly state: 'failed'; readonly message: string; readonly field?: string };

/** The settings the builder edits, from the page. */
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
});

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

/** The builder: three cards, saved as you go. */
export function BookingPageBuilder({ data, slug, page }: BookingPageBuilderProps) {
  const [draft, setDraft] = useState(() => settingsOf(page));
  const [saving, setSaving] = useState<Saving>({ state: 'idle' });
  const [newDate, setNewDate] = useState<string | null>(null);
  const pending = useRef<Partial<BookingPageSettings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft as the last change left it, for the save that runs later.
  const latest = useRef(draft);

  const flush = () => {
    timer.current = undefined;
    const patch = pending.current;
    if (Object.keys(patch).length === 0 || !sendable(latest.current)) return;
    pending.current = {};
    setSaving({ state: 'saving' });
    data.bookingPages.update(slug, page.id, patch).then(
      () => {
        setSaving(Object.keys(pending.current).length === 0 ? { state: 'saved' } : { state: 'saving' });
      },
      (error: unknown) => {
        // Kept to send again with the next change.
        pending.current = { ...patch, ...pending.current };
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        setSaving({
          state: 'failed',
          message: isDataError(error) ? error.message : strings.somethingWrong,
          ...(field === undefined ? {} : { field }),
        });
      },
    );
  };
  // A save still waiting goes out when the builder closes.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        flush();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on leaving
    [],
  );

  const change = (patch: Partial<BookingPageSettings>) => {
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    pending.current = { ...pending.current, ...patch };
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
  };
  const setAvailability = (availability: BookingAvailability) => change({ availability });

  const slugError = saving.state === 'failed' && saving.field === 'slug' ? saving.message : undefined;
  const location = draft.location;
  const zones = timeZones(draft.availability.timeZone).map((zone) => ({ id: zone, label: zone.replaceAll('_', ' ') }));
  return (
    <SettingsPage
      title={draft.title.trim() === '' ? strings.title : draft.title}
      crumbs={[
        ...settingsCrumbs(slug, 'objects'),
        { id: 'booking-pages', label: strings.back, href: bookingPagesHref(slug) },
      ]}
      current="booking-pages"
      meta={
        saving.state === 'saving'
          ? strings.saving
          : saving.state === 'saved'
            ? strings.saved
            : saving.state === 'failed'
              ? strings.saveFailed
              : undefined
      }
      actions={<CopyButton value={publicBookingUrl(page.publicKey)} label={strings.copyLink} />}
    >
      <SettingsStack>
        {saving.state === 'failed' && slugError === undefined && <Callout tone="danger">{saving.message}</Callout>}
        <Callout tone="info" title={strings.noCalendarTitle}>
          {strings.noCalendar}
        </Callout>
        <Card title={strings.details}>
          <Switch
            label={strings.takingBookings}
            description={strings.takingBookingsHint}
            isSelected={draft.status === 'live'}
            onChange={(isLive) => change({ status: isLive ? 'live' : 'paused' })}
          />
          <Field
            label={strings.pageTitle}
            value={draft.title}
            maxLength={120}
            isRequired
            onChange={(title) => change({ title })}
            {...(draft.title.trim() === '' ? { error: strings.titleRequired } : {})}
          />
          <Field
            label={strings.pageDescription}
            value={draft.description}
            isMultiline
            maxLength={2000}
            showCounter
            onChange={(description) => change({ description })}
          />
          <Field
            label={strings.slug}
            value={draft.slug}
            hint={strings.slugHint}
            maxLength={60}
            isRequired
            onChange={(value) => change({ slug: value.toLowerCase() })}
            {...(slugError === undefined ? {} : { error: slugError })}
          />
          <Field label={strings.publicLink} value={publicBookingUrl(page.publicKey)} isReadOnly />
        </Card>
        <Card title={strings.durations} description={strings.durationsHint}>
          {DURATIONS.map((minutes) => (
            <Checkbox
              key={minutes}
              label={strings.minutes(minutes)}
              isSelected={draft.durations.includes(minutes)}
              isDisabled={draft.durations.length === 1 && draft.durations.includes(minutes)}
              onChange={(isOn) =>
                change({
                  durations: isOn
                    ? DURATIONS.filter((each) => each === minutes || draft.durations.includes(each))
                    : draft.durations.filter((each) => each !== minutes),
                })
              }
            />
          ))}
        </Card>
        <Card title={strings.location}>
          <Select
            label={strings.location}
            isLabelHidden
            items={LOCATIONS.map((type) => ({ id: type, label: strings.locations[type] }))}
            value={location.type}
            onChange={(type) => {
              if (type === 'video' || type === 'phone') change({ location: { type } });
              if (type === 'address' || type === 'custom')
                change({ location: { type, value: 'value' in location ? location.value : '' } });
            }}
          />
          {(location.type === 'address' || location.type === 'custom') && (
            <Field
              label={location.type === 'address' ? strings.address : strings.where}
              value={location.value}
              maxLength={500}
              isRequired
              onChange={(value) => change({ location: { type: location.type, value } })}
            />
          )}
        </Card>
        <Card title={strings.availability}>
          <Select
            label={strings.timeZone}
            items={zones}
            isSearchable
            value={draft.availability.timeZone}
            onChange={(zone) => {
              if (zone !== null) setAvailability({ ...draft.availability, timeZone: zone });
            }}
          />
          <HoursEditor
            label={strings.weeklyHours}
            rows={weekRows(draft.availability)}
            onChange={(day, ranges) => setAvailability(withDay(draft.availability, day, ranges))}
          />
          <HoursEditor
            label={strings.overrides}
            rows={overrideRows(draft.availability.overrides)}
            onChange={(date, ranges) => setAvailability(withOverride(draft.availability, date, ranges))}
            onRemoveRow={(date) => setAvailability(withOverride(draft.availability, date, undefined))}
          />
          <DatePicker label={strings.overrideDate} hint={strings.overridesHint} value={newDate} onChange={setNewDate} />
          <Button
            icon="plus"
            isDisabled={newDate === null || draft.availability.overrides.some((override) => override.date === newDate)}
            onPress={() => {
              if (newDate === null) return;
              setAvailability(withOverride(draft.availability, newDate, []));
              setNewDate(null);
            }}
          >
            {strings.addOverride}
          </Button>
        </Card>
        <Card title={strings.limits}>
          <Select
            label={strings.bufferBefore}
            items={BUFFERS}
            value={String(draft.bufferBefore)}
            onChange={(id) => change({ bufferBefore: Number(id ?? 0) })}
          />
          <Select
            label={strings.bufferAfter}
            items={BUFFERS}
            value={String(draft.bufferAfter)}
            onChange={(id) => change({ bufferAfter: Number(id ?? 0) })}
          />
          <Select
            label={strings.notice}
            items={NOTICE}
            value={String(draft.minNoticeMinutes)}
            onChange={(id) => change({ minNoticeMinutes: Number(id ?? 0) })}
          />
          <Select
            label={strings.window}
            items={WINDOW}
            value={String(draft.windowDays)}
            onChange={(id) => change({ windowDays: Number(id ?? 60) })}
          />
          <Select
            label={strings.dailyLimit}
            items={DAILY}
            value={draft.dailyLimit === null ? 'none' : String(draft.dailyLimit)}
            onChange={(id) => change({ dailyLimit: id === null || id === 'none' ? null : Number(id) })}
          />
          <Select
            label={strings.step}
            items={STEPS}
            value={draft.slotStep === null ? 'duration' : String(draft.slotStep)}
            onChange={(id) => change({ slotStep: id === '15' ? 15 : id === '30' ? 30 : id === '60' ? 60 : null })}
          />
        </Card>
      </SettingsStack>
    </SettingsPage>
  );
}
