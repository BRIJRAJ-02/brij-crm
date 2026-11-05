// Brief
// Purpose: set up table reservations for a place and publish its page (spec 0066 B7 lite; spec 0068's foolproof rule).
// Main task: walk the checklist (hours, tables, rules), Publish, then share timefix.com/r/<key>; the rules are
//   checklabs' "Online booking" sheet in its order and with its defaults (Accept online bookings, time zone, service
//   hours, slot interval and turn time, min lead and booking window, min and max party, max covers per slot), then
//   ours: turn time by party size and the change and cancel cutoffs.
// Leaves out: deposits, areas offered to guests and request only parties (later). Publish refuses a broken page and
//   says the one thing to fix, with the link to it.
import type { BusinessView, HospitalityStore, Place, TableRules, TableSetupView, TablesStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  CopyButton,
  DescriptionList,
  EmptyState,
  Field,
  FieldGroup,
  FormRow,
  PageColumn,
  Select,
  SetupChecklist,
  Modal,
  Skeleton,
  Switch,
  TopBar,
  TruncatedText,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
import { WEEK_DAYS } from '@crm/data/hospitality';
import { clockLabel } from '../hospitality/hours-rows.ts';
import { zoneDisplay } from '../../public/booking/time.ts';
import { publicBookingOrigin } from '../booking/links.ts';
import { businessSettingsHref, placeTablesHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** The page's address for a place's key, on the public origin (timefix.com), never the app's. */
export const reservePageUrl = (publicKey: string) => `${publicBookingOrigin()}/r/${publicKey}`;

/** A rules form: every number as typed. */
type Draft = Readonly<
  Record<
    | 'minutes'
    | 'hold3'
    | 'hold5'
    | 'hold7'
    | 'partyMin'
    | 'partyMax'
    | 'step'
    | 'notice'
    | 'window'
    | 'covers'
    | 'change'
    | 'cancel',
    string
  >
>;

/** The form's fields in reading order: the first one with a problem takes focus. */
const DRAFT_ORDER: Readonly<Record<keyof Draft, true>> = {
  step: true,
  minutes: true,
  notice: true,
  window: true,
  partyMin: true,
  partyMax: true,
  covers: true,
  hold3: true,
  hold5: true,
  hold7: true,
  change: true,
  cancel: true,
};

const draftOf = (rules: TableRules): Draft => {
  const hold = (size: number) => String(rules.holds.find((row) => row.size === size)?.minutes ?? '');
  return {
    minutes: String(rules.minutes),
    hold3: hold(3),
    hold5: hold(5),
    hold7: hold(7),
    partyMin: String(rules.partyMin),
    partyMax: String(rules.partyMax),
    step: String(rules.stepMinutes),
    notice: String(rules.noticeMinutes),
    window: String(rules.windowDays),
    covers: rules.coversCap === undefined ? '' : String(rules.coversCap),
    change: String(rules.changeCutoffMinutes),
    cancel: String(rules.cancelCutoffMinutes),
  };
};

/** A number as typed: a whole one (or one with decimals) at least `min`, or the line saying what to give. */
const numberOf = (
  text: string,
  options: { readonly min: number; readonly decimals?: boolean; readonly optional?: boolean },
): { readonly value?: number; readonly error?: string } => {
  const typed = text.trim();
  if (typed === '') return options.optional === true ? {} : { error: strings.numberRequired };
  const value = Number(typed);
  if (!Number.isFinite(value)) return { error: strings.numberRequired };
  if (options.decimals !== true && !Number.isInteger(value)) return { error: strings.wholeNumber };
  if (value < options.min) return { error: strings.atLeast(options.min) };
  return { value };
};

/** The rules from the form, or each field's problem: nothing is ever quietly defaulted. */
const rulesOf = (
  draft: Draft,
  base: TableRules,
): { readonly rules: TableRules } | { readonly errors: Readonly<Partial<Record<keyof Draft, string>>> } => {
  const read = {
    minutes: numberOf(draft.minutes, { min: 15 }),
    hold3: numberOf(draft.hold3, { min: 15, optional: true }),
    hold5: numberOf(draft.hold5, { min: 15, optional: true }),
    hold7: numberOf(draft.hold7, { min: 15, optional: true }),
    partyMin: numberOf(draft.partyMin, { min: 1 }),
    partyMax: numberOf(draft.partyMax, { min: 1 }),
    step: numberOf(draft.step, { min: 5 }),
    notice: numberOf(draft.notice, { min: 0 }),
    window: numberOf(draft.window, { min: 1 }),
    covers: numberOf(draft.covers, { min: 1, optional: true }),
    change: numberOf(draft.change, { min: 0 }),
    cancel: numberOf(draft.cancel, { min: 0 }),
  } satisfies Record<keyof Draft, { readonly value?: number; readonly error?: string }>;
  const errors: Partial<Record<keyof Draft, string>> = Object.fromEntries(
    Object.entries(read).flatMap(([key, each]) => (each.error === undefined ? [] : [[key, each.error]])),
  );
  const min = read.partyMin.value;
  const max = read.partyMax.value;
  if (min !== undefined && max !== undefined && max < min) errors.partyMax = strings.partyMaxBelow;
  if (Object.keys(errors).length > 0) return { errors };
  const at = (key: keyof Draft) => read[key].value ?? 0;
  const holds = [
    { size: 3, minutes: read.hold3.value },
    { size: 5, minutes: read.hold5.value },
    { size: 7, minutes: read.hold7.value },
  ].flatMap((row) => (row.minutes === undefined ? [] : [{ size: row.size, minutes: row.minutes }]));
  return {
    rules: {
      minutes: at('minutes'),
      holds,
      partyMin: at('partyMin'),
      partyMax: at('partyMax'),
      stepMinutes: at('step'),
      noticeMinutes: at('notice'),
      windowDays: at('window'),
      ...(read.covers.value === undefined ? {} : { coversCap: read.covers.value }),
      changeCutoffMinutes: at('change'),
      cancelCutoffMinutes: at('cancel'),
      online: base.online,
    },
  };
};

/** The page: the place's checklist, its rules, Publish and the link. */
export function ReservationsScreen({
  slug,
  tables,
  hospitality,
  toasts,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly hospitality: HospitalityStore;
  readonly toasts: Toasts;
}) {
  const held = hospitality.business(slug);
  const business = useHospitality(held);
  const [placeId, setPlaceId] = useState<string | undefined>();
  const topBar = <TopBar title={strings.reservations} icon="calendar-check" />;
  if (business.status === 'loading')
    return <WorkspacePage currentPage="reservations" page={{ topBar, body: <Skeleton shape="block" /> }} />;
  if (business.status === 'error') {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{
          topBar,
          body: <EmptyState icon="circle-alert" title={business.error.message} onRetry={held.retry} />,
        }}
      />
    );
  }
  const places = business.value.places;
  const place = places.find((each) => each.id === placeId) ?? places[0];
  if (place === undefined) {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{
          topBar,
          body: (
            <EmptyState
              icon="store"
              title={strings.noPlace}
              actions={
                <ButtonLink href={businessSettingsHref(slug)} variant="primary" icon="store">
                  {strings.addPlace}
                </ButtonLink>
              }
            />
          ),
        }}
      />
    );
  }
  return (
    <PlaceSetup
      key={place.id}
      slug={slug}
      tables={tables}
      business={business.value}
      place={place}
      onPlace={setPlaceId}
      toasts={toasts}
    />
  );
}

