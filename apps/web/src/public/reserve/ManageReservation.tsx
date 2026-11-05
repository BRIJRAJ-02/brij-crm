// Brief
// Purpose: a guest's own reservation (spec 0066 B7 lite; 0065 AC-6555), at timefix.com/r/<key>/manage: by the link in
//   their email (the token in the fragment), or found with the code from the confirmation and their email.
// Main task: see it, add it to a calendar, change the time or party, or cancel, within the restaurant's cutoffs.
// Leaves out: pre-orders and special requests (later). Built on BookingReceipt and BookingChanges (no invites), as the
//   booking page's guest page is; checklabs' lookup by code alone and its UI only cutoff are not copied.
import {
  BookingChanges,
  BookingFrame,
  BookingMessage,
  BookingReceipt,
  Button,
  Callout,
  ChoiceChips,
  DayStrip,
  Field,
  SlotList,
  poweredByHref,
  type CancelOutcome,
} from '@crm/ui/public-booking';
import {
  isDataError,
  type GuestKey,
  type PublicTablePage,
  type PublicTableVisit,
  type TableClient,
  type TableRefusal,
} from '@crm/data/tables';
import { useEffect, useMemo, useState } from 'react';
import { compact, longDay, openDays, placeDate, rangesOn, services, shortDay, timeLabel } from './days.ts';
import { frameHead, placeFacts } from './ReservePage.tsx';
import { strings } from './strings.ts';

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly visit: PublicTableVisit }
  | { readonly status: 'error'; readonly message: string };

