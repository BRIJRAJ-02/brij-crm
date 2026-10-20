// Brief
// Purpose: Book someone in from a span drawn on Bookings › Calendar (spec 0027, AC-709 to AC-711).
// Main task: name who it is with and their email, set the time, then Book it: a confirmed booking in the member's own time.
// Leaves out: picking a person from the workspace as you type, and the email invitation (the calendar invites them).
import { isDataError, type BookingPageView } from '@crm/data';
import { Button, Callout, Field, Form, Modal, Select, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { browserZone, timeZones } from '../booking/hours.ts';
import { instantOf, spanNames, type DrawnSpan } from './span.ts';
import { SpanTimes } from './SpanTimes.tsx';
import { strings } from './strings.ts';

/** The fields a refusal may land on, by the server's names; any other (the time, the page) shows above them. */
const FIELDS = ['name', 'email', 'guests', 'message'] as const;

/** The longest meeting a member books in (the server holds the same bound). */
const MAX_MINUTES = 480;

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
}

/** "Name <a@b>, c@d" as emails, lower case, each once. */
export function guestEmails(text: string): readonly string[] {
  const found = text
    .split(/[,;\n]/)
    .map((part) => /<([^>]+)>/.exec(part)?.[1] ?? part)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  return [...new Set(found)];
}

/** New meeting: with whom, their email and zone, on which page, how long, who else, and a message. */
export function NewMeetingDialog({
  span,
  onSpanChange,
  locale,
  hasCalendar,
  pages,
  newKey,
  onBook,
  onClose,
}: NewMeetingDialogProps) {
  const formId = useId();
  const [idempotencyKey] = useState(newKey);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timeZone, setTimeZone] = useState(browserZone);
  const [pageId, setPageId] = useState(pages[0]?.id ?? '');
  const [guests, setGuests] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const { meta } = spanNames(span, locale);
  const start = instantOf(span.dayKey, span.startMinute);
  const minutes = span.endMinute - span.startMinute;
  // Once anything is typed, a stray click outside won't throw it away; Cancel and Esc still do.
  const isDirty = [name, email, guests, message].some((value) => value.trim() !== '');
  const zones = timeZones(timeZone).map((zone) => ({ id: zone, label: zone.replaceAll('_', ' ') }));

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
    setBusy(true);
    setRefusals([]);
    onBook({
      idempotencyKey,
      pageId,
      start: start.toISOString(),
      minutes,
      name: name.trim(),
      email: email.trim(),
      timeZone,
      guests: guestEmails(guests),
      ...(message.trim() === '' ? {} : { message: message.trim() }),
    }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(refusalsOf(error));
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
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={busy} kbd="⌘↵">
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
        <Field
          label={strings.with}
          name="name"
          placeholder={strings.theirName}
          autoComplete="off"
          isRequired
          maxLength={200}
          value={name}
          onChange={setName}
        />
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
        <Field label={strings.when} value={meta} isReadOnly />
        <SpanTimes
          span={span}
          locale={locale}
          onChange={onSpanChange}
          maxMinutes={MAX_MINUTES}
          showsLength
          isDisabled={busy}
        />
        {pages.length > 1 && (
          <Select
            label={strings.about}
            items={pages.map((page) => ({ id: page.id, label: page.title }))}
            value={pageId}
            isDisabled={busy}
            onChange={(id) => {
              if (id !== null) setPageId(id);
            }}
          />
        )}
        <Field
          label={strings.alsoInvite}
          name="guests"
          placeholder={strings.guestPlaceholder}
          hint={strings.alsoInviteHint}
          autoComplete="off"
          value={guests}
          onChange={setGuests}
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
        <Select
          label={strings.theirTimeZone}
          items={zones}
          isSearchable
          value={timeZone}
          isDisabled={busy}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
        {!hasCalendar && <Callout tone="info">{strings.noCalendar}</Callout>}
      </Form>
    </Modal>
  );
}

/** A refusal on its field, or above the form. */
function refusalsOf(error: unknown): readonly FormRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: strings.bookFailed }];
  const onField = (field: string | undefined) =>
    field !== undefined && (FIELDS as readonly string[]).includes(field) ? field : undefined;
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