function PlaceSetup({
  slug,
  tables,
  business,
  place,
  onPlace,
  toasts,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly business: BusinessView;
  readonly place: Place;
  readonly onPlace: (placeId: string) => void;
  readonly toasts: Toasts;
}) {
  const setupHeld = tables.setup(slug, place.id);
  const setup = useHospitality(setupHeld);
  const placeSwitch =
    business.places.length > 1 ? (
      <Select
        label={strings.place}
        isLabelHidden
        items={business.places.map((each) => ({ id: each.id, label: each.name }))}
        value={place.id}
        onChange={(next) => {
          if (typeof next === 'string') onPlace(next);
        }}
      />
    ) : undefined;
  const ready = setup.status === 'ready' ? setup.value : undefined;
  const link = ready === undefined ? undefined : reservePageUrl(ready.publicKey);
  const topBar = (
    <TopBar title={strings.reservations} icon="calendar-check">
      {placeSwitch}
      {link !== undefined && ready?.rules.online === true && (
        <>
          <CopyButton value={link} label={strings.copyLink} />
          <ButtonLink href={link} icon="external-link" isExternal>
            {strings.openPage}
          </ButtonLink>
        </>
      )}
    </TopBar>
  );
  if (setup.status !== 'ready') {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{
          topBar,
          body:
            setup.status === 'loading' ? (
              <Skeleton shape="block" />
            ) : (
              <EmptyState icon="circle-alert" title={setup.error.message} onRetry={setupHeld.retry} />
            ),
        }}
      />
    );
  }
  return (
    <WorkspacePage
      currentPage="reservations"
      page={{
        topBar,
        body: (
          <SetupBody
            slug={slug}
            tables={tables}
            place={place}
            setup={setup.value}
            isSaving={setup.isSaving}
            toasts={toasts}
          />
        ),
      }}
    />
  );
}

