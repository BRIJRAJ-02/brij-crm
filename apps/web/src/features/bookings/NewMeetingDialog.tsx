// Brief
// Purpose: Book someone in from a span drawn on Bookings › Calendar, or from New (spec 0027, AC-709 to AC-711, and its follow ups).
// Main task: pick someone from People as you type (or name someone new) and their email, set the time, then Book it.
// Leaves out: Timefix's own invitation email (the calendar invites them), and required person fields.
import {
  isDataError,
  type BookingPageView,
  type CalendarListState,
  type CalendarsHeld,
  type PageDestinationState,
  type RecordSearch,
  type RecordSearchState,
  type SearchResult,
} from '@crm/data';
import { usePageDestination } from '@crm/data/react';
import {
  AttributeEditor,
  Avatar,
  Button,
  Callout,
  DatePicker,
  Field,
  Form,
  InfoTip,
  Modal,
  Select,
  SuggestionList,
  suggestionOptionId,
  useFormatSettings,
  type FieldAttribute,
  type FormRefusal,
  type SuggestionRow,
} from '@crm/ui';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { calendarOptions } from '../calendars/calendar-options.ts';
import { isCalendarInUse } from '../calendars/in-use.ts';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { zoneDisplay } from '../../public/booking/time.ts';
import { instantOf, type DrawnSpan } from './span.ts';
import { SpanTimes } from './SpanTimes.tsx';
import { strings } from './strings.ts';

/** The fields a refusal may land on, by the server's names; any other (the time, the page) shows above them. */
const FIELDS = ['name', 'email', 'message', 'calendarId'] as const;

/** The longest meeting a member books in (the server holds the same bound). */
const MAX_MINUTES = 480;

/** The most people Also invite takes (the server holds the same bound). */
const MAX_GUESTS = 10;

/** How many people from People show under With at once. */
const SHOWN_PEOPLE = 6;

/**
 * Also invite, drawn by the field set's Email editor with several values: each address a removable chip, and an 11th
 * refused in the add field with what was typed kept.
 */
const GUESTS: FieldAttribute = {
  id: 'guests',
  name: strings.alsoInvite,
  type: 'email',
  allowMultiple: true,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
  limit: { count: MAX_GUESTS, message: strings.guestsFull(MAX_GUESTS) },
};

/** What Book it sends. */
export interface NewMeeting {
  /** Minted once per dialog: a second Book it after a lost answer is the same booking. */
  readonly idempotencyKey: string;
  readonly pageId: string;
  readonly start: string;
  readonly minutes: number;
  readonly name: string;
  readonly email: string;
  readonly timeZone: string;
  readonly guests: readonly string[];
  readonly message?: string;
  /** The member's own calendar the event goes on, only when they picked one; else the page's, else their default. */
  readonly calendarId?: string;
  /** Who hosts it, when not the member: a colleague they Manage, on one of that colleague's pages (AC-1272). */
  readonly forMemberId?: string;
}

/** Props for NewMeetingDialog. */
export interface NewMeetingDialogProps {
  readonly span: DrawnSpan;
  /** Moves the span (From and To), so the week's ghost follows and a clash can be fixed in place. */
  readonly onSpanChange: (span: DrawnSpan) => void;
  readonly locale: string;
  /** Whether the member has a calendar connected: without one, nobody is invited yet. */
  readonly hasCalendar: boolean;
  /** The member's live pages: the booking goes on one. */
  readonly pages: readonly BookingPageView[];
  /** Mints the booking's idempotency key, once per dialog. */
  readonly newKey: () => string;
  /** Books it; settles once it is made, throws a data error on a refusal. */
  readonly onBook: (meeting: NewMeeting) => Promise<void>;
  /** Closes the dialog: after Book it, or Close. */
  readonly onClose: () => void;
  /**
   * People as the member types in With: the record picker's search over People, made once as the dialog opens and
   * let go as it closes. Left out when they can't see People, and With is a plain name.
   */
  readonly people?: (() => RecordSearch) | undefined;
  /** The member's own accounts and calendars: Calendar shows when two or more can take the event. */
  readonly calendars?: CalendarListState | undefined;
  /** A booking page's own "Add events to": Calendar starts on it when it is one of the member's calendars. */
  readonly pageDestination?: ((pageId: string) => CalendarsHeld<PageDestinationState>) | undefined;
  /**
   * The colleagues the member Manages (spec 0037, AC-1272): For shows first, Me then them, when there is anyone.
   * For a colleague the booking goes on one of their pages, on their calendars (never one the member picks).
   */
  readonly forPeople?: readonly { readonly id: string; readonly name: string }[] | undefined;
}

