// Brief
// Purpose: Settings › Shifts (spec 0066 B1, AC-6612, AC-6613; Fresha's Scheduled shifts): who works when at one
// place, a week at a time, staff down the side and the days across, with time off in the cells.
// Main task: change one date for one person, or a person's regular week, copy a week to every week, copy shifts to
// others, add time off or block time; each change saved at once.
// Leaves out: booked visits (the calendar, B3), and the staff profiles themselves (Settings › Staff).
import type { ServicesStore, StaffTeamView, StaffView } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  HoursEditor,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  SectionBar,
  Select,
  TeamWeek,
  Tooltip,
  useFormatSettings,
  type TeamWeekCell,
  type TeamWeekDay,
  type TeamWeekPerson,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { clockLabel } from '../hospitality/hours-rows.ts';
import { businessSettingsHref, shiftsSettingsHref, staffSettingsHref } from '../settings/nav.ts';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { NotInstalled } from './NotInstalled.tsx';
import { RegularShifts } from './RegularShifts.tsx';
import {
  awayOn,
  copyWeekToAll,
  isChanged,
  minutesOver,
  mondayOf,
  pairMinutes,
  plusDays,
  rangesOn,
  todayIn,
  usualOn,
  weekDates,
  withDate,
  type Pair,
} from './shifts.ts';
import { strings } from './strings.ts';
import { BlockDialog, TimeOffDialog } from './TimeDialogs.tsx';

/** Props for Settings › Shifts. */
export interface ShiftsScreenProps {
  readonly store: ServicesStore;
  readonly slug: string;
  /** The place and the week's Monday the address names, if it does. */
  readonly placeId?: string;
  readonly week?: string;
  readonly toasts: Toasts;
}

/** What is open over the grid. */
type Open =
  | { readonly kind: 'regular' | 'copy-week' | 'copy-to' | 'time-off'; readonly staffId: string }
  | { readonly kind: 'block'; readonly staffId: string; readonly day: string };

/** A day as the grid heads it: "Mon 9", today marked. */
function dayColumn(date: string, locale: string, today: string): TeamWeekDay & { readonly long: string } {
  const at = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(at);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(at);
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(at);
  return { id: date, label: `${weekday} ${day}`, weekday, date: day, isToday: date === today, long };
}

/** "9 – 15 Nov 2027" for a week. */
function rangeWords(monday: string, locale: string): string {
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return format.formatRange(new Date(`${monday}T12:00:00Z`), new Date(`${plusDays(monday, 6)}T12:00:00Z`));
}

/** The grid. */
export function ShiftsScreen({ store, slug, placeId, week, toasts }: ShiftsScreenProps) {
  const state = useHospitality(store.team(slug, 'shifts'));
  if (state.status === 'error') {
    if (state.error.code === 'APP_NOT_INSTALLED') return <NotInstalled slug={slug} title={strings.shiftsTitle} />;
    if (state.error.code === 'FORBIDDEN') return <SettingsMissing backTo="home" />;
    return (
      <SettingsPage title={strings.shiftsTitle}>
        <EmptyState
          title={strings.failed}
          icon="calendar-clock"
          actions={<Button onPress={() => store.team(slug, 'shifts').retry()}>{strings.retry}</Button>}
        >
          {state.error.message}
        </EmptyState>
      </SettingsPage>
    );
  }
  const team = state.status === 'ready' ? state.value : undefined;
  if (team !== undefined && team.places.length === 0) {
    return (
      <SettingsPage title={strings.shiftsTitle}>
        <EmptyState
          title={strings.noPlaces}
          icon="calendar-clock"
          actions={
            <ButtonLink variant="primary" href={businessSettingsHref(slug)}>
              {strings.openBusiness}
            </ButtonLink>
          }
        >
          {strings.noPlacesText}
        </EmptyState>
      </SettingsPage>
    );
  }
  return <Grid store={store} slug={slug} team={team} placeId={placeId} week={week} toasts={toasts} />;
}

