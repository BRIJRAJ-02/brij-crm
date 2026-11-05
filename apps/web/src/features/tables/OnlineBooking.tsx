// Brief
// Purpose: how guests reserve a place online, in checklabs' "Online booking" sheet (spec 0066 B7 lite; spec 0068's
//   foolproof rule), opened from the Reservations page's bar.
// Main task: change the rules in checklabs' order and with its defaults (Accept online bookings, time zone, service
//   hours, slot interval and turn time, min lead and booking window, min and max party, max covers per slot), then
//   ours (turn time by party size, the guests' change and cancel cutoffs, new reservation emails), and keep them with
//   the one Save settings at the sheet's foot; with Accept online bookings on, saving publishes the page and the
//   sheet stays, its top now the page's link to copy or open. Until it is live, its top says what stands in the way
//   (the place's hours or tables, with Fix it) or how to publish.
// Leaves out: deposits, areas offered to guests and request only parties (later). Saving refuses a broken page and
//   says the one thing to fix, with the link to it; taking the page offline asks first. Save sends only what the
//   person changed over the latest copy, so it never undoes another manager's change.
import type { ServicePlace, TableRules, TableSetupView, TablesStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { WEEK_DAYS } from '@crm/data/hospitality';
import {
  Button,
  ButtonLink,
  Callout,
  DescriptionList,
  EmptyState,
  Field,
  FieldGroup,
  Form,
  FormRow,
  Modal,
  Select,
  Skeleton,
  Switch,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
import { zoneDisplay } from '../../public/booking/time.ts';
import { publicBookingOrigin } from '../booking/links.ts';
import { clockLabel } from '../hospitality/hours-rows.ts';
import { DrawerForm } from '../menus/drawer.tsx';
import { placeTablesHref } from '../settings/nav.ts';
import { strings } from './strings.ts';

/** The page's address for a place's key, on the public origin (timefix.com), never the app's. */
export const reservePageUrl = (publicKey: string) => `${publicBookingOrigin()}/r/${publicKey}`;

/** The sheet's one form, which the footer's Save settings submits. */
const FORM_ID = 'online-booking';

/** A rules form: every number as typed, and the two switches. */
type Numbers = Readonly<
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

/** The whole form: the numbers, Accept online bookings, and the reader's own new reservation emails. */
interface Draft extends Numbers {
  readonly online: boolean;
  readonly notify: boolean;
}

/** The form's fields in reading order: the first one with a problem takes focus. */
const DRAFT_ORDER: Readonly<Record<keyof Numbers, true>> = {
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

const draftOf = (setup: TableSetupView): Draft => {
  const { rules } = setup;
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
    online: rules.online,
    notify: setup.notifyMe,
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
): { readonly rules: TableRules } | { readonly errors: Readonly<Partial<Record<keyof Numbers, string>>> } => {
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
  } satisfies Record<keyof Numbers, { readonly value?: number; readonly error?: string }>;
  const errors: Partial<Record<keyof Numbers, string>> = Object.fromEntries(
    Object.entries(read).flatMap(([key, each]) => (each.error === undefined ? [] : [[key, each.error]])),
  );
  const min = read.partyMin.value;
  const max = read.partyMax.value;
  if (min !== undefined && max !== undefined && max < min) errors.partyMax = strings.partyMaxBelow;
  if (Object.keys(errors).length > 0) return { errors };
  const at = (key: keyof Numbers) => read[key].value ?? 0;
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
      online: draft.online,
    },
  };
};

/** Whether two drafts hold the same rules (the reader's emails apart). */
const sameRules = (a: Draft, b: Draft) =>
  (Object.keys(DRAFT_ORDER) as (keyof Numbers)[]).every((key) => a[key].trim() === b[key].trim()) &&
  a.online === b.online;

/** Whether two drafts are the same form, the reader's emails too. */
const sameDraft = (a: Draft, b: Draft) => sameRules(a, b) && a.notify === b.notify;

/** What the person changed: the fields of `draft` that differ from the copy it started from. */
const changesOf = (draft: Draft, base: Draft): Partial<Draft> =>
  Object.fromEntries(
    (Object.keys(draft) as (keyof Draft)[]).flatMap((key) => (draft[key] === base[key] ? [] : [[key, draft[key]]])),
  );

/**
 * The page's one line while guests can't reserve online and online booking was never set up (setup's way in, now
 * that the settings sit in a sheet): shown to those who set the apps up, with Set up online booking. Nothing while it
 * loads or fails, once it is live, or once its settings were saved (a place that takes bookings by phone only).
 */
