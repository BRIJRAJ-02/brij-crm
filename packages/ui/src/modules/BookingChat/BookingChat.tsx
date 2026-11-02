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
  /**
   * On a read back, the suggestion that books it ("Yes, book it"): the answer's suggestions become its confirm card
   * (stageshow's ai-cards), this one the primary action, at the size of the page's Book.
   */
  readonly confirm?: string;
  /** With `confirm`: the booking it would make, drawn at the head of the confirm card. */
  readonly card?: BookingChatCard;
}

/** What a read back would book, as the confirm card heads it: the date tile, the meeting, when and who. */
export interface BookingChatCard {
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
  /** "Intro call with Ada Lovelace". */
  readonly title: string;
  /** "Monday 2 November · 9:00 – 9:30 AM". */
  readonly when: string;
  /** "Grace Hopper · grace@example.com". */
  readonly who: string;
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

/** Words past this many arrive together: a long reply never makes the visitor wait on its last words. */
const STAGGERED_WORDS = 40;

/**
 * A reply's words, each in a span that fades in a beat after the one before (CSS staggers them by `--word`), so a
 * reply reads as being written rather than appearing whole. The text is all there from the start, so a screen
 * reader and the log read it once, as before.
 */
function Written({ text }: { text: string }) {
  return text.split(/(\s+)/).map((part, index) =>
    /^\s*$/.test(part) ? (
      part
    ) : (
      <span key={index} className={styles.word} style={{ '--word': String(Math.min(index / 2, STAGGERED_WORDS)) }}>
        {part}
      </span>
    ),
  );
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
  // The time picked from a reply's offers, kept on that reply as the record of the answer (stageshow's AI cards):
  // the offers stay where they were, the picked one marked, so nothing below moves.
  const [answered, setAnswered] = useState<{ readonly line: string; readonly id: string } | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const lastAssistant = lines.findLast((line) => line.role === 'assistant')?.id;
  const isLocked = isWaiting || isDone || isLoading;

  // The newest line in view as the thread grows: at once when a line arrives, then again as each line, its times and
  // its card finish opening to their height, so the thread follows them down rather than stopping short (the owner,
  // 2 November 2026). It glides there, unless less motion was asked for.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [lines.length, isWaiting, error]);
  useEffect(() => {
    const thread = threadRef.current;
    if (thread === null) return undefined;
    const follow = () => {
      const isStill = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      thread.scrollTo({ top: thread.scrollHeight, behavior: isStill ? 'auto' : 'smooth' });
    };
    thread.addEventListener('animationstart', follow);
    thread.addEventListener('animationend', follow);
    return () => {
      thread.removeEventListener('animationstart', follow);
      thread.removeEventListener('animationend', follow);
    };
  }, []);

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
              <div
                key={line.id}
                className={styles.line}
                data-role={line.role}
                // How long the reply takes to write itself, so its times and suggestions come after its words.
                style={{ '--words': String(Math.min(line.text.split(/\s+/).length, STAGGERED_WORDS)) }}
              >
                <VisuallyHidden>
                  {strings.said(line.role === 'visitor' ? strings.you : strings.assistant)}
                </VisuallyHidden>
                <p className={styles.bubble}>{line.role === 'assistant' ? <Written text={line.text} /> : line.text}</p>
                {(isLive || answered?.line === line.id) &&
                  line.days?.map((group) => (
                    <div key={group.day} className={styles.offers}>
                      <SlotList
                        variant="offers"
                        layout="grid"
                        heading={group.day}
                        slots={group.times}
                        value={undefined}
                        {...(answered?.line === line.id ? { answered: answered.id } : {})}
                        onChange={(id) => {
                          setAnswered({ line: line.id, id });
                          onPickTime(id);
                          focusField();
                        }}
                      />
                    </div>
                  ))}
                {isLive && line.suggestions !== undefined && line.suggestions.length > 0 && (
                  <div className={styles.confirmCard} data-card={line.confirm === undefined ? undefined : ''}>
                    {line.confirm !== undefined && line.card !== undefined && (
                      // The booking it would make, the way the confirmation will show it: the date tile, then what,
                      // when and who, so Yes is said to something seen, not a sentence re-read.
                      <div className={styles.summary}>
                        <span className={styles.tile} aria-hidden="true">
                          <span className={styles.tileSmall}>{line.card.weekday}</span>
                          <span className={styles.tileDay}>{line.card.day}</span>
                          <span className={styles.tileSmall}>{line.card.month}</span>
                        </span>
                        <span className={styles.facts}>
                          <span className={styles.cardTitle}>{line.card.title}</span>
                          <span className={styles.cardWhen}>{line.card.when}</span>
                          <span className={styles.cardWho}>{line.card.who}</span>
                        </span>
                      </div>
                    )}
                    <div
                      className={styles.suggestions}
                      data-confirm={line.confirm === undefined ? undefined : ''}
                      role="group"
                      aria-label={strings.suggestions}
                    >
                      {line.suggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          {...(line.confirm === undefined
                            ? { variant: 'ghost' as const }
                            : suggestion === line.confirm
                              ? {
                                  variant: 'primary' as const,
                                  size: 'xl' as const,
                                  icon: 'check' as const,
                                  isFullWidth: 'center' as const,
                                }
                              : { variant: 'secondary' as const, size: 'xl' as const, isFullWidth: 'center' as const })}
                          onPress={() => {
                            onSend(suggestion);
                            focusField();
                          }}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
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
              <span className={styles.thinking}>{strings.waiting}</span>
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
        // Drops in above the composer with its own height, so the thread gives way rather than jumping.
        <div className={styles.error}>
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
        </div>
      )}
      <div className={styles.composer} data-disabled={isDone || undefined}>
        <div className={styles.field}>
          <Field
            ref={fieldRef}
            variant="cell"
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
        {/* Quiet while there is nothing to send, the accent once there is (ai-chat's composer): a faded blue button
            read as broken (the owner, 2 November 2026: the chat box looked weird). */}
        <Button
          variant={draft.trim() === '' ? 'ghost' : 'primary'}
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
