// Brief
// Purpose: the public booking page at /b/<publicKey> (spec 0025, AC-630, AC-632, AC-636): a visitor books time with a member.
// Main task: pick a day and a time in their own zone, give a name and email, book; a time taken meanwhile sends them back to fresh times.
// Leaves out: questions and prefill (milestones 2 and 3), cancel and reschedule (milestone 2) and the CRM app itself.
import { createBookingClient, isDataError, type PublicBookingPage, type PublicBooking } from '@crm/data/booking';
import { AuthLayout, Button, Callout, DescriptionList, EmptyState, Field, Select, Skeleton, SlotPicker } from '@crm/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { strings } from './strings.ts';
import { addDays, dayKey, dayLabels, momentLabel, startOfDay, timeLabel, weekLabel } from './time.ts';

/** Props for the page: its key from the address, the visitor's language and zone, and the clock. */
export interface BookingPageProps {
  readonly publicKey: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage }
  | { readonly state: 'gone' | 'closed' | 'failed' };

type Step =
  | { readonly step: 'pick'; readonly notice?: string }
  | { readonly step: 'details'; readonly start: string; readonly attempt: string }
  | { readonly step: 'done'; readonly booking: PublicBooking };

/** Every zone this browser knows, the visitor's own first when it isn't listed. */
function zones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(current) ? listed : [current, ...listed];
}

/** The page: its facts load once; then the week, the details and the confirmation. */
export function BookingPage({ publicKey, locale, timeZone: detected, now }: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const [startedAt] = useState(now);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const load = useCallback(() => {
    client.page(publicKey).then(
      (page) => setLoaded({ state: 'ready', page }),
      (error: unknown) => {
        const code = isDataError(error) ? error.code : undefined;
        setLoaded({ state: code === 'NOT_FOUND' ? 'gone' : code === 'BOOKING_CLOSED' ? 'closed' : 'failed' });
      },
    );
  }, [client, publicKey]);
  useEffect(load, [load]);

  if (loaded.state === 'loading') {
    return (
      <AuthLayout productName={strings.loading} title={strings.loading} isBusy>
        <Skeleton lines={4} />
      </AuthLayout>
    );
  }
  if (loaded.state !== 'ready') {
    const [title, text] =
      loaded.state === 'gone'
        ? [strings.goneTitle, strings.goneText]
        : loaded.state === 'closed'
          ? [strings.closedTitle, strings.closedText]
          : [strings.failedTitle, strings.failedText];
    return (
      <AuthLayout productName={title} title={title}>
        <EmptyState
          title={title}
          tone={loaded.state === 'failed' ? 'error' : 'empty'}
          {...(loaded.state === 'failed'
            ? {
                onRetry: () => {
                  setLoaded({ state: 'loading' });
                  load();
                },
              }
            : {})}
        >
          {text}
        </EmptyState>
      </AuthLayout>
    );
  }
  return (
    <Booking client={client} page={loaded.page} locale={locale} detected={detected} now={now} startedAt={startedAt} />
  );
}