function SetupBody({
  slug,
  tables,
  place,
  setup,
  isSaving,
  toasts,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly place: Place;
  readonly setup: TableSetupView;
  readonly isSaving: boolean;
  readonly toasts: Toasts;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(setup.rules));
  const [problem, setProblem] = useState<{ readonly message: string; readonly href?: string } | undefined>();
  const [errors, setErrors] = useState<Readonly<Partial<Record<keyof Draft, string>>>>({});
  const [isStopping, setStopping] = useState(false);
  // The zone's name reads its offset as of opening the page.
  const [openedAt] = useState(() => Date.now());
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((now) => ({ ...now, [key]: value }));
    if (errors[key] !== undefined) {
      const { [key]: _fixed, ...rest } = errors;
      setErrors(rest);
    }
  };
  /** A field's error, when it has one. */
  const errorOf = (key: keyof Draft) => (errors[key] === undefined ? {} : { error: errors[key] });
  const stepOf = (id: 'hours' | 'tables' | 'rules') => setup.steps.find((step) => step.step === id);
  const fixHref = (id: string | undefined) =>
    id === 'hours' || id === 'tables' ? placeTablesHref(slug, place.id) : undefined;
  const save = async (online: boolean) => {
    setProblem(undefined);
    const read = rulesOf(draft, setup.rules);
    if ('errors' in read) {
      setErrors(read.errors);
      // The first field to fix takes focus, so its message is read where the number is, wherever the page is scrolled.
      const first = (Object.keys(DRAFT_ORDER) as (keyof Draft)[]).find((key) => read.errors[key] !== undefined);
      globalThis.requestAnimationFrame(() => {
        if (first !== undefined) globalThis.document.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
      });
      toasts.toast({ tone: 'danger', message: strings.fixFields });
      return;
    }
    setErrors({});
    const refused = await tables.saveSetup(slug, place.id, { ...read.rules, online });
    if (refused === undefined) {
      toasts.toast({
        tone: 'success',
        message: online ? strings.published : online === setup.rules.online ? strings.saved : strings.unpublished,
      });
      return;
    }
    const missing = setup.steps.find((step) => !step.done);
    const href = fixHref(missing?.step);
    setProblem({ message: refused.message, ...(href === undefined ? {} : { href }) });
  };
  const live = setup.rules.online;
  const link = reservePageUrl(setup.publicKey);
  const hours = stepOf('hours');
  const tablesStep = stepOf('tables');
  const problemLine =
    problem === undefined ? undefined : (
      <Callout
        tone="danger"
        isAnnounced
        {...(problem.href === undefined
          ? {}
          : {
              actions: (
                <ButtonLink href={problem.href} size="sm">
                  {strings.fixIt}
                </ButtonLink>
              ),
            })}
      >
        {problem.message}
      </Callout>
    );
  const aside = (
    <>
      <SetupChecklist
        title={live ? strings.live : strings.finishSetup}
        defaultDoneExpanded={false}
        steps={[
          {
            id: 'hours',
            title: strings.stepHours,
            isDone: hours?.done === true,
            ...(hours?.fix === undefined ? {} : { detail: hours.fix }),
            action: strings.open,
          },
          {
            id: 'tables',
            title: strings.stepTables,
            isDone: tablesStep?.done === true,
            ...(tablesStep?.fix === undefined ? {} : { detail: tablesStep.fix }),
            action: strings.open,
          },
          {
            id: 'rules',
            title: strings.stepRules,
            isDone: setup.saved && stepOf('rules')?.done === true,
            detail: setup.saved ? strings.rulesSaved : strings.rulesDefault,
            action: strings.review,
          },
          {
            id: 'publish',
            title: strings.stepPublish,
            isDone: live,
            detail: live ? link : strings.notLive,
            ...(live ? {} : { action: strings.publish }),
          },
        ]}
        onAction={(id) => {
          if (id === 'hours' || id === 'tables') globalThis.location.assign(placeTablesHref(slug, place.id));
          else if (id === 'rules')
            globalThis.document.querySelector<HTMLInputElement>('input[name="minutes"]')?.focus();
          else if (id === 'publish') void save(true);
        }}
      />
      {live && (
        <Card title={strings.pageLive} description={strings.liveText}>
          {/* The address on its own line, cut short with its end kept readable. */}
          <TruncatedText>{link}</TruncatedText>
        </Card>
      )}
      <Card title={strings.alertsTitle} description={strings.alertsText}>
        <Switch
          label={strings.alertsSwitch}
          isSelected={setup.notifyMe}
          onChange={(on) => {
            void tables.setNotify(slug, place.id, on).then((refused) => {
              if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
            });
          }}
        />
      </Card>
      <Modal
        isOpen={isStopping}
        onOpenChange={setStopping}
        title={strings.stopTitle}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button slot="close">{strings.keepTaking}</Button>
            <Button
              variant="danger"
              onPress={() => {
                setStopping(false);
                void save(false);
              }}
            >
              {strings.unpublish}
            </Button>
          </>
        }
      >
        {strings.stopText}
      </Modal>
    </>
  );
  const saveButton = (
    <Button isDisabled={isSaving} onPress={() => void save(live)}>
      {strings.saveSettings}
    </Button>
  );
  const intervals = [15, 30, 45, 60, ...(['15', '30', '45', '60'].includes(draft.step) ? [] : [Number(draft.step)])];
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
  const locale = day.resolvedOptions().locale;
  // 2 January 2023 was a Monday: each week day's name in the reader's language.
  const dayName = (index: number) => day.format(new Date(Date.UTC(2023, 0, 2 + index)));
  return (
    <PageColumn aside={aside} stack="aside-first">
      <Card title={strings.onlineBooking} description={strings.onlineBookingText(place.name)} footer={saveButton}>
        {/* 1. Accept online bookings: on publishes (Publish's checks first), off asks first. */}
        <Switch
          label={strings.acceptOnline}
          description={strings.acceptOnlineText}
          isSelected={live}
          isDisabled={isSaving}
          onChange={(on) => {
            if (on) void save(true);
            else setStopping(true);
          }}
        />
        {problemLine}
        {/* 2 and 3. The time zone and service hours are the place's (one business profile): shown, edited there. */}
        <FieldGroup
          label={strings.timeZone}
          action={
            <ButtonLink href={placeTablesHref(slug, place.id)} variant="ghost" size="sm">
              {strings.editZone}
            </ButtonLink>
          }
        >
          {zoneDisplay(place.timeZone, openedAt)}
        </FieldGroup>
        <FieldGroup
          label={strings.serviceHours}
          hint={strings.serviceHoursHint}
          action={
            <ButtonLink href={placeTablesHref(slug, place.id)} variant="ghost" size="sm">
              {strings.editHours}
            </ButtonLink>
          }
        >
          <DescriptionList
            layout="compact"
            items={WEEK_DAYS.map((weekDay, index) => {
              const ranges = place.hours.weekly[weekDay] ?? [];
              return {
                id: weekDay,
                term: dayName(index),
                description:
                  ranges.length === 0
                    ? strings.noBookings
                    : ranges
                        .map((range) => `${clockLabel(range.from, locale)} – ${clockLabel(range.to, locale)}`)
                        .join(', '),
                isPlaceholder: ranges.length === 0,
              };
            })}
          />
        </FieldGroup>
        {/* 4. Slot interval and turn time. */}
        <FormRow>
          <Select
            label={strings.interval}
            items={intervals.map((minutes) => ({ id: String(minutes), label: strings.everyMinutes(minutes) }))}
            value={draft.step}
            onChange={(next) => {
              if (typeof next === 'string') set('step')(next);
            }}
          />
          <Field
            label={strings.turnTime}
            inputMode="numeric"
            suffix={strings.min}
            name="minutes"
            value={draft.minutes}
            {...errorOf('minutes')}
            onChange={set('minutes')}
            hint={strings.turnTimeHint}
          />
        </FormRow>
        {/* 5. Min lead and booking window. */}
        <FormRow>
          <Field
            label={strings.notice}
            inputMode="numeric"
            suffix={strings.min}
            name="notice"
            value={draft.notice}
            {...errorOf('notice')}
            onChange={set('notice')}
            hint={strings.noticeHint}
          />
          <Field
            label={strings.window}
            inputMode="numeric"
            suffix={strings.days}
            name="window"
            value={draft.window}
            {...errorOf('window')}
            onChange={set('window')}
            hint={strings.windowHint}
          />
        </FormRow>
        {/* 6. Min and max party. */}
        <FormRow>
          <Field
            label={strings.partyMin}
            inputMode="numeric"
            name="partyMin"
            value={draft.partyMin}
            onChange={set('partyMin')}
            {...errorOf('partyMin')}
          />
          <Field
            label={strings.partyMax}
            inputMode="numeric"
            name="partyMax"
            value={draft.partyMax}
            {...errorOf('partyMax')}
            onChange={set('partyMax')}
            hint={strings.partyMaxHint}
          />
        </FormRow>
        {/* 7. Max covers per slot. */}
        <Field
          label={strings.covers}
          inputMode="numeric"
          name="covers"
          value={draft.covers}
          {...errorOf('covers')}
          onChange={set('covers')}
          placeholder={strings.noCap}
          hint={strings.coversHint}
        />
      </Card>
      {/* Ours after checklabs' sheet: turn time by party size (its hidden turnBySize) and the guests' own changes. */}
      <Card title={strings.moreTitle} footer={saveButton}>
        <FormRow>
          <Field
            label={strings.holdFor(3)}
            inputMode="numeric"
            suffix={strings.min}
            name="hold3"
            value={draft.hold3}
            {...errorOf('hold3')}
            onChange={set('hold3')}
          />
          <Field
            label={strings.holdFor(5)}
            inputMode="numeric"
            suffix={strings.min}
            name="hold5"
            value={draft.hold5}
            {...errorOf('hold5')}
            onChange={set('hold5')}
          />
          <Field
            label={strings.holdFor(7)}
            inputMode="numeric"
            suffix={strings.min}
            name="hold7"
            value={draft.hold7}
            {...errorOf('hold7')}
            onChange={set('hold7')}
          />
        </FormRow>
      </Card>
      <Card title={strings.changesTitle} footer={saveButton}>
        <FormRow>
          <Field
            label={strings.changeCutoff}
            inputMode="numeric"
            suffix={strings.min}
            name="change"
            value={draft.change}
            {...errorOf('change')}
            onChange={set('change')}
          />
          <Field
            label={strings.cancelCutoff}
            inputMode="numeric"
            suffix={strings.min}
            name="cancel"
            value={draft.cancel}
            {...errorOf('cancel')}
            onChange={set('cancel')}
            hint={strings.cutoffHint}
          />
        </FormRow>
      </Card>
    </PageColumn>
  );
}
