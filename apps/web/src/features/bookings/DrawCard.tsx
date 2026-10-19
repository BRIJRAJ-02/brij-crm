// Brief
// Purpose: the card a span drawn on Bookings › Calendar opens (spec 0027, AC-702 to AC-704): what the time is for.
// Main task: pick Block this time (once or every week, with a reason only you see), then confirm it in one press.
// Leaves out: drawing (WeekCalendar), and what a block does to slots (the server); Book and Hold join here next.
import { isDataError, type TimeBlockRepeat } from '@crm/data';
import { Button, Callout, Field, Radio, RadioGroup, SpanCard, type SpanCardChoice } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';
import { spanNames, type DrawnSpan } from './span.ts';
import { dayStart } from './week.ts';

/** Props for DrawCard. */
export interface DrawCardProps {
  readonly span: DrawnSpan;
  readonly locale: string;
  /** Closes the time; settles once the server has it, throws a data error on a refusal. */
  readonly onBlock: (input: { readonly repeat: TimeBlockRepeat; readonly label?: string }) => Promise<void>;
  /** Closes the card (Done, after a block). */
  readonly onDone: () => void;
}

type Mode =
  { readonly kind: 'choose' } | { readonly kind: 'block' } | { readonly kind: 'done'; readonly message: string };

/** The drawn span's card: its choices, then the picked one's form, then what happened. */
export function DrawCard({ span, locale, onBlock, onDone }: DrawCardProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  const { title, meta } = spanNames(span, locale);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dayStart(span.dayKey));

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
  if (mode.kind === 'block') {
    return (
      <SpanCard title={title} meta={meta} onBack={() => setMode({ kind: 'choose' })}>
        <BlockForm
          weekday={weekday}
          onBlock={async (input) => {
            await onBlock(input);
            setMode({ kind: 'done', message: strings.timeBlocked });
          }}
        />
      </SpanCard>
    );
  }
  const choices: SpanCardChoice[] = [
    { id: 'block', label: strings.blockThisTime, icon: 'circle-slash', onPress: () => setMode({ kind: 'block' }) },
  ];
  return <SpanCard title={title} meta={meta} choices={choices} />;
}

/** Block this time: how often, and why (only the member sees it). */
function BlockForm({
  weekday,
  onBlock,
}: {
  readonly weekday: string;
  readonly onBlock: (input: { readonly repeat: TimeBlockRepeat; readonly label?: string }) => Promise<void>;
}) {
  const [repeat, setRepeat] = useState<TimeBlockRepeat>('once');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const submit = () => {
    setPending(true);
    setFailure(undefined);
    const trimmed = label.trim();
    onBlock({ repeat, ...(trimmed === '' ? {} : { label: trimmed }) }).catch((error: unknown) => {
      setPending(false);
      setFailure(isDataError(error) ? error.message : strings.blockFailed);
    });
  };
  return (
    <>
      <RadioGroup
        label={strings.howOften}
        value={repeat}
        onChange={(value) => setRepeat(value === 'weekly' ? 'weekly' : 'once')}
      >
        <Radio value="once">{strings.justThis(weekday)}</Radio>
        <Radio value="weekly">{strings.everyWeek(weekday)}</Radio>
      </RadioGroup>
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
        {strings.blockIt}
      </Button>
    </>
  );
}
