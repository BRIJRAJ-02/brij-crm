// Brief
// Purpose: the card a span drawn on Bookings › Calendar opens (spec 0027, AC-702 to AC-704): what the time is for.
// Main task: pick Block this time (once or every week) or Hold it for a private page, with a reason only you see.
// Leaves out: drawing (WeekCalendar), and what a block does to slots (the server); Book joins here next.
import { isDataError, type TimeBlockKind, type TimeBlockRepeat } from '@crm/data';
import { Button, Callout, Field, Radio, RadioGroup, Select, SpanCard, type SpanCardChoice } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';
import { spanNames, type DrawnSpan } from './span.ts';
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
  /** The member's private pages, for a hold's choice. */
  readonly privatePages: readonly { readonly id: string; readonly title: string }[];
  /** Closes the time; settles once the server has it, throws a data error on a refusal. */
  readonly onClose: (input: CloseInput) => Promise<void>;
  /** Closes the card (Done). */
  readonly onDone: () => void;
}

type Mode =
  | { readonly kind: 'choose' }
  | { readonly kind: 'block' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'done'; readonly message: string };

/** Any private page: a hold's shared choice. */
const ANY_PAGE = 'any';

/** The drawn span's card: its choices, then the picked one's form, then what happened. */
export function DrawCard({ span, locale, privatePages, onClose, onDone }: DrawCardProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  const { title, meta } = spanNames(span, locale);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dayStart(span.dayKey));
  const back = () => setMode({ kind: 'choose' });

  if (mode.kind === 'done') {
    return (
      <SpanCard title={title} meta={meta}>
        <Callout tone="success" isAnnounced>
          {mode.message}
        </Callout>
        <Button onPress={onDone}>{strings.done}</Button>
      </SpanCard>
    );
  }
  if (mode.kind === 'block' || mode.kind === 'hold') {
    const isHold = mode.kind === 'hold';
    return (
      <SpanCard title={title} meta={meta} onBack={back}>
        <CloseForm
          weekday={weekday}
          isHold={isHold}
          privatePages={privatePages}
          onClose={async (input) => {
            await onClose(input);
            setMode({ kind: 'done', message: isHold ? strings.timeHeld : strings.timeBlocked });
          }}
        />
      </SpanCard>
    );
  }
  const choices: SpanCardChoice[] = [
    { id: 'block', label: strings.blockThisTime, icon: 'circle-slash', onPress: () => setMode({ kind: 'block' }) },
    { id: 'hold', label: strings.holdThisTime, icon: 'bookmark', onPress: () => setMode({ kind: 'hold' }) },
  ];
  return <SpanCard title={title} meta={meta} choices={choices} />;
}

/**
 * Block this time (how often) or Hold it (for which private page), and why,
 * which only the member sees. A hold is always this one date.
 */
function CloseForm({
  weekday,
  isHold,
  privatePages,
  onClose,
}: {
  readonly weekday: string;
  readonly isHold: boolean;
  readonly privatePages: readonly { readonly id: string; readonly title: string }[];
  readonly onClose: (input: CloseInput) => Promise<void>;
}) {
  const [repeat, setRepeat] = useState<TimeBlockRepeat>('once');
  const [page, setPage] = useState(ANY_PAGE);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const submit = () => {
    setPending(true);
    setFailure(undefined);
    const trimmed = label.trim();
    onClose({
      kind: isHold ? 'hold' : 'block',
      repeat: isHold ? 'once' : repeat,
      ...(trimmed === '' ? {} : { label: trimmed }),
      ...(isHold && page !== ANY_PAGE ? { pageId: page } : {}),
    }).catch((error: unknown) => {
      setPending(false);
      setFailure(isDataError(error) ? error.message : isHold ? strings.holdFailed : strings.blockFailed);
    });
  };
  return (
    <>
      {isHold ? (
        <Select
          label={strings.holdFor}
          hint={privatePages.length === 0 ? strings.noPrivatePages : strings.holdHint}
          items={[
            { id: ANY_PAGE, label: strings.anyPrivatePage },
            ...privatePages.map((each) => ({ id: each.id, label: each.title })),
          ]}
          value={page}
          onChange={(id) => setPage(id ?? ANY_PAGE)}
        />
      ) : (
        <RadioGroup
          label={strings.howOften}
          value={repeat}
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
        onChange={setLabel}
        onSubmit={submit}
        maxLength={200}
      />
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Button variant="primary" isPending={pending} onPress={submit}>
        {isHold ? strings.holdIt : strings.blockIt}
      </Button>
    </>
  );
}
