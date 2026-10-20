// Brief
// Purpose: Book someone in from a span drawn on Bookings › Calendar (spec 0027, AC-709 to AC-711).
// Main task: name who it is with and their email, then Book it: a confirmed booking in the member's own time.
// Leaves out: picking a person from the workspace as you type, and the email invitation (the calendar invites them).
import { isDataError, type BookingPageView } from '@crm/data';
import { Button, Field, Form, Modal, Select, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { browserZone, timeZones } from '../booking/hours.ts';
import { instantOf, lengthLabel, spanNames, type DrawnSpan } from './span.ts';
import { strings } from './strings.ts';

/** The fields a refusal may land on, by the server's names; any other (the time, the page) shows above them. */
const FIELDS = ['name', 'email', 'guests', 'message'] as const;

/** The lengths offered, beside the one drawn. */
const LENGTHS = [15, 30, 45, 60, 90, 120] as const;

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
  readonly locale: string;
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
export function NewMeetingDialog({ span, locale, pages, newKey, onBook, onClose }: NewMeetingDialogProps) {
  const formId = useId();
  const [idempotencyKey] = useState(newKey);
  const drawn = span.endMinute - span.startMinute;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timeZone, setTimeZone] = useState(browserZone);
  const [pageId, setPageId] = useState(pages[0]?.id ?? '');
  const [minutes, setMinutes] = useState(Math.max(5, drawn));
  const [guests, setGuests] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const { meta } = spanNames({ ...span, endMinute: Math.min(1440, span.startMinute + minutes) }, locale);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const start = instantOf(span.dayKey, span.startMinute);
  const end = new Date(start.getTime() + minutes * 60_000);
  const lengths = [...new Set([...LENGTHS, Math.max(5, drawn)])].sort((a, b) => a - b);
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
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.close}
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
          hint={`${clock.format(start)} – ${clock.format(end)}, ${meta}`}
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
        <Select
          label={strings.theirTimeZone}
          items={zones}
          isSearchable
          value={timeZone}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
        <Select
          label={strings.about}
          items={pages.map((page) => ({ id: page.id, label: page.title }))}
          value={pageId}
          onChange={(id) => {
            if (id !== null) setPageId(id);
          }}
        />
        <Select
          label={strings.length}
          items={lengths.map((each) => ({ id: String(each), label: lengthLabel(each) }))}
          value={String(minutes)}
          onChange={(id) => {
            if (id !== null) setMinutes(Number(id));
          }}
        />
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
