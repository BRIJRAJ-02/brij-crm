// Brief
// Purpose: set up table reservations for a place and publish its page (spec 0066 B7 lite; spec 0068's foolproof rule).
// Main task: walk the checklist (hours, tables, rules), Publish, then share timefix.com/r/<key>; the rules are
//   checklabs' "Online booking" sheet laid out as the app's settings (parties, interval and hold, notice and window,
//   pacing, change and cancel cutoffs), each prefilled with a sensible default.
// Leaves out: deposits, areas offered to guests and request only parties (later). Publish refuses a broken page and
//   says the one thing to fix, with the link to it.
import type { BusinessView, HospitalityStore, Place, TableRules, TableSetupView, TablesStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  CopyButton,
  EmptyState,
  Field,
  Select,
  SettingsSection,
  SetupChecklist,
  Skeleton,
  TopBar,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
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
    notice: String(rules.noticeMinutes / 60),
    window: String(rules.windowDays),
    covers: rules.coversCap === undefined ? '' : String(rules.coversCap),
    change: String(rules.changeCutoffMinutes / 60),
    cancel: String(rules.cancelCutoffMinutes / 60),
  };
};

const whole = (text: string, fallback: number) => {
  const value = Number(text.trim());
  return text.trim() === '' || !Number.isFinite(value) ? fallback : Math.round(value);
};

const rulesOf = (draft: Draft, base: TableRules): TableRules => {
  const holds = [
    { size: 3, minutes: whole(draft.hold3, 0) },
    { size: 5, minutes: whole(draft.hold5, 0) },
    { size: 7, minutes: whole(draft.hold7, 0) },
  ].filter((row) => row.minutes > 0);
  const covers = whole(draft.covers, 0);
  return {
    minutes: whole(draft.minutes, base.minutes),
    holds,
    partyMin: whole(draft.partyMin, base.partyMin),
    partyMax: whole(draft.partyMax, base.partyMax),
    stepMinutes: whole(draft.step, base.stepMinutes),
    noticeMinutes: Math.round(Number(draft.notice) * 60) || 0,
    windowDays: whole(draft.window, base.windowDays),
    ...(covers > 0 ? { coversCap: covers } : {}),
    changeCutoffMinutes: Math.round(Number(draft.change) * 60) || 0,
    cancelCutoffMinutes: Math.round(Number(draft.cancel) * 60) || 0,
    online: base.online,
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
  const business = useHospitality(hospitality.business(slug));
  const [placeId, setPlaceId] = useState<string | undefined>();
  const topBar = <TopBar title={strings.reservations} icon="calendar-check" />;
  if (business.status === 'loading')
    return <WorkspacePage currentPage="reservations" page={{ topBar, body: <Skeleton shape="block" /> }} />;
  if (business.status === 'error') {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{ topBar, body: <EmptyState icon="circle-alert" title={business.error.message} /> }}
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
  const setup = useHospitality(tables.setup(slug, place.id));
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
              <EmptyState icon="circle-alert" title={setup.error.message} />
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
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((now) => ({ ...now, [key]: value }));
  };
  const stepOf = (id: 'hours' | 'tables' | 'rules') => setup.steps.find((step) => step.step === id);
  const fixHref = (id: string | undefined) =>
    id === 'hours' || id === 'tables' ? placeTablesHref(slug, place.id) : undefined;
  const save = async (online: boolean) => {
    setProblem(undefined);
    const refused = await tables.saveSetup(slug, place.id, { ...rulesOf(draft, setup.rules), online });
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
  return (
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
            action: strings.save,
          },
          {
            id: 'publish',
            title: strings.stepPublish,
            isDone: live,
            detail: live ? link : strings.notLive,
            action: strings.publish,
          },
        ]}
        onAction={(id) => {
          if (id === 'hours' || id === 'tables') globalThis.location.assign(placeTablesHref(slug, place.id));
          else if (id === 'rules') void save(live);
          else void save(true);
        }}
      />
      {problem !== undefined && (
        <Callout tone="danger" isAnnounced>
          {problem.message}
          {problem.href !== undefined && (
            <>
              {' '}
              <ButtonLink href={problem.href} variant="ghost">
                {strings.fixIt}
              </ButtonLink>
            </>
          )}
        </Callout>
      )}
      <SettingsSection title={strings.onlineBooking} description={strings.onlineBookingText(place.name)}>
        <Field label={strings.partyMin} inputMode="numeric" value={draft.partyMin} onChange={set('partyMin')} />
        <Field
          label={strings.partyMax}
          inputMode="numeric"
          value={draft.partyMax}
          onChange={set('partyMax')}
          hint={strings.partyMaxHint}
        />
        <Select
          label={strings.interval}
          items={[15, 30, 60].map((minutes) => ({ id: String(minutes), label: strings.everyMinutes(minutes) }))}
          value={draft.step}
          onChange={(next) => {
            if (typeof next === 'string') set('step')(next);
          }}
        />
        <Field
          label={strings.holdSmall}
          inputMode="numeric"
          suffix={strings.min}
          value={draft.minutes}
          onChange={set('minutes')}
          hint={strings.holdHint}
        />
        <Field
          label={strings.holdFor(3)}
          inputMode="numeric"
          suffix={strings.min}
          value={draft.hold3}
          onChange={set('hold3')}
        />
        <Field
          label={strings.holdFor(5)}
          inputMode="numeric"
          suffix={strings.min}
          value={draft.hold5}
          onChange={set('hold5')}
        />
        <Field
          label={strings.holdFor(7)}
          inputMode="numeric"
          suffix={strings.min}
          value={draft.hold7}
          onChange={set('hold7')}
        />
      </SettingsSection>
      <SettingsSection title={strings.whenTitle}>
        <Field
          label={strings.notice}
          inputMode="decimal"
          suffix={strings.hours}
          value={draft.notice}
          onChange={set('notice')}
          hint={strings.noticeHint}
        />
        <Field
          label={strings.window}
          inputMode="numeric"
          suffix={strings.days}
          value={draft.window}
          onChange={set('window')}
        />
        <Field
          label={strings.covers}
          inputMode="numeric"
          value={draft.covers}
          onChange={set('covers')}
          placeholder={strings.noCap}
          hint={strings.coversHint}
        />
        <Field
          label={strings.changeCutoff}
          inputMode="decimal"
          suffix={strings.hours}
          value={draft.change}
          onChange={set('change')}
        />
        <Field
          label={strings.cancelCutoff}
          inputMode="decimal"
          suffix={strings.hours}
          value={draft.cancel}
          onChange={set('cancel')}
          hint={strings.cutoffHint}
        />
      </SettingsSection>
      <SettingsSection
        title={live ? strings.pageLive : strings.publishTitle}
        description={live ? link : strings.publishText}
        actions={
          <>
            <Button isDisabled={isSaving} onPress={() => void save(live)}>
              {strings.save}
            </Button>
            {live ? (
              <Button variant="danger" isDisabled={isSaving} onPress={() => void save(false)}>
                {strings.unpublish}
              </Button>
            ) : (
              <Button variant="primary" isDisabled={isSaving} onPress={() => void save(true)}>
                {strings.publish}
              </Button>
            )}
          </>
        }
      >
        {null}
      </SettingsSection>
    </>
  );
}