/** The booking steps for a loaded page. */
function Booking({
  client,
  page,
  locale,
  detected,
  now,
  startedAt,
}: {
  readonly client: ReturnType<typeof createBookingClient>;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
}) {
  const [zone, setZone] = useState(detected);
  const [duration, setDuration] = useState<number>(page.durations[0] ?? 30);
  const today = dayKey(now(), zone);
  const [weekStart, setWeekStart] = useState(today);
  // The answer to the latest range asked for; another range still loading shows as loading.
  const [slots, setSlots] = useState<{
    readonly key: string;
    readonly status: 'ready' | 'error';
    readonly starts: readonly string[];
  }>({ key: '', status: 'ready', starts: [] });
  const [chosenDay, setChosenDay] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<Step>({ step: 'pick' });
  const [reload, setReload] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const lastDay = days[6] ?? weekStart;

  const requestKey = `${weekStart}|${zone}|${String(duration)}|${String(reload)}`;
  useEffect(() => {
    const controller = new AbortController();
    client
      .slots(
        page.publicKey,
        {
          from: new Date(startOfDay(weekStart, zone)).toISOString(),
          to: new Date(startOfDay(addDays(weekStart, 7), zone)).toISOString(),
          duration,
          tz: zone,
        },
        controller.signal,
      )
      .then(
        (answer) => {
          const starts = answer.slots.map((slot) => slot.start);
          setSlots({ key: requestKey, status: 'ready', starts });
          // The next free day, chosen for the visitor.
          const first = starts[0];
          setChosenDay(first === undefined ? undefined : dayKey(Date.parse(first), zone));
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSlots({ key: requestKey, status: 'error', starts: [] });
        },
      );
    return () => controller.abort();
  }, [client, page.publicKey, weekStart, zone, duration, requestKey]);
  const status = slots.key !== requestKey ? 'loading' : slots.status;

  const byDay = new Map<string, string[]>();
  for (const start of status === 'ready' ? slots.starts : []) {
    const key = dayKey(Date.parse(start), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const horizon = dayKey(now() + page.windowDays * 86_400_000, zone);

  if (step.step === 'done') {
    return (
      <AuthLayout
        productName={page.hostName}
        title={strings.confirmedTitle}
        description={strings.confirmedText(page.hostName)}
      >
        <DescriptionList
          layout="stacked"
          items={[
            {
              term: page.title,
              description: `${momentLabel(step.booking.start, zone, locale)} (${zone.replaceAll('_', ' ')})`,
            },
            { term: strings.with, description: page.hostName },
            { term: strings.where, description: whereOf(page) },
          ]}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      productName={page.hostName}
      title={page.title}
      {...(page.description === '' ? {} : { description: page.description })}
    >
      {step.step === 'pick' ? (
        <>
          {step.notice !== undefined && <Callout tone="warning">{step.notice}</Callout>}
          <Callout tone="info">{whereOf(page)}</Callout>
          {page.durations.length > 1 && (
            <Select
              label={strings.length}
              items={page.durations.map((minutes) => ({ id: String(minutes), label: strings.minutes(minutes) }))}
              value={String(duration)}
              onChange={(id) => {
                if (id !== null) setDuration(Number(id));
              }}
            />
          )}
          <Select
            label={strings.zone}
            isSearchable
            items={zones(zone).map((each) => ({ id: each, label: each.replaceAll('_', ' ') }))}
            value={zone}
            onChange={(id) => {
              if (id !== null) setZone(id);
            }}
          />
          <SlotPicker
            weekLabel={weekLabel(weekStart, lastDay, locale)}
            days={days.map((key) => ({
              id: key,
              ...dayLabels(key, locale),
              hasSlots: (byDay.get(key) ?? []).length > 0,
            }))}
            {...(chosenDay === undefined ? {} : { selectedDayId: chosenDay })}
            onSelectDay={setChosenDay}
            slots={(chosenDay === undefined ? [] : (byDay.get(chosenDay) ?? [])).map((start) => ({
              id: start,
              label: timeLabel(start, zone, locale),
            }))}
            onPickSlot={(start) => setStep({ step: 'details', start, attempt: crypto.randomUUID() })}
            onPreviousWeek={() =>
              setWeekStart((current) => (addDays(current, -7) < today ? today : addDays(current, -7)))
            }
            onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
            canGoBack={weekStart > today}
            canGoForward={addDays(weekStart, 7) <= horizon}
            status={status}
            onRetry={() => setReload((count) => count + 1)}
          />
        </>
      ) : (
        <Details
          client={client}
          page={page}
          start={step.start}
          attempt={step.attempt}
          duration={duration}
          zone={zone}
          locale={locale}
          startedAt={startedAt}
          onBack={(notice) => {
            setStep(notice === undefined ? { step: 'pick' } : { step: 'pick', notice });
            setReload((count) => count + 1);
          }}
          onBooked={(booking) => setStep({ step: 'done', booking })}
        />
      )}
    </AuthLayout>
  );
}

/** Where the meeting happens, as one sentence. */
function whereOf(page: PublicBookingPage): string {
  switch (page.location.type) {
    case 'video':
      return strings.location.video;
    case 'phone':
      return strings.location.phone;
    default:
      return page.location.value;
  }
}

/** The visitor's details for the chosen time, and Book. */
function Details({
  client,
  page,
  start,
  attempt,
  duration,
  zone,
  locale,
  startedAt,
  onBack,
  onBooked,
}: {
  readonly client: ReturnType<typeof createBookingClient>;
  readonly page: PublicBookingPage;
  readonly start: string;
  readonly attempt: string;
  readonly duration: number;
  readonly zone: string;
  readonly locale: string;
  readonly startedAt: number;
  readonly onBack: (notice?: string) => void;
  readonly onBooked: (booking: PublicBooking) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const book = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    setFieldErrors({});
    client
      .book(page.publicKey, {
        idempotencyKey: attempt,
        start,
        duration: duration as 15 | 30 | 45 | 60 | 90,
        name,
        email,
        timeZone: zone,
        ...(page.location.type === 'phone' ? { phone } : {}),
        website: '',
        startedAt,
      })
      .then(onBooked, (error: unknown) => {
        setBusy(false);
        if (!isDataError(error)) {
          setFailure(strings.failedText);
          return;
        }
        if (error.code === 'SLOT_TAKEN') {
          onBack(strings.taken);
          return;
        }
        const issues = error.data?.issues ?? [];
        const refusals = error.data?.refusals ?? [];
        const byField: Record<string, string> = {};
        for (const issue of issues) {
          const field = issue.path[0];
          if (typeof field === 'string' && byField[field] === undefined) byField[field] = issue.message;
        }
        for (const refusal of refusals) {
          if (refusal.field !== undefined && byField[refusal.field] === undefined)
            byField[refusal.field] = refusal.message;
        }
        setFieldErrors(byField);
        if (Object.keys(byField).length === 0) setFailure(error.message);
      });
  };
  return (
    <>
      <Callout tone="info" title={momentLabel(start, zone, locale)}>
        {`${strings.minutes(duration)}, ${zone.replaceAll('_', ' ')}`}
      </Callout>
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={strings.name}
        value={name}
        onChange={setName}
        autoComplete="name"
        maxLength={200}
        isRequired
        {...(fieldErrors.name === undefined ? {} : { error: fieldErrors.name })}
      />
      <Field
        label={strings.email}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        maxLength={254}
        isRequired
        onSubmit={page.location.type === 'phone' ? undefined : book}
        {...(fieldErrors.email === undefined ? {} : { error: fieldErrors.email })}
      />
      {page.location.type === 'phone' && (
        <Field
          label={strings.phone}
          hint={strings.phoneHint}
          type="tel"
          value={phone}
          onChange={setPhone}
          autoComplete="tel"
          maxLength={40}
          isRequired
          onSubmit={book}
          {...(fieldErrors.phone === undefined ? {} : { error: fieldErrors.phone })}
        />
      )}
      <Button variant="primary" isFullWidth="center" size="lg" isPending={isBusy} onPress={book}>
        {isBusy ? strings.booking : strings.book}
      </Button>
      <Button variant="ghost" icon="chevron-left" isDisabled={isBusy} onPress={() => onBack()}>
        {strings.back}
      </Button>
    </>
  );
}
