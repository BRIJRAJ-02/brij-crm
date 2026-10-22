// Brief
// Purpose: the card a span drawn on Bookings › Calendar opens (spec 0027, AC-702 to AC-704): what the time is for.
// Main task: pick Book someone in, Block this time (once or every week) or Reserve it for link only pages; saving closes it.
// Leaves out: drawing (WeekCalendar), what a block does to slots (the server), and the New meeting dialog's form.
import { isDataError, type TimeBlockKind, type TimeBlockRepeat } from '@crm/data';
import {
  Button,
  ButtonLink,
  Callout,
  Field,
  Radio,
  RadioGroup,
  Select,
  SpanCard,
  useFormatSettings,
  type SpanCardChoice,
} from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';
import { spanNames, type DrawnSpan } from './span.ts';
import { SpanTimes } from './SpanTimes.tsx';
import { dayStart } from './week.ts';

/** What the member closes the span as. */
export interface CloseInput {
  readonly kind: TimeBlockKind;
  readonly repeat: TimeBlockRepeat;
  readonly label?: string;
  /** A hold for one private page; absent holds for any. */
  readonly pageId?: string;
}

/** Props for DrawCard. */
export interface DrawCardProps {
  readonly span: DrawnSpan;
  readonly locale: string;
  /** The member's link only pages, for reserved time's choice. */
  readonly privatePages: readonly { readonly id: string; readonly title: string }[];
  /** Where a link only page is made (Captures › Links), offered while the member has none. */
  readonly createLinkOnlyHref?: string;
  /** Confirmed bookings inside the span: they stay booked, and the card says so. */
  readonly overlapping: number;
  /** Moves or resizes the span (From and To, for the keyboard and for fine changes). */
  readonly onSpanChange: (span: DrawnSpan) => void;
  /** Closes the time; settles once the server has it (the screen then closes the card), throws a data error on a refusal. */
  readonly onClose: (input: CloseInput) => Promise<void>;
  /** Book someone in: opens the New meeting dialog for the span; absent when it can't be booked (it has begun, no page). */
  readonly onBook?: () => void;
}

type Mode = { readonly kind: 'choose' } | { readonly kind: 'block' } | { readonly kind: 'hold' };

/** Any link only page: reserved time's shared choice. */
const ANY_PAGE = 'any';

/** The drawn span's card: its choices, then the picked one's form; saving closes it (the screen does). */
export function DrawCard({
  span,
  locale,
  privatePages,
  createLinkOnlyHref,
  overlapping,
  onSpanChange,
  onClose,
  onBook,
}: DrawCardProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  // Saving: the span, Back and the form wait, so nothing changes under the save.
  const [pending, setPending] = useState(false);
  // The member's zone, the one the week is drawn in.
  const { timeZone } = useFormatSettings();
  const { title, meta } = spanNames(span, locale, timeZone);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dayStart(span.dayKey));
  const back = () => setMode({ kind: 'choose' });

  if (mode.kind === 'block' || mode.kind === 'hold') {
    const isHold = mode.kind === 'hold';
    return (
      <SpanCard title={title} meta={meta} onBack={back} isBusy={pending} focusKey={mode.kind}>
        {overlapping > 0 && <Callout tone="info">{strings.overlaps(overlapping)}</Callout>}
        <SpanTimes span={span} locale={locale} onChange={onSpanChange} isDisabled={pending} />
        <CloseForm
          weekday={weekday}
          isHold={isHold}
          privatePages={privatePages}
          {...(createLinkOnlyHref === undefined ? {} : { createLinkOnlyHref })}
          pending={pending}
          onPending={setPending}
          onClose={onClose}
        />
      </SpanCard>
    );
  }
  const choices: SpanCardChoice[] = [
    ...(onBook === undefined
      ? []
      : [{ id: 'book', label: strings.bookSomeoneIn, icon: 'user-plus' as const, onPress: onBook }]),
    { id: 'block', label: strings.blockThisTime, icon: 'circle-slash', onPress: () => setMode({ kind: 'block' }) },
    { id: 'hold', label: strings.holdThisTime, icon: 'bookmark', onPress: () => setMode({ kind: 'hold' }) },
  ];
  return <SpanCard title={title} meta={meta} choices={choices} focusKey="choose" />;
}

/**
 * Block this time (how often) or Reserve it (for which link only page), and why,
 * which only the member sees. A hold is always this one date.
 */
function CloseForm({
  weekday,
  isHold,
  privatePages,
  createLinkOnlyHref,
  pending,
  onPending,
  onClose,
}: {
  readonly weekday: string;
  readonly isHold: boolean;
  readonly privatePages: readonly { readonly id: string; readonly title: string }[];
  readonly createLinkOnlyHref?: string;
  readonly pending: boolean;
  readonly onPending: (pending: boolean) => void;
  readonly onClose: (input: CloseInput) => Promise<void>;
}) {
  const [repeat, setRepeat] = useState<TimeBlockRepeat>('once');
  const [page, setPage] = useState(ANY_PAGE);
  const [label, setLabel] = useState('');
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const submit = () => {
    // Enter in Why while saving would send it twice.
    if (pending) return;
    onPending(true);
    setFailure(undefined);
    const trimmed = label.trim();
    onClose({
      kind: isHold ? 'hold' : 'block',
      repeat: isHold ? 'once' : repeat,
      ...(trimmed === '' ? {} : { label: trimmed }),
      ...(isHold && page !== ANY_PAGE ? { pageId: page } : {}),
    })
      .catch((error: unknown) => {
        setFailure(isDataError(error) ? error.message : isHold ? strings.holdFailed : strings.blockFailed);
      })
      .finally(() => onPending(false));
  };
  // No link only page yet: nothing could book reserved time, so the card says why and offers to make one.
  if (isHold && privatePages.length === 0) {
    return (
      <>
        <Callout tone="info" title={strings.reservedTime}>
          {strings.noPrivatePages}
        </Callout>
        {createLinkOnlyHref !== undefined && (
          <ButtonLink href={createLinkOnlyHref} icon="plus">
            {strings.createLinkOnly}
          </ButtonLink>
        )}
      </>
    );
  }
  return (
    <>
      {isHold ? (
        <Select
          label={strings.holdFor}
          items={[
            { id: ANY_PAGE, label: strings.anyPrivatePage },
            ...privatePages.map((each) => ({ id: each.id, label: each.title })),
          ]}
          value={page}
          isDisabled={pending}
          onChange={(id) => setPage(id ?? ANY_PAGE)}
        />
      ) : (
        <RadioGroup
          label={strings.howOften}
          value={repeat}
          isDisabled={pending}
          onChange={(value) => setRepeat(value === 'weekly' ? 'weekly' : 'once')}
        >
          <Radio value="once">{strings.justThis(weekday)}</Radio>
          <Radio value="weekly">{strings.everyWeek(weekday)}</Radio>
        </RadioGroup>
      )}
      <Field
        label={strings.why}
        hint={strings.onlyYou}
        value={label}
        isDisabled={pending}
        onChange={setLabel}
        onSubmit={submit}
        maxLength={200}
      />
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Button variant="primary" isPending={pending} onPress={submit}>
        {pending ? (isHold ? strings.holding : strings.blocking) : isHold ? strings.holdIt : strings.blockIt}
      </Button>
    </>
  );
}