/** The For picker's own choice: the member themself. */
const ME = '@me';

/** Someone from People to book in: their record, name and the email to invite them at. */
interface Person {
  readonly recordId: string;
  readonly name: string;
  readonly email: string;
  readonly result: SearchResult;
}

/** The results that carry an email, as people to book in (one with no email can't be invited). */
function peopleOf(results: readonly SearchResult[]): readonly Person[] {
  return results
    .flatMap((result) =>
      result.detail?.includes('@') === true && result.ref.name !== ''
        ? [{ recordId: result.ref.recordId, name: result.ref.name, email: result.detail, result }]
        : [],
    )
    .slice(0, SHOWN_PEOPLE);
}

const noSubscribe = () => () => undefined;

/**
 * The people With offers for what is typed: the answer once it is in, and while the next query is out, the last
 * answer when the text only grew (so the list doesn't blink as each key goes out); nothing for a fresh word.
 */
function usePeople(people: (() => RecordSearch) | undefined, typed: string): readonly Person[] {
  // One search for the dialog's life: made as it opens, let go as it closes.
  const [search] = useState(() => people?.());
  useEffect(
    () => () => {
      search?.dispose();
    },
    [search],
  );
  const state: RecordSearchState | undefined = useSyncExternalStore(search?.subscribe ?? noSubscribe, () =>
    search?.getSnapshot(),
  );
  useEffect(() => {
    if (typed !== '') search?.ask(typed);
  }, [search, typed]);
  const [last, setLast] = useState<{ readonly query: string; readonly people: readonly Person[] }>({
    query: '',
    people: [],
  });
  if (state?.status === 'ready' && state.query !== last.query && state.query !== '') {
    setLast({ query: state.query, people: peopleOf(state.results) });
  }
  if (typed === '') return [];
  if (last.query === typed) return last.people;
  return last.query !== '' && typed.toLowerCase().startsWith(last.query.toLowerCase()) ? last.people : [];
}