/** The manage page: the lookup form until a key opens a reservation, then the reservation. */
export function ManageReservation({
  client,
  page,
  locale,
  token,
  isWelcome,
}: {
  readonly client: TableClient;
  readonly page: PublicTablePage;
  readonly locale: string;
  readonly token: string | undefined;
  readonly isWelcome: boolean;
}) {
  const [guest, setGuest] = useState<GuestKey | undefined>(token === undefined ? undefined : { token });
  const [read, setRead] = useState<{ readonly key: string; readonly loaded: Loaded } | undefined>();
  const guestKey = JSON.stringify(guest ?? null);
  const loaded: Loaded = read?.key === guestKey ? read.loaded : { status: 'loading' };
  const setLoaded = (next: Loaded) => {
    setRead({ key: guestKey, loaded: next });
  };
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (guest === undefined) return;
    let current = true;
    const key = JSON.stringify(guest);
    client.visit(page.key, guest).then(
      (visit) => {
        if (current) setRead({ key, loaded: { status: 'ready', visit } });
      },
      (error: unknown) => {
        if (current)
          setRead({ key, loaded: { status: 'error', message: isDataError(error) ? error.message : strings.offline } });
      },
    );
    return () => {
      current = false;
    };
  }, [client, page.key, guest, attempt]);

  if (guest === undefined) return <FindReservation client={client} page={page} onFound={setGuest} />;
  if (loaded.status === 'loading')
    return <BookingMessage title={strings.yourReservation} isLoading page="booking_manage" />;
  if (loaded.status === 'error') {
    // Never a dead end: Try again, or find it by the code and email (the manage page without a link).
    return (
      <BookingMessage
        title={strings.yourReservation}
        page="booking_manage"
        onRetry={() => {
          setRead(undefined);
          setAttempt((count) => count + 1);
        }}
        link={{ label: strings.findTitle, href: `/r/${encodeURIComponent(page.key)}/manage` }}
      >
        {loaded.message}
      </BookingMessage>
    );
  }
  const { visit } = loaded;
  const zone = page.place.timeZone;
  const label = (instant: string) => timeLabel(instant, zone, locale);
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone })
      .formatToParts(new Date(visit.start))
      .map((part) => [part.type, part.value]),
  );
  const when = `${longDay(visit.start, zone, locale)}, ${label(visit.start)}`;
  const summary = `Table for ${String(visit.party)} at ${page.business.name}`;
  const address = [page.place.addressLine, page.place.city, page.place.postcode]
    .filter((part) => part !== undefined)
    .join(', ');
  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${compact(visit.start)}/${compact(visit.end)}`,
    details: `${strings.code}: ${visit.lookupCode}`,
    location: address,
  }).toString()}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary,
    startdt: visit.start,
    enddt: visit.end,
    body: `${strings.code}: ${visit.lookupCode}`,
    location: address,
  }).toString()}`;
  const state = visit.status === 'cancelled' ? 'cancelled' : new Date(visit.end).getTime() < now ? 'past' : 'confirmed';
  const isOpen = visit.status === 'booked' || visit.status === 'confirmed';
  const cancel = async (reason: string): Promise<CancelOutcome> => {
    try {
      const after = await client.cancel(page.key, guest, reason.trim() === '' ? undefined : reason);
      setLoaded({ status: 'ready', visit: after });
      setNotice(strings.cancelled);
      return { kind: 'done' };
    } catch (error) {
      return { kind: 'failed', message: isDataError(error) ? error.message : strings.offline };
    }
  };
  return (
    <BookingReceipt
      state={state}
      isWelcome={isWelcome}
      hostName={page.business.name}
      date={{ weekday: dateParts.weekday ?? '', day: dateParts.day ?? '', month: dateParts.month ?? '' }}
      range={`${label(visit.start)} – ${label(visit.end)}`}
      when={when}
      summary={{ what: strings.guestsCount(visit.party), who: strings.withRestaurant(page.business.name) }}
      facts={[
        { term: strings.code, description: visit.lookupCode },
        { term: strings.party, description: strings.guestsCount(visit.party) },
        ...(address === '' ? [] : [{ term: strings.where, description: `${page.place.name}, ${address}` }]),
        ...(visit.note === undefined ? [] : [{ term: strings.note, description: visit.note }]),
      ]}
      {...(state === 'confirmed' && token !== undefined
        ? {
            calendars: {
              google,
              outlook,
              // The file comes by POST with the link's token (never in an address), then saves as a download.
              ics: () => {
                client.ics(page.key, { token }).then(
                  (file) => {
                    const href = URL.createObjectURL(file);
                    const link = globalThis.document.createElement('a');
                    link.href = href;
                    link.download = 'reservation.ics';
                    link.click();
                    globalThis.setTimeout(() => URL.revokeObjectURL(href), 0);
                  },
                  () => {
                    setNotice(undefined);
                    setProblem(strings.addToCalendarFailed);
                  },
                );
              },
            },
          }
        : {})}
      again={{ label: strings.reserveAgain, href: `/r/${encodeURIComponent(page.key)}` }}
      brand={{ href: poweredByHref('booking_manage', undefined), label: strings.poweredBy }}
      {...(problem !== undefined
        ? {
            notice: (
              <Callout tone="danger" isAnnounced>
                {problem}
              </Callout>
            ),
          }
        : notice === undefined
          ? isOpen && visit.cancelUntil === undefined && state === 'confirmed'
            ? { notice: <Callout tone="info">{strings.tooLate(page.place.phone)}</Callout> }
            : {}
          : {
              notice: (
                <Callout tone="success" isAnnounced>
                  {notice}
                </Callout>
              ),
            })}
      {...(state === 'confirmed' && isOpen && visit.cancelUntil !== undefined
        ? {
            changes: (
              <BookingChanges
                labels={{
                  move: strings.change,
                  cancel: strings.cancel,
                  keep: strings.keep,
                  cancelTitle: strings.cancelTitle(visit.party, page.business.name),
                  cancelText: strings.cancelBody(when),
                }}
                title={summary}
                hostName={page.business.name}
                guests={[]}
                maxGuests={0}
                canMove={visit.changeUntil !== undefined && page.taking}
                move={
                  <ChangePicker
                    client={client}
                    page={page}
                    locale={locale}
                    visit={visit}
                    onChange={async (start, party) => {
                      const after = await client.change(page.key, guest, { start, party });
                      setLoaded({ status: 'ready', visit: after });
                      setNotice(strings.changed);
                    }}
                  />
                }
                onInvite={() => Promise.resolve({ kind: 'failed', message: '' })}
                onRemove={() => Promise.resolve({ kind: 'failed', message: '' })}
                onCancel={cancel}
              />
            ),
          }
        : {})}
    />
  );
}

