import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import { TextSwap } from '../../atoms/TextSwap/TextSwap.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import styles from './AIAssist.module.css';
import {
  answerWords,
  appendPiece,
  EMPTY_STREAM,
  settleStream,
  streamedText,
  wordsPerStep,
  type StreamState,
} from './stream.ts';
import { strings } from './strings.ts';

/**
 * What `onAsk` answers with: the whole answer at once (a promise of its text, which the panel reveals a few words at
 * a time), or the answer as it is written (an async iterable of text pieces, drawn as they arrive, at most once a
 * frame). Either way it is text, drawn as text nodes, never HTML.
 */
export type AIAnswer = Promise<string> | AsyncIterable<string>;

/** Props for AIAssist. */
export interface AIAssistProps {
  /** What the AI is looking at ("Acme Corp"): said after the heading, in the start line and in the prompt. */
  readonly context: string;
  /** Questions to start from, as chips before the first question. */
  readonly suggestions?: readonly string[];
  /** The status line's steps while it works ("Reading the timeline"); three general ones by default. */
  readonly thinking?: readonly string[];
  /**
   * Answers a question. The screen calls the model (the library never does, AC-7320) and hands back the answer as
   * text. `signal` aborts when the person presses Stop, asks again or closes the panel. A rejection shows "Couldn't
   * get an answer" with Try again.
   */
  readonly onAsk: (question: string, signal: AbortSignal) => AIAnswer;
  /** Save as note, handed the whole answer; left out, the button isn't drawn. */
  readonly onSaveNote?: (answer: string) => void;
  /** Close, in the panel's header; left out, the button isn't drawn. */
  readonly onClose?: () => void;
}

/** How long each status step shows before the next swaps in: the prototype's two seconds, a reading pace. */
const THINKING_STEP_MS = 2_000;

/**
 * The one status line while an answer is being worked on: its steps take turns every two seconds through TextSwap
 * (the old step rises out as the next rises in), under a light passing across the words. Decoration for screen
 * readers, which hear one "Working on an answer" instead of every step.
 */