function Grid({
  store,
  slug,
  team,
  placeId,
  week,
  toasts,
}: {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly team: StaffTeamView | undefined;
  readonly placeId: string | undefined;
  readonly week: string | undefined;
  readonly toasts: Toasts;
}) {
  const { locale } = useFormatSettings();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open | undefined>();
  const place = team?.places.find((each) => each.id === placeId) ?? team?.places[0];
  const zone = place?.timeZone ?? 'UTC';
  const today = todayIn(zone);
  const monday = week === undefined ? mondayOf(today) : mondayOf(week);
  const dates = weekDates(monday);
  const columns = dates.map((date) => dayColumn(date, locale, today));
  const go = (next: { readonly place?: string; readonly week?: string }) =>
    void navigate({
      href: shiftsSettingsHref(slug, {
        ...(place === undefined ? {} : { place: place.id }),
        week: monday,
        ...next,
      }),
      replace: true,
    });
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
    return refused?.message;
  };
  const here = (team?.staff ?? []).filter(
    (person) => !person.archived && person.places.some((at) => at.placeId === place?.id),
  );
  const worksOf = (person: StaffView) => person.places.find((at) => at.placeId === place?.id);
  const words = (pairs: readonly Pair[]) =>
    pairs.length === 0
      ? strings.off
      : pairs.map(([from, to]) => strings.range(clockLabel(from, locale), clockLabel(to, locale))).join(', ');

  const cellOf = (person: StaffView, date: string, long: string): TeamWeekCell => {
    const works = worksOf(person);
    const away = awayOn(person.timeOff, date, zone, place?.id ?? '');
    if (away !== undefined) {
      return {
        tone: 'away',
        lines: [strings.reasons[away.reason]],
        label: strings.awayCell(long, person.name, strings.reasons[away.reason]),
      };
    }
    if (works === undefined)
      return { tone: 'off', lines: [strings.off], label: strings.cellLabel(long, person.name, strings.off, false) };
    const pairs = rangesOn(works.shifts, date);
    const changed = isChanged(works.shifts, date);
    const lines =
      pairs.length === 0
        ? [strings.off]
        : pairs.map(([from, to]) => strings.range(clockLabel(from, locale), clockLabel(to, locale)));
    return {
      tone: pairs.length === 0 ? 'off' : changed ? 'override' : 'usual',
      lines,
      label: strings.cellLabel(long, person.name, words(pairs), changed),
    };
  };

  const people: TeamWeekPerson[] = here.map((person) => {
    const works = worksOf(person);
    const picture = person.photo === undefined ? undefined : store.staffPhotoSrc(slug, person.id, person.photo);
    return {
      id: person.id,
      name: person.name,
      meta: strings.hoursWeek(works === undefined ? 0 : minutesOver(works.shifts, dates)),
      ...(person.title === undefined ? {} : { badge: person.title }),
      ...(picture === undefined ? {} : { picture }),
      ...(person.color === undefined ? {} : { hue: person.color }),
      cells: columns.map((column) => cellOf(person, column.id, column.long)),
      isEditable: true,
      actions: (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.rowActions(person.name)} />
          <Menu
            label={strings.rowActions(person.name)}
            onAction={(key) => {
              if (key === 'regular' || key === 'copy-week' || key === 'copy-to' || key === 'time-off') {
                setOpen({ kind: key, staffId: person.id });
              }
              if (key === 'block') setOpen({ kind: 'block', staffId: person.id, day: today < monday ? monday : today });
            }}
            disabledKeys={[
              ...(here.length < 2 ? ['copy-to'] : []),
              ...(person.memberId === undefined ? [] : ['time-off', 'block']),
            ]}
          >
            <MenuItem id="regular" icon="clock">
              {strings.setRegular}
            </MenuItem>
            <MenuItem id="copy-week" icon="copy">
              {strings.copyToAllWeeks}
            </MenuItem>
            <MenuItem id="copy-to" icon="users">
              {strings.copyToOthers}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="time-off" icon="calendar-plus">
              {strings.addTimeOff}
            </MenuItem>
            <MenuItem id="block" icon="calendar-clock">
              {strings.blockTime}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      ),
    };
  });

  const footer =
    people.length === 0
      ? undefined
      : {
          label: strings.shiftsTitle,
          totals: columns.map((column) => {
            const working = here.filter((person) => {
              const works = worksOf(person);
              return (
                works !== undefined &&
                rangesOn(works.shifts, column.id).length > 0 &&
                awayOn(person.timeOff, column.id, zone, place?.id ?? '') === undefined
              );
            });
            const minutes = working.reduce(
              (total, person) =>
                total +
                rangesOn(worksOf(person)?.shifts ?? { weekly: {}, exceptions: [] }, column.id).reduce(
                  (sum, pair) => sum + pairMinutes(pair),
                  0,
                ),
              0,
            );
            const value = working.length === 0 ? strings.off : strings.staffCount(working.length);
            return {
              value,
              detail: strings.hoursWeek(minutes),
              label: `${column.long}: ${value}, ${strings.hoursWeek(minutes)}`,
            };
          }),
        };

  const person = open === undefined ? undefined : team?.staff.find((each) => each.id === open.staffId);
  const works = person === undefined ? undefined : worksOf(person);
  const placeItems = (team?.places ?? []).map((each) => ({ id: each.id, label: each.name }));

  return (
    <SettingsPage title={strings.shiftsTitle} isLoading={team === undefined}>
      <SectionBar
        variant="bar"
        start={
          <>
            <Button
              variant="secondary"
              isDisabled={monday === mondayOf(today)}
              onPress={() => go({ week: mondayOf(today) })}
            >
              {strings.thisWeek}
            </Button>
            <Tooltip content={strings.previousWeek}>
              <Button
                variant="ghost"
                icon="chevron-left"
                label={strings.previousWeek}
                onPress={() => go({ week: plusDays(monday, -7) })}
              />
            </Tooltip>
            <Tooltip content={strings.nextWeek}>
              <Button
                variant="ghost"
                icon="chevron-right"
                label={strings.nextWeek}
                onPress={() => go({ week: plusDays(monday, 7) })}
              />
            </Tooltip>
          </>
        }
        title={rangeWords(monday, locale)}
        isTitleQuiet
        end={
          placeItems.length > 1 && place !== undefined ? (
            <Select
              label={strings.place}
              isLabelHidden
              savesOnPick
              items={placeItems}
              value={place.id}
              onChange={(chosen) => {
                if (chosen !== null) go({ place: chosen });
              }}
            />
          ) : undefined
        }
      />
      <TeamWeek
        label={`${strings.shiftsTitle}, ${place?.name ?? ''}, ${rangeWords(monday, locale)}`}
        days={columns}
        people={people}
        isLoading={team === undefined}
        {...(footer === undefined ? {} : { footer })}
        legend={{
          items: [
            { tone: 'usual', label: strings.usual },
            { tone: 'override', label: strings.changed },
            { tone: 'off', label: strings.off },
            { tone: 'away', label: strings.away },
          ],
          hint: strings.legendHint,
        }}
        emptyState={
          <EmptyState
            title={strings.noStaffHere(place?.name ?? '')}
            icon="calendar-clock"
            {...(team?.canManage === true
              ? {
                  actions: (
                    <Button
                      variant="primary"
                      icon="plus"
                      onPress={() => void navigate({ href: staffSettingsHref(slug) })}
                    >
                      {strings.addStaff}
                    </Button>
                  ),
                }
              : {})}
          >
            {strings.noStaffHereText}
          </EmptyState>
        }
        editorLabel={(staffId, index) =>
          strings.editorLabel(here.find((each) => each.id === staffId)?.name ?? '', columns[index]?.long ?? '')
        }
        editorTitle={(staffId, index) =>
          strings.editorTitle(columns[index]?.label ?? '', here.find((each) => each.id === staffId)?.name ?? '')
        }
        renderEditor={(staffId, index, close) => {
          const who = here.find((each) => each.id === staffId);
          const at = who === undefined ? undefined : worksOf(who);
          const date = dates[index];
          if (who === undefined || at === undefined || date === undefined || place === undefined) return null;
          return (
            <DayEditor
              label={columns[index]?.label ?? date}
              ranges={rangesOn(at.shifts, date)}
              usual={usualOn(at.shifts, date)}
              isChanged={isChanged(at.shifts, date)}
              words={words}
              isAway={awayOn(who.timeOff, date, zone, place.id) !== undefined}
              onCancel={close}
              onSave={(pairs) => {
                close();
                void store
                  .setShifts(slug, 'shifts', who.id, place.id, withDate(at.shifts, date, pairs), at.outsideHours)
                  .then(said);
              }}
            />
          );
        }}
      />
      {open?.kind === 'regular' && person !== undefined && works !== undefined && place !== undefined ? (
        <Modal
          variant="window"
          title={strings.regularTitle(person.name, place.name)}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setOpen(undefined);
          }}
          status={strings.savedAsYouChange}
          actions={<Button slot="close">{strings.done}</Button>}
        >
          <Callout tone="info">{strings.regularHint}</Callout>
          <RegularShifts
            name={person.name}
            place={place}
            works={works}
            onSave={(shifts, outsideHours) =>
              store.setShifts(slug, 'shifts', person.id, place.id, shifts, outsideHours).then(said)
            }
          />
        </Modal>
      ) : null}
      <Modal
        variant="confirm"
        title={person === undefined ? '' : strings.copyWeekQuestion(person.name)}
        isOpen={open?.kind === 'copy-week'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setOpen(undefined);
                if (person === undefined || works === undefined || place === undefined) return;
                // One write with all seven days (never a day at a time).
                void store
                  .setShifts(
                    slug,
                    'shifts',
                    person.id,
                    place.id,
                    copyWeekToAll(works.shifts, monday),
                    works.outsideHours,
                  )
                  .then((refused) => {
                    if (said(refused) !== undefined) return;
                    const before = works.shifts;
                    toasts.toast({
                      tone: 'success',
                      message: strings.copyWeekDone(person.name),
                      action: {
                        label: strings.undo,
                        onAction: () =>
                          void store
                            .setShifts(slug, 'shifts', person.id, place.id, before, works.outsideHours)
                            .then(said),
                      },
                    });
                  });
              }}
            >
              {strings.copyWeek}
            </Button>
          </>
        }
      >
        {strings.copyWeekLine}
      </Modal>
      {open?.kind === 'copy-to' && person !== undefined && place !== undefined ? (
        <CopyToDialog
          person={person}
          others={here.filter((each) => each.id !== person.id)}
          onClose={() => setOpen(undefined)}
          onCopy={async (ids) => {
            // What each had, so Undo puts every one back in one press.
            const before = here.flatMap((each) => {
              const at = worksOf(each);
              return ids.includes(each.id) && at !== undefined ? [{ id: each.id, at }] : [];
            });
            const refused = await store.copyShifts(slug, 'shifts', person.id, place.id, ids);
            if (refused === undefined) {
              setOpen(undefined);
              toasts.toast({
                tone: 'success',
                message: strings.copyDone(ids.length),
                action: {
                  label: strings.undo,
                  onAction: () => {
                    for (const was of before) {
                      void store
                        .setShifts(slug, 'shifts', was.id, place.id, was.at.shifts, was.at.outsideHours)
                        .then(said);
                    }
                  },
                },
              });
            }
            return refused?.message;
          }}
        />
      ) : null}
      {open?.kind === 'time-off' && person !== undefined && team !== undefined ? (
        <TimeOffDialog
          person={person}
          places={team.places}
          today={today}
          onClose={() => setOpen(undefined)}
          onAdd={async (input) => {
            const refused = await store.addTimeOff(slug, 'shifts', { staffId: person.id, ...input });
            if (refused === undefined) {
              setOpen(undefined);
              toasts.toast({ tone: 'success', message: strings.timeOffDone(person.name) });
            }
            return refused?.message;
          }}
        />
      ) : null}
      {open?.kind === 'block' && person !== undefined && place !== undefined ? (
        <BlockDialog
          person={person}
          place={place}
          day={open.day}
          locale={locale}
          onClose={() => setOpen(undefined)}
          onAdd={async (input) => {
            const refused = await store.addBlock(slug, 'shifts', { staffId: person.id, placeId: place.id, ...input });
            if (refused === undefined) {
              setOpen(undefined);
              toasts.toast({ tone: 'success', message: strings.blockDone });
            }
            return refused?.message;
          }}
        />
      ) : null}
    </SettingsPage>
  );
}

