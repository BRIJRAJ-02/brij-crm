import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { SlotList, type Slot } from '../SlotList/SlotList.tsx';
import styles from './BookingChat.module.css';
import { strings } from './strings.ts';

/** The offered times of one day, under the day's name: each time's start as the page keys it, its label and name. */
export interface BookingChatDay {
  readonly day: string;
  readonly times: readonly Slot[];
}

/** One line of the conversation. Only the last assistant line's times and suggestions are pressable. */
export interface BookingChatLine {
  readonly id: string;
  readonly role: 'visitor' | 'assistant';
  readonly text: string;
  readonly days?: readonly BookingChatDay[];
  readonly suggestions?: readonly string[];
}

/** A failed turn: the sentence, and what the visitor can do about it. */
export interface BookingChatError {
  readonly message: string;
  /** Sends the turn again (Try again). */
  readonly onRetry?: () => void;
  /** Clears the conversation (Start over), when sending again can't help. */
  readonly onRestart?: () => void;
  /** A pause rather than a fault (too many at once): said politely, as a warning. */
  readonly isPause?: boolean;
}

/** Props for BookingChat. */
export interface BookingChatProps {
  readonly lines: readonly BookingChatLine[];
  /** The page's times are still loading: a skeleton, and the field waits. */
  readonly isLoading?: boolean;
  /** A turn is out: the field waits and the thread says so. */
  readonly isWaiting?: boolean;
  readonly error?: BookingChatError;
  /** The visitor sent a message (typed, or a suggestion's words). */
  readonly onSend: (text: string) => void;
  /** The visitor pressed an offered time. */
  readonly onPickTime: (id: string) => void;
  /** The chat is over (it booked, or the page closed): the field and buttons are done. */
  readonly isDone?: boolean;
  /** What a screen reader hears when it ends ("Booked. Opening your booking."). */
  readonly doneNote?: string;
  /** The longest message, in characters. */
  readonly maxLength?: number;
}

/**
 * Book by chat on the public booking page (spec 0042): the conversation as a
 * log that announces each reply, the last reply's times grouped by day (the
 * booking page's own SlotList, as actions) and its suggestions as buttons,
 * then the message field and Send. Enter sends; after sending, by typing or
 * by a button, focus is in the field.
 */
export function BookingChat({
  lines,
  isLoading = false,
  isWaiting = false,
  error,
  onSend,
  onPickTime,
  isDone = false,
  doneNote,
  maxLength = 500,
}: BookingChatProps) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const lastAssistant = lines.findLast((line) => line.role === 'assistant')?.id;
  const isLocked = isWaiting || isDone || isLoading;

  // The newest line in view as the thread grows.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [lines.length, isWaiting, error]);

  // A pressed time or suggestion leaves with its reply: focus goes to the field, where the next answer is typed.
  const focusField = () => globalThis.requestAnimationFrame(() => fieldRef.current?.focus());

  const send = () => {
    const text = draft.trim();
    if (text === '' || isLocked) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className={styles.root}>
      {/* Focusable, so the thread scrolls from the keyboard where the browser wouldn't (Safari). */}
      {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrolling region must be reachable */}
      <div ref={threadRef} className={styles.thread} role="log" aria-label={strings.thread} tabIndex={0}>
        {isLoading ? (
          <div className={styles.line} data-role="assistant" aria-busy="true">
            <VisuallyHidden>{strings.loading}</VisuallyHidden>
            <Skeleton shape="block" lines={4} />
          </div>
        ) : (
          lines.map((line) => {
            const isLive = line.id === lastAssistant && !isLocked;
            return (
              <div key={line.id} className={styles.line} data-role={line.role}>
                <VisuallyHidden>
                  {strings.said(line.role === 'visitor' ? strings.you : strings.assistant)}
                </VisuallyHidden>
                <p className={styles.bubble}>{line.text}</p>
                {isLive &&
                  line.days?.map((group) => (
                    <div key={group.day} className={styles.offers}>
                      <SlotList
                        variant="offers"
                        layout="grid"
                        heading={group.day}
                        slots={group.times}
                        value={undefined}
                        onChange={(id) => {
                          onPickTime(id);
                          focusField();
                        }}
                      />
                    </div>
                  ))}
                {isLive && line.suggestions !== undefined && line.suggestions.length > 0 && (
                  <div className={styles.suggestions} role="group" aria-label={strings.suggestions}>
                    {line.suggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="ghost"
                        onPress={() => {
                          onSend(suggestion);
                          focusField();
                        }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {isWaiting && (
          <div className={styles.line} data-role="assistant" aria-busy="true">
            <span className={styles.waiting}>
              <Spinner />
              <VisuallyHidden>{strings.waiting}</VisuallyHidden>
            </span>
          </div>
        )}
        {isDone && doneNote !== undefined && (
          <div className={styles.line} data-role="assistant">
            <VisuallyHidden>{doneNote}</VisuallyHidden>
          </div>
        )}
      </div>
      {error !== undefined && (
        <Callout
          tone={error.isPause === true ? 'warning' : 'danger'}
          isAnnounced
          {...(error.onRetry === undefined && error.onRestart === undefined
            ? {}
            : {
                actions:
                  error.onRestart === undefined ? (
                    <Button icon="refresh-cw" onPress={error.onRetry}>
                      {strings.retry}
                    </Button>
                  ) : (
                    <Button onPress={error.onRestart}>{strings.restart}</Button>
                  ),
              })}
        >
          {error.message}
        </Callout>
      )}
      <div className={styles.composer}>
        <div className={styles.field}>
          <Field
            ref={fieldRef}
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