function ThinkingLine({ steps }: { readonly steps: readonly string[] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (steps.length < 2) return undefined;
    const timer = setInterval(() => {
      setAt((was) => (was + 1) % steps.length);
    }, THINKING_STEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, [steps.length]);
  return (
    <span className={styles.shimmer} aria-hidden="true">
      <TextSwap>{steps[at % Math.max(steps.length, 1)] ?? ''}</TextSwap>
    </span>
  );
}

/** One closed block of an answer: its text never changes, so it is never drawn again. */
const Block = memo(function Block({ text }: { readonly text: string }) {
  return text;
});

/**
 * An answer as it streams in, as text nodes only (never HTML, AC-7317): the closed blocks, drawn once each; the open
 * block; and the newest piece, which fades in. Each new piece redraws only the open block and itself, however long
 * the answer has grown (spec 0073, gate 3).
 */
function StreamText({ stream }: { readonly stream: StreamState }) {
  // A new array only when a block closes, so between those every closed block is skipped outright.
  const closed = useMemo(
    // Closed blocks are only ever added at the end, so a block's place is its identity.
    () => stream.blocks.map((block, index) => <Block key={index} text={block} />),
    [stream.blocks],
  );
  return (
    <>
      {closed}
      {stream.open}
      {stream.fresh !== '' && (
        // Keyed by its count, so each new piece is a new node that fades in, and the last one settles as text.
        <span key={stream.pieces} className={styles.fresh}>
          {stream.fresh}
        </span>
      )}
    </>
  );
}

/** Where a question stands: being worked on, arriving, answered, stopped by the person, or failed. */
type Phase = 'thinking' | 'streaming' | 'done' | 'stopped' | 'failed';

/** One question and its answer so far. */
interface Turn {
  readonly id: number;
  readonly question: string;
  readonly phase: Phase;
  readonly stream: StreamState;
}

/** How often a whole answer handed over at once shows its next words: about the prototype's pace. */
const REVEAL_TICK_MS = 50;

/** True for an answer that arrives in pieces. */
function isStreamed(answer: AIAnswer): answer is AsyncIterable<string> {
  return typeof (answer as Partial<AsyncIterable<string>>)[Symbol.asyncIterator] === 'function';
}

/**
 * Ask AI (spec 0073, batch 3): suggested questions to start from, a prompt, one shimmering status line while it
 * works, the answer arriving as text, then Copy and Save as note. Enter asks, Shift+Enter breaks the line, Stop ends
 * an answer where it is. It never calls a model: `onAsk` is the screen's. However long an answer grows, each new
 * piece redraws only the newest text (closed blocks are never drawn again), and pieces arriving faster than the
 * screen paints are drawn together, once a frame.
 */
export function AIAssist({
  context,
  suggestions = [],
  thinking = strings.thinkingSteps,
  onAsk,
  onSaveNote,
  onClose,
}: AIAssistProps) {
  const titleId = useId();
  const [draft, setDraft] = useState('');
  const [turn, setTurn] = useState<Turn>();
  const prompt = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // The question in flight: its id (a newer question or Stop retires it), its abort, and its reveal and frame timers.
  const run = useRef({ id: 0, controller: undefined as AbortController | undefined, timer: 0, frame: 0 });
  const isBusy = turn?.phase === 'thinking' || turn?.phase === 'streaming';

  /** Retires the question in flight: aborts it and stops its timers, so nothing it does later lands. */
  const retire = () => {
    const current = run.current;
    current.id += 1;
    current.controller?.abort();
    current.controller = undefined;
    clearInterval(current.timer);
    cancelAnimationFrame(current.frame);
  };

  // Closing the panel ends whatever is in flight.
  useEffect(() => {
    const current = run.current;
    return () => {
      current.id += 1;
      current.controller?.abort();
      clearInterval(current.timer);
      cancelAnimationFrame(current.frame);
    };
  }, []);

  /** Updates the turn only while `id` is still the question in flight. */
  const update = (id: number, change: (was: Turn) => Turn) => {
    setTurn((was) => (was !== undefined && was.id === id && run.current.id === id ? change(was) : was));
  };

  /** A piece of the answer, while it is still arriving: never after it is done, stopped or failed. */
  const arrive = (id: number, piece: string) => {
    update(id, (was) =>
      was.phase === 'thinking' || was.phase === 'streaming'
        ? { ...was, phase: 'streaming', stream: appendPiece(was.stream, piece) }
        : was,
    );
  };

  const finish = (id: number, phase: 'done' | 'failed') => {
    update(id, (was) => {
      const stream = settleStream(was.stream);
      // An answer with no words is no answer.
      return { ...was, stream, phase: phase === 'done' && streamedText(stream).trim() === '' ? 'failed' : phase };
    });
  };

  /** A whole answer, revealed a few words a step so it reads as it arrives; a long one within its steps. */
  const reveal = (id: number, answer: string) => {
    const words = answerWords(answer);
    const step = wordsPerStep(words.length);
    let shown = 0;
    const next = () => {
      if (run.current.id !== id) return;
      const piece = words.slice(shown, shown + step).join('');
      shown += step;
      arrive(id, piece);
      if (shown >= words.length) {
        clearInterval(run.current.timer);
        finish(id, 'done');
      }
    };
    next();
    if (shown < words.length) run.current.timer = window.setInterval(next, REVEAL_TICK_MS);
  };

  /** Pieces as they come, drawn at most once a frame however fast they arrive. */
  const follow = async (id: number, pieces: AsyncIterable<string>, signal: AbortSignal) => {
    let pending = '';
    const flush = () => {
      run.current.frame = 0;
      const piece = pending;
      pending = '';
      arrive(id, piece);
    };
    try {
      for await (const piece of pieces) {
        if (signal.aborted || run.current.id !== id) return;
        pending += piece;
        if (run.current.frame === 0) run.current.frame = requestAnimationFrame(flush);
      }
    } finally {
      // A frame still waiting would draw after the answer ended (or broke): what is pending is drawn below, or not.
      cancelAnimationFrame(run.current.frame);
      run.current.frame = 0;
    }
    if (run.current.id !== id) return;
    flush();
    finish(id, 'done');
  };

  const ask = (typed: string) => {
    const question = typed.trim();
    if (question === '' || isBusy) return;
    retire();
    const id = run.current.id;
    const controller = new AbortController();
    run.current.controller = controller;
    setDraft('');
    setTurn({ id, question, phase: 'thinking', stream: EMPTY_STREAM });
    const failed = () => {
      if (!controller.signal.aborted) finish(id, 'failed');
    };
    try {
      const answer = onAsk(question, controller.signal);
      if (isStreamed(answer)) void follow(id, answer, controller.signal).catch(failed);
      else
        void answer.then((text) => {
          if (run.current.id === id) reveal(id, text);
        }, failed);
    } catch {
      failed();
    }
  };

  const stop = () => {
    const id = run.current.id;
    retire();
    // The answer stays where it got to, marked Stopped; retiring moved the id on, so this sets it directly.
    setTurn((was) => (was?.id === id ? { ...was, phase: 'stopped', stream: settleStream(was.stream) } : was));
    prompt.current?.focus();
  };

  const startOver = () => {
    retire();
    setTurn(undefined);
    prompt.current?.focus();
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Enter asks; Shift+Enter breaks the line; a key that finishes an input method's word is the method's.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask(draft);
  };

  const answer = turn === undefined ? '' : streamedText(turn.stream);
  const isAnswered = turn?.phase === 'done' || turn?.phase === 'stopped';

  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <header className={styles.head}>
        <Icon name="sparkles" tone="ai" />
        <h2 id={titleId} className={styles.title}>
          {strings.title}
        </h2>
        <span className={styles.context}>{strings.about(context)}</span>
        {turn !== undefined && !isBusy && (
          <Button variant="ghost" icon="plus" label={strings.newQuestion} onPress={startOver} />
        )}
        {onClose !== undefined && <Button variant="ghost" icon="x" label={strings.close} onPress={onClose} />}
      </header>

      <div className={styles.body}>
        {turn === undefined ? (
          <div className={styles.start}>
            <p className={styles.headline}>{strings.startTitle(context)}</p>
            {suggestions.length > 0 && (
              <div className={styles.suggestions} role="group" aria-label={strings.suggestions}>
                {suggestions.map((suggestion, index) => (
                  <span key={suggestion} className={styles.suggestion} style={{ '--suggestion': String(index) }}>
                    <Button
                      isRound
                      onPress={() => {
                        ask(suggestion);
                      }}
                    >
                      {suggestion}
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.turn}>
            <p className={styles.question}>{turn.question}</p>
            {turn.phase === 'thinking' && (
              <p className={styles.thinking}>
                <Icon name="sparkles" tone="ai" size="sm" />
                <ThinkingLine steps={thinking} />
                <VisuallyHidden>
                  <span role="status">{strings.thinking}</span>
                </VisuallyHidden>
              </p>
            )}
            {turn.phase === 'failed' ? (
              <Callout
                tone="danger"
                actions={
                  <Button
                    onPress={() => {
                      ask(turn.question);
                    }}
                  >
                    {strings.tryAgain}
                  </Button>
                }
              >
                {strings.failed}
              </Callout>
            ) : (
              turn.phase !== 'thinking' && (
                // Read once it is whole: busy while it arrives, so a screen reader waits instead of reading every piece.
                <div className={styles.answer} aria-live="polite" aria-busy={isBusy}>
                  <StreamText stream={turn.stream} />
                  {turn.phase === 'stopped' && <span className={styles.stopped}>{strings.stopped}</span>}
                </div>
              )
            )}
            {isAnswered && answer !== '' && (
              <div className={styles.actions}>
                <CopyButton value={answer} label={strings.copy} announcement={strings.copied} variant="ghost" />
                {onSaveNote !== undefined && (
                  <Button
                    variant="ghost"
                    icon="notebook"
                    onPress={() => {
                      onSaveNote(answer);
                    }}
                  >
                    {strings.saveNote}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.prompt}>
        <Field
          ref={prompt}
          label={strings.question}
          isLabelHidden
          variant="composer"
          isMultiline
          value={draft}
          onChange={setDraft}
          onKeyDown={keyDown}
          placeholder={strings.placeholder(context)}
        />
        <div className={styles.promptFoot}>
          <span className={styles.hint}>
            <Kbd>{strings.enterKey}</Kbd>
            {strings.toAsk}
          </span>
          {isBusy ? (
            <Button icon="square" label={strings.stop} isRound onPress={stop} />
          ) : (
            <Button
              variant="primary"
              icon="arrow-up"
              label={strings.ask}
              isRound
              isDisabled={draft.trim() === ''}
              onPress={() => {
                ask(draft);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