/** One date's hours in the cell's Popover: Save keeps them for that date only; Back to regular drops the change. */
function DayEditor({
  label,
  ranges,
  usual,
  isChanged: changed,
  isAway,
  words,
  onCancel,
  onSave,
}: {
  readonly label: string;
  readonly ranges: readonly Pair[];
  readonly usual: readonly Pair[];
  readonly isChanged: boolean;
  readonly isAway: boolean;
  readonly words: (pairs: readonly Pair[]) => string;
  readonly onCancel: () => void;
  readonly onSave: (pairs: readonly Pair[] | 'usual') => void;
}) {
  const [pairs, setPairs] = useState<readonly Pair[]>(ranges);
  const isUnchanged = JSON.stringify(pairs) === JSON.stringify(ranges);
  return (
    <>
      <HoursEditor
        label={strings.dayHours(label)}
        rows={[{ id: 'day', label, ranges: pairs }]}
        stepMinutes={15}
        isSingleDay
        onChange={(_, next) => setPairs(next.slice(0, 3))}
      />
      {isAway ? <Callout tone="info">{strings.away}</Callout> : null}
      <SectionBar
        start={
          changed ? (
            <Tooltip content={strings.regularIs(words(usual))}>
              <Button variant="ghost" size="sm" icon="undo-2" onPress={() => onSave('usual')}>
                {strings.backToRegular}
              </Button>
            </Tooltip>
          ) : undefined
        }
        end={
          <>
            <Button size="sm" onPress={onCancel}>
              {strings.cancel}
            </Button>
            <Button variant="primary" size="sm" isDisabled={isUnchanged} onPress={() => onSave(pairs)}>
              {strings.save}
            </Button>
          </>
        }
      />
    </>
  );
}

/** Copy one person's regular week to others at the place. */
function CopyToDialog({
  person,
  others,
  onClose,
  onCopy,
}: {
  readonly person: StaffView;
  readonly others: readonly StaffView[];
  readonly onClose: () => void;
  readonly onCopy: (ids: readonly string[]) => Promise<string | undefined>;
}) {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal
      variant="form"
      title={strings.copyToTitle(person.name)}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button
            variant="primary"
            isPending={isSaving}
            isDisabled={chosen.length === 0}
            onPress={() => {
              setSaving(true);
              void onCopy(chosen).then((refused) => {
                setSaving(false);
                setError(refused);
              });
            }}
          >
            {strings.copyTo}
          </Button>
        </>
      }
    >
      <Select
        label={strings.chooseStaff}
        selectionMode="multiple"
        items={others.map((each) => ({ id: each.id, label: each.name }))}
        values={chosen}
        onValuesChange={setChosen}
        hint={strings.copyToLine}
        {...(error === undefined ? {} : { error })}
      />
    </Modal>
  );
}
