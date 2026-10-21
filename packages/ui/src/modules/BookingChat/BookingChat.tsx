import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import styles from './BookingChat.module.css';
import { strings } from './strings.ts';

/** One offered time: its start as the page keys it, the label on the button and what a screen reader says. */
export interface BookingChatTime {
  readonly id: string;
  readonly label: string;
  readonly name: string;
}

/** The offered times of one day, under the day's name. */
export interface BookingChatDay {
  readonly day: string;
  readonly times: readonly BookingChatTime[];
}

/** One line of the conversation. Only the last assistant line's times and suggestions are pressable. */
export interface BookingChatLine {
  readonly id: string;
  readonly role: 'visitor' | 'assistant';
  readonly text: string;
  readonly days?: readonly BookingChatDay[];
  readonly suggestions?: readonly string[];
}

/** Props for BookingChat. */
export interface BookingChatProps {
  readonly lines: readonly BookingChatLine[];
  /** A turn is out: the field waits and the thread says so. */
  readonly isWaiting?: boolean;
  /** A turn failed: the sentence, with Try again when `onRetry` is given. */
  readonly error?: string;
  readonly onRetry?: () => void;
  /** The visitor sent a message (typed, or a suggestion's words). */
  readonly onSend: (text: string) => void;
  /** The visitor pressed an offered time. */
  readonly onPickTime: (id: string) => void;
  /** The chat booked: the field and buttons are done. */
  readonly isDone?: boolean;
  /** The longest message, in characters. */
  readonly maxLength?: number;
}

/**
 * Book by chat on the public booking page (spec 0041): the conversation as a
 * log that announces each reply, the last reply's times grouped by day and its
 * suggestions as buttons, then the message field and Send. Enter sends; focus
 * stays in the field.
 */
export function BookingChat({
  lines,
  isWaiting = false,
  error,
  onRetry,
  onSend,
  onPickTime,
  isDone = false,
  maxLength = 500,
}: BookingChatProps) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const lastAssistant = lines.findLast((line) => line.role === 'assistant')?.id;
  const isLocked = isWaiting || isDone;

  // The newest line in view as the thread grows.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [lines.length, isWaiting, error]);

  const send = () => {
    const text = draft.trim();
    if (text === '' || isLocked) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className={styles.root}>
      <div ref={threadRef} className={styles.thread} role="log" aria-label={strings.thread} aria-live="polite">
        {lines.map((line) => {
          const isLive = line.id === lastAssistant && !isLocked;
          return (
            <div key={line.id} className={styles.line} data-role={line.role}>
              <VisuallyHidden>{strings.said(line.role === 'visitor' ? strings.you : strings.assistant)}</VisuallyHidden>
              <p className={styles.bubble}>{line.text}</p>
              {isLive &&
                line.days?.map((group) => (
                  <div key={group.day} className={styles.group} role="group" aria-label={strings.times(group.day)}>
                    <p className={styles.day} aria-hidden="true">
                      {group.day}
                    </p>
                    <div className={styles.times}>
                      {group.times.map((time) => (
                        <Button key={time.id} size="lg" label={time.name} onPress={() => onPickTime(time.id)}>
                          {time.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              {isLive && line.suggestions !== undefined && line.suggestions.length > 0 && (
                <div className={styles.suggestions} role="group" aria-label={strings.suggestions}>
                  {line.suggestions.map((suggestion) => (
                    <Button key={suggestion} variant="ghost" onPress={() => onSend(suggestion)}>
                      {suggestion}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {isWaiting && (
          <div className={styles.line} data-role="assistant" aria-busy="true">
            <span className={styles.waiting}>
              <Spinner label={strings.waiting} />
            </span>
          </div>
        )}
        {isDone && (
          <div className={styles.line} data-role="assistant">
            <VisuallyHidden>{strings.booked}</VisuallyHidden>
          </div>
        )}
      </div>
      {error !== undefined && (
        <Callout
          tone="danger"
          isAnnounced
          {...(onRetry === undefined
            ? {}
            : {
                actions: (
                  <Button icon="refresh-cw" onPress={onRetry}>
                    {strings.retry}
                  </Button>
                ),
              })}
        >
          {error}
        </Callout>
      )}
      <div className={styles.composer}>
        <div className={styles.field}>
          <Field
            label={strings.message}
            isLabelHidden
            placeholder={strings.placeholder}
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            isWrapping
            maxLength={maxLength}
            showCounter
            isDisabled={isDone}
            autoComplete="off"
          />
        </div>
        <Button
          variant="primary"
          size="lg"
          icon="arrow-up"
          label={strings.send}
          isDisabled={isLocked || draft.trim() === ''}
          onPress={send}
        />
      </div>
    </div>
  );
}