/** The new time and party, as the reservation page picks them, and Save change. */
function ChangePicker({
  client,
  page,
  locale,
  visit,
  onChange,
}: {
  readonly client: TableClient;
  readonly page: PublicTablePage;
  readonly locale: string;
  readonly visit: PublicTableVisit;
  readonly onChange: (start: string, party: number) => Promise<void>;
}) {
  const zone = page.place.timeZone;
  const days = useMemo(() => openDays(page), [page]);
  const [party, setParty] = useState(visit.party);
  const [day, setDay] = useState(placeDate(visit.start, zone));
  const [time, setTime] = useState<string | undefined>();
  const [answer, setAnswer] = useState<
    { readonly key: string; readonly times: readonly string[]; readonly problem?: string } | undefined
  >();
  const current = answer?.key === `${String(party)}|${day}` ? answer : undefined;
  const times = current?.times;
  const [problem, setProblem] = useState<string | undefined>();
  const [isSaving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const key = `${String(party)}|${day}`;
    client.times(page.key, { party, date: day }, controller.signal).then(
      (read) => {
        setAnswer({ key, times: read.times });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setAnswer({ key, times: [], problem: isDataError(error) ? error.message : strings.offline });
      },
    );
    return () => {
      controller.abort();
    };
  }, [client, page.key, party, day]);
  const label = (instant: string) => timeLabel(instant, zone, locale);
  const groups = services(times ?? [], zone, rangesOn(page.hours, day));
  const slotsOf = (list: readonly string[]) =>
    list.map((instant) => ({
      id: instant,
      label: label(instant),
      name: `${label(instant)}, ${shortDay(day, locale)}`,
    }));
  return (
    <>
      {problem !== undefined && (
        <Callout tone="danger" isAnnounced>
          {problem}
        </Callout>
      )}
      <ChoiceChips
        label={strings.guests}
        choices={Array.from({ length: page.partyMax - page.partyMin + 1 }, (_, index) => ({
          id: String(page.partyMin + index),
          label: String(page.partyMin + index),
        }))}
        selected={[String(party)]}
        isSingle
        onChange={(next) => {
          const size = Number(next[0]);
          if (Number.isInteger(size) && size > 0) {
            setParty(size);
            setTime(undefined);
          }
        }}
      />
      <DayStrip
        days={days}
        value={day}
        onChange={(next) => {
          setDay(next);
          setTime(undefined);
        }}
      />
      {current?.problem !== undefined ? (
        // The real reason the times didn't load (offline, too many tries), never "No tables left".
        <Callout tone="danger" isAnnounced>
          {current.problem}
        </Callout>
      ) : times === undefined || groups.length === 0 ? (
        <SlotList
          heading={shortDay(day, locale)}
          layout="grid"
          slots={[]}
          value={undefined}
          onChange={setTime}
          isLoading={times === undefined}
          empty={strings.noTimes}
        />
      ) : (
        groups.map((group) => (
          <SlotList
            key={group.key}
            heading={
              group.heading.kind === 'named'
                ? group.heading.text
                : group.heading.kind === 'lunch'
                  ? strings.lunch
                  : group.heading.kind === 'dinner'
                    ? strings.dinner
                    : shortDay(day, locale)
            }
            layout="grid"
            slots={slotsOf(group.times)}
            value={time}
            onChange={setTime}
            drawKey={`${day}|${String(party)}|${group.key}`}
          />
        ))
      )}
      <Button
        variant="primary"
        size="lg"
        isFullWidth="center"
        isDisabled={time === undefined}
        isPending={isSaving}
        onPress={() => {
          if (time === undefined) return;
          setSaving(true);
          setProblem(undefined);
          onChange(time, party)
            .catch((error: unknown) => {
              const next = isDataError(error) ? ((error as TableRefusal).next ?? []) : [];
              setProblem(
                isDataError(error)
                  ? next.length > 0
                    ? `${error.message} ${next.map(label).join(', ')}`
                    : error.message
                  : strings.offline,
              );
            })
            .finally(() => {
              setSaving(false);
            });
        }}
      >
        {time === undefined ? strings.saveChange : `${strings.saveChange}: ${shortDay(day, locale)}, ${label(time)}`}
      </Button>
    </>
  );
}

/** Finding a reservation without the link: the code and the email it was made with. */
function FindReservation({
  client,
  page,
  onFound,
}: {
  readonly client: TableClient;
  readonly page: PublicTablePage;
  readonly onFound: (guest: GuestKey) => void;
}) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [isFinding, setFinding] = useState(false);
  const find = () => {
    if (isFinding) return;
    setFinding(true);
    setProblem(undefined);
    const key = { code: code.trim(), email: email.trim() };
    client
      .visit(page.key, key)
      .then(() => {
        onFound(key);
      })
      .catch((error: unknown) => {
        setProblem(isDataError(error) ? error.message : strings.offline);
      })
      .finally(() => {
        setFinding(false);
      });
  };
  return (
    <BookingFrame
      {...frameHead(page)}

      description={strings.findIntro}
      facts={placeFacts(page)}
      heading={strings.findTitle}
    >
      {/* The pane lays the fields out in its own rhythm; Enter in either field finds, as a form would. */}
      {problem !== undefined && (
        <Callout tone="danger" isAnnounced>
          {problem}
        </Callout>
      )}
      <Field
        label={strings.codeLabel}
        name="code"
        value={code}
        onChange={setCode}
        onSubmit={find}
        autoComplete="off"
        maxLength={12}
        isRequired
      />
      <Field
        label={strings.emailLabel}
        name="email"
        type="email"
        value={email}
        onChange={setEmail}
        onSubmit={find}
        autoComplete="email"
        isRequired
      />
      <Button variant="primary" isFullWidth="center" isPending={isFinding} onPress={find}>
        {isFinding ? strings.finding : strings.find}
      </Button>
    </BookingFrame>
  );
}