/** New meeting: with whom, their email and zone, on which page and calendar, how long, who else, and a message. */
export function NewMeetingDialog({
  span,
  onSpanChange,
  locale,
  hasCalendar,
  pages,
  newKey,
  onBook,
  onClose,
  people,
  calendars,
  pageDestination,
  forPeople = [],
}: NewMeetingDialogProps) {
  const formId = useId();
  const listId = useId();
  const withRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [idempotencyKey] = useState(newKey);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // The member's zone draws the span; the guest's zone starts as theirs too, until it is picked.
  const { timeZone: memberTimeZone } = useFormatSettings();
  const [timeZone, setTimeZone] = useState(memberTimeZone);
  const [forId, setForId] = useState(ME);
  const forName = forId === ME ? undefined : forPeople.find((person) => person.id === forId)?.name;
  // For a colleague, only their pages (the server books on one of theirs alone); for the member, theirs as before.
  const choices = forId === ME ? pages : pages.filter((page) => page.ownerMemberId === forId);
  const [picked, setPageId] = useState(pages[0]?.id ?? '');
  const pageId = choices.some((page) => page.id === picked) ? picked : (choices[0]?.id ?? '');
  const [guests, setGuests] = useState<readonly string[]>([]);
  const [guestsError, setGuestsError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  // A calendar the member picked; undefined follows the page's own, else their default (the server's own rule).
  const [calendarId, setCalendarId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const start = instantOf(span.dayKey, span.startMinute, memberTimeZone);
  const minutes = span.endMinute - span.startMinute;
  // Once anything is typed, a stray click outside won't throw it away; Cancel and Esc still do.
  const isDirty = [name, email, message].some((value) => value.trim() !== '') || guests.length > 0;
  const zones = useMemo(() => zoneItems(timeZone, new Date()), [timeZone]);
  // People as you type in With: shown under it until one is picked, Esc puts them away, or focus leaves.
  const typed = name.trim();
  const found = usePeople(people, typed);
  const [putAway, setPutAway] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(-1);
  // Whether the arrows, not a resting pointer, put the highlight where it is: only then does Tab take the row.
  const [isKeyed, setKeyed] = useState(false);
  const shown = putAway === typed ? [] : found;
  const isListOpen = shown.length > 0 && !busy;
  const activeIndex = active < shown.length ? active : -1;
  // Every calendar that takes events; CalendarChoice offers those in use and the page's own, with two or more.
  const writable = (calendars?.status === 'ready' ? calendars.accounts : []).flatMap((account) =>
    account.calendars.filter((calendar) => calendar.canBeDestination),
  );

  const pick = (person: Person) => {
    setName(person.name);
    setEmail(person.email);
    // The list stays away for the name picked, until the member types on.
    setPutAway(person.name.trim());
    setActive(-1);
    setKeyed(false);
  };

  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isListOpen || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setKeyed(true);
      setActive(
        activeIndex === -1 && step === -1 ? shown.length - 1 : (activeIndex + step + shown.length) % shown.length,
      );
      return;
    }
    if (event.key === 'Enter' && activeIndex !== -1) {
      const person = shown[activeIndex];
      if (person === undefined) return;
      // The pick, never a submit: Book it waits for the member.
      event.preventDefault();
      pick(person);
      return;
    }
    // Tab on a row the arrows highlighted takes it, as a combobox does, and goes on to Email (filled with theirs).
    // Shift+Tab goes back with nothing picked, and a row under a resting pointer is never taken by Tab.
    if (event.key === 'Tab' && !event.shiftKey && isKeyed && activeIndex !== -1) {
      const person = shown[activeIndex];
      if (person !== undefined) pick(person);
      return;
    }
    if (event.key === 'Escape') {
      // Esc puts the list away; the dialog stays (a second Esc closes it).
      event.preventDefault();
      event.stopPropagation();
      setPutAway(typed);
      setActive(-1);
    }
  };

  const book = () => {
    if (busy) return;
    const missing: FormRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'VALUE_REQUIRED', message: strings.whoWith, attributeId: 'name' }] : []),
      ...(email.trim() === '' ? [{ code: 'VALUE_REQUIRED', message: strings.whatEmail, attributeId: 'email' }] : []),
    ];
    if (missing.length > 0) {
      setRefusals(missing);
      return;
    }
    if (pageId === '') return;
    setBusy(true);
    setRefusals([]);
    setGuestsError(undefined);
    onBook({
      idempotencyKey,
      pageId,
      start: start.toISOString(),
      minutes,
      name: name.trim(),
      email: email.trim(),
      timeZone,
      guests,
      ...(message.trim() === '' ? {} : { message: message.trim() }),
      // Sent only when picked, and only while Calendar is offered: never for a colleague (their calendars stay theirs).
      ...(calendarId === undefined || writable.length < 2 || forId !== ME ? {} : { calendarId }),
      ...(forId === ME ? {} : { forMemberId: forId }),
    }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        const all = refusalsOf(error);
        // A guest's address is refused under Also invite, which the field set draws (no Form field holds it).
        setGuestsError(all.find((refusal) => refusal.attributeId === 'guests')?.message);
        setRefusals(all.filter((refusal) => refusal.attributeId !== 'guests'));
      },
    );
  };

  return (
    <Modal
      title={strings.newMeeting}
      isOpen
      isDismissable={!isDirty}
      isBusy={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={busy} isDisabled={pageId === ''}>
            {busy ? strings.booking : strings.bookIt}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={busy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={book}
        label={strings.newMeeting}
        focusesFirstField
      >
        {/* First, so it is read before the form is filled in, and never below the dialog's fold. */}
        {!hasCalendar && forId === ME && <Callout tone="info">{strings.noCalendar}</Callout>}
        <Field
          ref={withRef}
          label={strings.with}
          name="name"
          placeholder={people === undefined ? strings.theirName : strings.withPlaceholder}
          autoComplete="off"
          isRequired
          maxLength={200}
          value={name}
          onChange={(next) => {
            setName(next);
            setActive(-1);
            setKeyed(false);
          }}
          onBlur={() => {
            setPutAway(typed);
          }}
          onKeyDown={keyDown}
          {...(people === undefined
            ? {}
            : {
                combobox: {
                  listId,
                  isExpanded: isListOpen,
                  ...(isListOpen && activeIndex !== -1 ? { activeId: suggestionOptionId(listId, activeIndex) } : {}),
                },
              })}
        />
        {isListOpen && (
          <SuggestionList
            anchorRef={withRef}
            id={listId}
            label={strings.fromPeople}
            rows={shown.map((person): SuggestionRow => ({
              key: person.recordId,
              leading: (
                <Avatar
                  name={person.name}
                  id={person.recordId}
                  size="xs"
                  isDecorative
                  {...(person.result.ref.imageSrc === undefined ? {} : { src: person.result.ref.imageSrc })}
                  {...(person.result.ref.hue === undefined ? {} : { hue: person.result.ref.hue })}
                />
              ),
              label: person.name,
              detail: person.email,
            }))}
            activeIndex={activeIndex}
            emptyText={strings.noPeopleMatch}
            onPick={(index) => {
              const person = shown[index];
              if (person !== undefined) pick(person);
            }}
            onHighlight={(index) => {
              setActive(index);
              setKeyed(false);
            }}
          />
        )}
        <Field
          label={strings.email}
          name="email"
          type="email"
          placeholder={strings.emailPlaceholder}
          autoComplete="off"
          isRequired
          maxLength={254}
          value={email}
          onChange={setEmail}
        />
        {/* Who it is with, then their zone, together: the zone only sets how their invitation reads the time. */}
        <Select
          label={strings.theirTimeZone}
          hint={strings.theirTimeZoneHint}
          items={zones}
          filter={zoneMatches}
          isSearchable
          value={timeZone}
          isDisabled={busy}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
        {/* The day moves in place (Calendly's and Basecamp's new event): closing to pick another was a dead end. */}
        <DatePicker
          label={strings.day}
          value={span.dayKey}
          isRequired
          isDisabled={busy}
          onChange={(day) => {
            if (day !== null) onSpanChange({ ...span, dayKey: day });
          }}
        />
        <SpanTimes
          span={span}
          locale={locale}
          onChange={onSpanChange}
          maxMinutes={MAX_MINUTES}
          showsLength
          // From and To are on the member's clock; Their time zone above only sets the guest's invite.
          hint={strings.timesIn(zoneDisplay(memberTimeZone, start.getTime()))}
          isDisabled={busy}
        />
        {/* Whose meeting: after the guest and the time, since most are the member's own (AC-1272). */}
        {forPeople.length > 0 && (
          <Select
            label={strings.forWhom}
            {...(forName === undefined ? {} : { hint: strings.forHint(forName) })}
            items={[
              { id: ME, label: strings.forMe },
              ...forPeople.map((person) => ({
                id: person.id,
                label: person.name,
                leading: <Avatar name={person.name} id={person.id} size="xs" isDecorative />,
              })),
            ]}
            value={forId}
            isDisabled={busy}
            isSearchable={forPeople.length > 8}
            onChange={(id) => setForId(id ?? ME)}
          />
        )}
        {forName !== undefined && choices.length === 0 && (
          <Callout tone="warning">{strings.noPagesFor(forName)}</Callout>
        )}
        {choices.length > 1 && (
          <Select
            label={strings.about}
            info={
              <InfoTip label={strings.about} example={strings.aboutExample}>
                {strings.aboutHelp}
              </InfoTip>
            }
            items={choices.map((page) => ({ id: page.id, label: page.title }))}
            value={pageId}
            isDisabled={busy}
            onChange={(id) => {
              if (id !== null) setPageId(id);
            }}
          />
        )}
        {/* Where the event goes, only with two or more calendars that take events (spec 0024 milestone 5). */}
        {calendars?.status === 'ready' && writable.length > 1 && pageDestination !== undefined && forId === ME && (
          <CalendarChoice
            calendars={calendars}
            destination={pageDestination(pageId)}
            calendarId={calendarId}
            onChange={setCalendarId}
            isDisabled={busy}
          />
        )}
        <AttributeEditor
          attribute={GUESTS}
          value={guests.length === 0 ? null : guests}
          surface="form"
          // Held while Book it is out, as Day, the times and Calendar are: the guests sent are the ones shown.
          isDisabled={busy}
          onCommit={(value) => {
            // The Email editor commits the whole list of addresses, checked by the email type.
            const next: readonly string[] = Array.isArray(value)
              ? value.filter((item): item is string => typeof item === 'string')
              : typeof value === 'string'
                ? [value]
                : [];
            setGuestsError(undefined);
            setGuests(next);
          }}
          {...(guestsError === undefined ? {} : { error: guestsError })}
        />
        <Field
          label={strings.message}
          name="message"
          placeholder={strings.messagePlaceholder}
          isMultiline
          maxLength={1000}
          value={message}
          onChange={setMessage}
        />
      </Form>
    </Modal>
  );
}

/**
 * Calendar: the member's calendars in use that take events, each in its colour (an account with two or more under
 * its address), and the page's own "Add events to" even when not in use; nothing with fewer than two to choose
 * between. It starts on the page's own when that is one of theirs, else their default, as the server picks with no
 * choice made; only a pick is sent.
 */
function CalendarChoice({
  calendars,
  destination,
  calendarId,
  onChange,
  isDisabled,
}: {
  readonly calendars: Extract<CalendarListState, { readonly status: 'ready' }>;
  readonly destination: CalendarsHeld<PageDestinationState>;
  readonly calendarId: string | undefined;
  readonly onChange: (calendarId: string) => void;
  readonly isDisabled: boolean;
}) {
  const held = usePageDestination(destination);
  const pageOwn = held.status === 'ready' ? held.destination.calendarId : undefined;
  const writable = calendars.accounts.flatMap((account) =>
    account.calendars.filter(
      (calendar) => calendar.canBeDestination && (isCalendarInUse(calendar) || calendar.id === pageOwn),
    ),
  );
  if (writable.length < 2) return null;
  const fallback =
    writable.find((calendar) => calendar.id === pageOwn) ??
    writable.find((calendar) => calendar.isDestination) ??
    writable[0];
  return (
    <Select
      label={strings.calendarChoice}
      items={calendarOptions({
        accounts: calendars.accounts,
        include: (calendar) => calendar.canBeDestination,
        chosen: pageOwn,
      })}
      optionStyle="dot"
      value={calendarId ?? fallback?.id ?? null}
      isDisabled={isDisabled}
      onChange={(id) => {
        if (id !== null) onChange(id);
      }}
    />
  );
}

/** A refusal on its field, or above the form; a guest's under Also invite. */
function refusalsOf(error: unknown): readonly FormRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: strings.bookFailed }];
  const onField = (field: string | undefined) =>
    field === 'guests' || (field !== undefined && (FIELDS as readonly string[]).includes(field)) ? field : undefined;
  const refusals = (error.data?.refusals ?? []).map((refusal): FormRefusal => {
    const field = onField(refusal.field);
    return { code: refusal.code, message: refusal.message, ...(field === undefined ? {} : { attributeId: field }) };
  });
  const issues = (error.data?.issues ?? []).map((issue): FormRefusal => {
    const [first] = issue.path;
    const field = onField(typeof first === 'string' ? first : undefined);
    return { code: error.code, message: issue.message, ...(field === undefined ? {} : { attributeId: field }) };
  });
  const all = [...refusals, ...issues];
  return all.length > 0 ? all : [{ code: error.code, message: error.message }];
}
