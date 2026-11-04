import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { ChoiceChips } from '../../molecules/ChoiceChips/ChoiceChips.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { SlotList, type Slot } from '../SlotList/SlotList.tsx';
import styles from './BookingChat.module.css';
import { BookingChatGhost } from './BookingChatGhost.tsx';
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
  /**
   * What the prompt box asks while this is the last reply ("Which time?", "Your name and email"), so its words follow
   * the conversation rather than repeating the opening question. Left out, the opening question.
   */
  readonly prompt?: string;
  /** What the prompt box takes after this reply, for the phone's keyboard and autofill: an email, a number, a name. */
  readonly answer?: 'email' | 'tel' | 'name';
  /**
   * One choice the visitor makes with a tap, shown picked (the meeting's length on a page with several): the page's
   * own ChoiceChips, under the line while it is the last reply.
   */
  readonly choice?: {
    readonly label: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
    readonly selected: string;
  };
}

/** The host the chat speaks as: their name and picture (the rail's face), and the name shown over their messages. */
export interface BookingChatHost {
  readonly name: string;
  readonly image?: string;
  /** Over the first message of each of their runs: the host's first name, or a team page's name. */
  readonly label: string;
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
  /** What else the booking carries, folded into the card (critic B-10): "2 guests · Note: about the API". */
  readonly more?: string;
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
  /** Who speaks: their face at the foot of each run of their messages, their name over its first. */
  readonly host: BookingChatHost;
  /** The page's times are still loading: a skeleton, and the field waits. */
  readonly isLoading?: boolean;
  /** A turn is out: the field waits and the thread says so. */
  readonly isWaiting?: boolean;
  readonly error?: BookingChatError;
  /** The visitor sent a message (typed, or a suggestion's words). */
  readonly onSend: (text: string) => void;
  /** The visitor pressed an offered time. */
  readonly onPickTime: (id: string) => void;
  /** The visitor picked another option of a line's `choice`. */
  readonly onChoose?: (id: string) => void;
  /** The chat is over (it booked, or the page closed): the field and buttons are done. */
  readonly isDone?: boolean;
  /** What a screen reader hears when it ends ("Booked. Opening your booking."). */
  readonly doneNote?: string;
  /** The longest message, in characters. */
  readonly maxLength?: number;
}

/**
 * The face beside a run's last message: the host's (the rail's picture or initials). The visitor's own lines carry no
 * face (critic C16): their side of the thread is plainly theirs, and a generic person mark said nothing.
 */
function faceOf(role: BookingChatLine['role'], host: BookingChatHost) {
  if (role !== 'assistant') return undefined;
  return <Avatar name={host.name} size="md" isDecorative {...(host.image === undefined ? {} : { src: host.image })} />;
}