export function OnlineBookingNotice({
  slug,
  tables,
  placeId,
  onOpen,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly placeId: string;
  readonly onOpen: () => void;
}) {
  const setup = useHospitality(tables.setup(slug, placeId));
  if (setup.status !== 'ready' || setup.value.rules.online || setup.value.saved) return null;
  return (
    <Callout
      tone="info"
      actions={
        <Button icon="globe" onPress={onOpen}>
          {strings.setUpOnline}
        </Button>
      }
    >
      {strings.notLiveNotice}
    </Callout>
  );
}

/** The sheet: checklabs' "Online booking", one form and one Save settings at its foot. */
export function OnlineBookingDrawer({
  isOpen = true,
  slug,
  tables,
  place,
  toasts,
  onClose,
}: {
  /** Open; the screen keeps the sheet mounted while it closes, so it slides out. */
  readonly isOpen?: boolean;
  readonly slug: string;
  readonly tables: TablesStore;
  readonly place: ServicePlace;
  readonly toasts: Toasts;
  readonly onClose: () => void;
}) {
  const setupHeld = tables.setup(slug, place.id);
  const setup = useHospitality(setupHeld);
  const ready = setup.status === 'ready' ? setup.value : undefined;
  // The form and the copy it started from. Until the person changes something, it follows the latest copy (the read
  // the sheet starts, another manager's save); once they have, what they typed stays, and Save lays only their
  // changes over the latest copy, so it never sends back a value someone else changed meanwhile (Accept online
  // bookings above all).
  const [base, setBase] = useState<TableSetupView | undefined>(ready);
  const [draft, setDraft] = useState<Draft | undefined>(ready === undefined ? undefined : () => draftOf(ready));
  if (ready !== undefined && ready !== base) {
    const latest = draftOf(ready);
    if (base === undefined || draft === undefined || sameDraft(draft, draftOf(base)) || sameDraft(draft, latest)) {
      setBase(ready);
      setDraft(latest);
    }
  }
  const [errors, setErrors] = useState<Readonly<Partial<Record<keyof Numbers, string>>>>({});
  const [problem, setProblem] = useState<{ readonly message: string; readonly href?: string } | undefined>();
  const [isSaving, setSaving] = useState(false);
  const [isStopping, setStopping] = useState(false);
  // The zone's name reads its offset as of opening the sheet.
  const [openedAt] = useState(() => Date.now());
  const isDirty = draft !== undefined && base !== undefined && !sameDraft(draft, draftOf(base));

  const set = (key: keyof Numbers) => (value: string) => {
    setDraft((now) => (now === undefined ? now : { ...now, [key]: value }));
    if (errors[key] !== undefined) {
      const { [key]: _fixed, ...rest } = errors;
      setErrors(rest);
    }
  };
  /** A field's error, when it has one. */
  const errorOf = (key: keyof Numbers) => (errors[key] === undefined ? {} : { error: errors[key] });
  const fixHref = (id: string | undefined) =>
    id === 'hours' || id === 'tables' ? placeTablesHref(slug, place.id) : undefined;

  /** Saves the form: the person's changes over the latest copy. `isAsked` once taking the page offline is confirmed. */
  const save = async (options: { readonly isAsked?: boolean } = {}) => {
    if (ready === undefined || draft === undefined || base === undefined || isSaving) return;
    const saved = draftOf(ready);
    const form: Draft = { ...saved, ...changesOf(draft, draftOf(base)) };
    setProblem(undefined);
    const read = rulesOf(form);
    if ('errors' in read) {
      setErrors(read.errors);
      // The first field to fix takes focus, so its message is read where the number is, wherever the sheet scrolled.
      const first = (Object.keys(DRAFT_ORDER) as (keyof Numbers)[]).find((key) => read.errors[key] !== undefined);
      globalThis.requestAnimationFrame(() => {
        if (first !== undefined) globalThis.document.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
      });
      toasts.toast({ tone: 'danger', message: strings.fixFields });
      return;
    }
    setErrors({});
    // Taking the page offline takes guests' way in away: it asks first, then saves.
    if (saved.online && !form.online && options.isAsked !== true) {
      setStopping(true);
      return;
    }
    setSaving(true);
    // Unchanged rules already saved send nothing: Save then only keeps the reader's emails, or just closes.
    const refused =
      sameRules(form, saved) && ready.saved ? undefined : await tables.saveSetup(slug, place.id, read.rules);
    if (refused !== undefined) {
      setSaving(false);
      const missing = ready.steps.find((step) => !step.done);
      const href = fixHref(missing?.step);
      setProblem({ message: refused.message, ...(href === undefined ? {} : { href }) });
      // Said where the person is too: the line at the sheet's top may be out of sight.
      toasts.toast({ tone: 'danger', message: strings.couldntSave(refused.message) });
      return;
    }
    const emailRefused = form.notify === saved.notify ? undefined : await tables.setNotify(slug, place.id, form.notify);
    setSaving(false);
    if (emailRefused !== undefined) {
      setProblem({ message: emailRefused.message });
      toasts.toast({ tone: 'danger', message: strings.couldntSave(emailRefused.message) });
      return;
    }
    const isPublished = form.online && !saved.online;
    toasts.toast({
      tone: 'success',
      message: isPublished ? strings.published : !form.online && saved.online ? strings.unpublished : strings.saved,
    });
    // Just published, the sheet stays, its top now the page's link to share; any other save is done.
    if (isPublished) {
      setBase(undefined);
      return;
    }
    onClose();
  };

  const live = ready?.rules.online === true;
  const link = ready === undefined ? '' : reservePageUrl(ready.publicKey);
  const missing = ready?.steps.find((step) => !step.done && (step.step === 'hours' || step.step === 'tables'));
  const intervals =
    draft === undefined
      ? [15, 30, 45, 60]
      : [15, 30, 45, 60, ...(['15', '30', '45', '60'].includes(draft.step) ? [] : [Number(draft.step)])];
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
  const locale = day.resolvedOptions().locale;
  // 2 January 2023 was a Monday: each week day's name in the reader's language.
  const dayName = (index: number) => day.format(new Date(Date.UTC(2023, 0, 2 + index)));

  // The sheet's top: live, the page's link to copy or open; not yet, what stands in the way (the place's hours or
  // tables, with the way to them), else how to publish. Never a card: a dialog's body holds its pieces directly.
  const head =
    ready === undefined ? null : live ? (
      <FieldGroup
        label={strings.pageLive}
        action={
          <ButtonLink href={link} variant="ghost" size="sm" icon="external-link" isExternal>
            {strings.openPage}
          </ButtonLink>
        }
      >
        <Field
          variant="copy"
          label={strings.pageLink}
          isLabelHidden
          value={link}
          copyLabel={strings.copyLink}
          hint={strings.liveText}
        />
      </FieldGroup>
    ) : missing?.fix !== undefined ? (
      <Callout tone="warning" actions={<ButtonLink href={placeTablesHref(slug, place.id)}>{strings.fixIt}</ButtonLink>}>
        {missing.fix}
      </Callout>
    ) : (
      <Callout tone="info">{strings.notLiveYet}</Callout>
    );

  const fields =
    draft === undefined ? null : (
      <Form id={FORM_ID} label={strings.onlineBooking} isBusy={isSaving} onSubmit={() => void save()}>
        {/* 1. Accept online bookings: saved with the rest; on, Save publishes (its checks first); off asks first. */}
        <Switch
          label={strings.acceptOnline}
          description={strings.acceptOnlineText}
          isSelected={draft.online}
          isDisabled={isSaving}
          onChange={(on) => setDraft({ ...draft, online: on })}
        />
        {problem !== undefined && (
          <Callout
            tone="danger"
            isAnnounced
            {...(problem.href === undefined
              ? {}
              : {
                  actions: <ButtonLink href={problem.href}>{strings.fixIt}</ButtonLink>,
                })}
          >
            {problem.message}
          </Callout>
        )}
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
        {/* Ours after checklabs' sheet: turn time by party size (its hidden turnBySize), then the guests' own changes. */}
        <FieldGroup label={strings.moreTitle}>
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
        </FieldGroup>
        <FieldGroup label={strings.changesTitle} hint={strings.cutoffHint}>
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
            />
          </FormRow>
        </FieldGroup>
        {/* The reader's own: an email each time a guest reserves online. */}
        <Switch
          label={strings.alertsSwitch}
          description={strings.alertsText}
          isSelected={draft.notify}
          isDisabled={isSaving}
          onChange={(on) => setDraft({ ...draft, notify: on })}
        />
      </Form>
    );

  return (
    <>
      <DrawerForm
        isOpen={isOpen}
        title={strings.onlineBooking}
        isDirty={isDirty}
        isBusy={isSaving}
        onClose={onClose}
        actions={
          <>
            <Button slot="close" isDisabled={isSaving}>
              {strings.cancel}
            </Button>
            {draft !== undefined && (
              <Button variant="primary" type="submit" form={FORM_ID} isPending={isSaving}>
                {isSaving ? strings.savingSettings : strings.saveSettings}
              </Button>
            )}
          </>
        }
      >
        {setup.status === 'loading' ? (
          <Skeleton shape="text" lines={8} />
        ) : setup.status === 'error' ? (
          <EmptyState icon="circle-alert" title={setup.error.message} layout="row" onRetry={setupHeld.retry} />
        ) : (
          <>
            {head}
            {fields}
          </>
        )}
      </DrawerForm>
      <Modal
        isOpen={isStopping}
        onOpenChange={setStopping}
        title={strings.stopTitle}
        variant="confirm"
        actions={
          <>
            <Button slot="close">{strings.keepTaking}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setStopping(false);
                void save({ isAsked: true });
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
}