/** The prompt box's keyboard and autofill for what it is asked for; plain text otherwise. */
function inputFor(answer: BookingChatLine['answer']) {
  switch (answer) {
    case 'email':
      return { inputMode: 'email' as const, autoComplete: 'email' };
    case 'tel':
      return { inputMode: 'tel' as const, autoComplete: 'tel' };
    case 'name':
      return { autoComplete: 'name' };
    default:
      return { autoComplete: 'off' };
  }
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
  host,
  isLoading = false,
  isWaiting = false,
  error,
  onSend,
  onPickTime,
  onChoose,
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
  const lastReply = lines.findLast((line) => line.role === 'assistant');
  const lastAssistant = lastReply?.id;
  const isLocked = isWaiting || isDone || isLoading;

  // The newest line in view as the thread grows: at once when a line arrives, then again as each line, its times and
  // its card finish opening to their height, so the thread follows them down rather than stopping short (the owner,
  // 2 November 2026). It glides there, unless less motion was asked for. On a phone the page is the only scroller
  // (the thread takes its whole height), so the newest line is brought into the window instead, above the prompt box
  // (its scroll margin); never for the greeting, so the page never moves on its own as it opens.
  const hasMoved = useRef(false);
  const shownLength = useRef(lines.length);
  useEffect(() => {
    if (lines.length !== shownLength.current) {
      hasMoved.current = true;
      shownLength.current = lines.length;
    }
    const thread = threadRef.current;
    if (thread === null) return;
    thread.scrollTop = thread.scrollHeight;
    if (hasMoved.current) thread.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [lines.length, isWaiting, error, isLoading]);
  useEffect(() => {
    const thread = threadRef.current;
    if (thread === null) return undefined;
    const follow = () => {
      const isStill = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = isStill ? 'auto' : 'smooth';
      thread.scrollTo({ top: thread.scrollHeight, behavior });
      if (hasMoved.current) thread.lastElementChild?.scrollIntoView({ block: 'nearest', behavior });
    };
    thread.addEventListener('animationstart', follow);
    thread.addEventListener('animationend', follow);
    return () => {
      thread.removeEventListener('animationstart', follow);
      thread.removeEventListener('animationend', follow);
    };
    // The thread mounts once the times are in (the ghost stands in before).
  }, [isLoading]);

  // A pressed time or suggestion leaves with its reply: focus goes to the field, where the next answer is typed.
  const focusField = () => globalThis.requestAnimationFrame(() => fieldRef.current?.focus());

  const send = () => {
    const text = draft.trim();
    if (text === '' || isLocked) return;
    onSend(text);
    setDraft('');
  };

  // While the page's times load, the chat's own shape: the greeting's bubble, its times and the prompt box.
  if (isLoading) return <BookingChatGhost />;

  return (
    <div className={styles.root}>
      {/* Focusable, so the thread scrolls from the keyboard where the browser wouldn't (Safari). */}
      {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrolling region must be reachable */}
      <div ref={threadRef} className={styles.thread} role="log" aria-label={strings.thread} tabIndex={0}>
        {lines.map((line, index) => {
          const isLive = line.id === lastAssistant && !isLocked;
          // A run is one speaker's messages in a row (iMessage, Intercom): the name over its first, the face at its
          // foot, and a wider gap where the speaker changes. The typing dots close the host's run while a reply is out.
          const isRunStart = lines[index - 1]?.role !== line.role;
          const next = lines[index + 1]?.role ?? (isWaiting ? 'assistant' : undefined);
          const isRunEnd = next !== line.role;
          return (
            <div
              key={line.id}
              className={styles.line}
              data-role={line.role}
              data-run-start={isRunStart || undefined}
              // How long the reply takes to write itself, so its times and suggestions come after its words.
              style={{ '--words': String(Math.min(line.text.split(/\s+/).length, STAGGERED_WORDS)) }}
            >
              <VisuallyHidden>{strings.said(line.role === 'visitor' ? strings.you : host.label)}</VisuallyHidden>
              {/* The host's name once, over the conversation's first line, not over every run (critic C16). */}
              {index === 0 && line.role === 'assistant' && (
                <span className={styles.who} aria-hidden="true">
                  {host.label}
                </span>
              )}
              <div className={styles.said}>
                {line.role === 'assistant' && (
                  <span className={styles.face}>{isRunEnd && faceOf(line.role, host)}</span>
                )}
                <p className={styles.bubble}>{line.role === 'assistant' ? <Written text={line.text} /> : line.text}</p>
              </div>
              {isLive && line.choice !== undefined && (
                <div className={styles.offers}>
                  <ChoiceChips
                    label={line.choice.label}
                    isLabelHidden
                    isSingle
                    choices={line.choice.options}
                    selected={[line.choice.selected]}
                    onChange={(picked) => {
                      const next = picked[0];
                      if (next !== undefined && next !== line.choice?.selected) onChoose?.(next);
                    }}
                  />
                </div>
              )}
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
                        {line.card.more !== undefined && <span className={styles.cardWho}>{line.card.more}</span>}
                      </span>
                    </div>
                  )}
                  {line.confirm === undefined ? (
                    // Quick replies as the page's own chips (critics C5, A9): the same control as the lengths.
                    <div className={styles.suggestions}>
                      <ChoiceChips
                        label={strings.suggestions}
                        isLabelHidden
                        isSingle
                        choices={line.suggestions.map((suggestion) => ({ id: suggestion, label: suggestion }))}
                        selected={[]}
                        onChange={(picked) => {
                          const said = picked[0];
                          if (said === undefined) return;
                          onSend(said);
                          focusField();
                        }}
                      />
                    </div>
                  ) : (
                    <div className={styles.suggestions} data-confirm="" role="group" aria-label={strings.suggestions}>
                      {line.suggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          {...(line.confirm === undefined
                            ? // Chips, as an AI chat's quick replies: a quiet outline, fully round.
                              { variant: 'secondary' as const, isRound: true }
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
                  )}
                </div>
              )}
            </div>
          );
        })}
        {isWaiting && (
          // The host typing: three dots in their bubble, their face beside it, until the reply takes its place.
          <div
            className={styles.line}
            data-role="assistant"
            data-run-start={lines.at(-1)?.role !== 'assistant' || undefined}
            aria-busy="true"
          >
            <div className={styles.said}>
              <span className={styles.face}>{faceOf('assistant', host)}</span>
              <p className={styles.bubble}>
                <VisuallyHidden>{strings.waiting}</VisuallyHidden>
                <span className={styles.typing} aria-hidden="true">
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                </span>
              </p>
            </div>
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
            // The question it answers names the box, and the phone's keyboard and autofill follow it (an email, a number).
            label={lastReply?.prompt ?? strings.message}
            isLabelHidden
            placeholder={lastReply?.prompt ?? strings.placeholder}
            {...inputFor(lastReply?.answer)}
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            isWrapping
            maxLength={maxLength}
            showCounter
            isDisabled={isDone}
          />
        </div>
        {/* Always there, as an AI chat's send: a round grey button while there is nothing to send, the accent once
            there is (a faded blue button read as broken, the owner, 2 November 2026). Enter sends too. */}
        <span className={styles.send}>
          <Button
            variant={draft.trim() === '' ? 'secondary' : 'primary'}
            size="lg"
            icon="arrow-up"
            label={strings.send}
            isRound
            isDisabled={isLocked || draft.trim() === ''}
            onPress={send}
          />
        </span>
      </div>
    </div>
  );
}
