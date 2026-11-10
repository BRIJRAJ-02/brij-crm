import { Button as AriaButton } from 'react-aria-components';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Copy, CornerDownLeft } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { useShake } from '../Field/Field.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { ProgressBar } from '../Progress/Progress.tsx';
import { answerText, checkAnswer, type AnswerValue, type BookingSource, type FormAnswers, type FormQuestion } from './answers.ts';
import { QuestionInput, type UploadFile } from './QuestionInput.tsx';
import './HostedForm.css';

export * from './answers.ts';
export { QuestionInput, type QuestionInputProps, type UploadFile } from './QuestionInput.tsx';

/** One question per screen (Typeform's way) or every question on one card (Tally's page). */
export type HostedFormMode = 'one' | 'page';
/** One logic rule, in plain words: "If <question> is <answer>, go to <question>" (or "the end"). One question at a time only. */
export interface FormRule { readonly id: string; readonly when: string; readonly is: string; readonly goto: string }

/** Props for HostedForm. It never touches the network: answers leave through `onSubmit`. */
export interface HostedFormProps {
  readonly title: string;
  readonly description?: string;
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly mode?: HostedFormMode;
  /** Resolves once the answers are stored; a rejection keeps the visitor on the form with an alert. */
  readonly onSubmit: (answers: FormAnswers) => Promise<void>;
  /** Saves a draft and resolves with the link to come back to. Without it there is no "Finish later". */
  readonly onFinishLater?: (answers: FormAnswers) => Promise<string>;
  /** Open times for a booking question. */
  readonly booking?: BookingSource;
  readonly onUpload?: UploadFile;
  /** Thank-you words; the defaults are Tally's plain ones. */
  readonly thanks?: { readonly title: string; readonly line?: string };
  /** Jumps between questions by answer (one question at a time). */
  readonly logic?: ReadonlyArray<FormRule>;
}

/** transitions.dev 08 page side-by-side in a box that eases to the showing page's height (01 card resize). */
function Pages({ page, pages, label }: { readonly page: number; readonly pages: ReadonlyArray<ReactNode>; readonly label: string }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const mounted = useRef(false);
  const shown = useRef(page);
  const last = useRef(0);
  const [size, setSize] = useState<{ readonly height: number; readonly animate: boolean }>();
  useLayoutEffect(() => {
    const el = refs.current[page];
    if (!el) return undefined;
    last.current = el.offsetHeight;
    setSize({ height: last.current, animate: mounted.current });
    mounted.current = true;
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight === last.current) return;
      last.current = el.offsetHeight;
      setSize({ height: last.current, animate: false });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);
  // Focus follows the visitor to the new page's answer (or its heading), never on first draw.
  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    const el = refs.current[page];
    const target = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('.tf-hform__control input:not([type=hidden]), .tf-hform__control textarea, .tf-hform__control button');
    target?.focus({ preventScroll: true });
  }, [page]);
  return (
    <div className={cx('tf-hform__pages', !size?.animate && 'is-following')} style={{ height: size?.height }} role="group" aria-label={label}>
      {pages.map((child, n) => (
        <section key={n} ref={(el) => { refs.current[n] = el; }} className="tf-hform__page" data-pos={n < page ? 'before' : n > page ? 'after' : 'current'} inert={n !== page}>
          {child}
        </section>
      ))}
    </div>
  );
}

/** Props for QuestionSlot. */
interface SlotProps {
  readonly question: FormQuestion;
  readonly index: number;
  readonly value: AnswerValue | undefined;
  readonly onChange: (next: AnswerValue | ((cur: AnswerValue | undefined) => AnswerValue)) => void;
  readonly error?: string;
  /** Goes up on every refused attempt, replaying the shake. */
  readonly attempt: number;
  readonly large: boolean;
  readonly onPicked?: () => void;
  readonly booking?: BookingSource;
  readonly onUpload?: UploadFile;
}

/** A question's number, heading, description, control and error line; shakes when an attempt is refused (12). */
function QuestionSlot({ question: q, index, value, onChange, error, attempt, large, onPicked, booking, onUpload }: SlotProps) {
  const id = useId();
  const { ref, shake } = useShake<HTMLDivElement>();
  const seen = useRef(attempt);
  useEffect(() => {
    if (attempt !== seen.current && error) shake();
    seen.current = attempt;
  }, [attempt, error, shake]);
  return (
    <div className={cx('tf-hform__q', large && 'tf-hform__q--large')} data-question={q.id}>
      <p className="tf-hform__num tf-num" aria-hidden="true">{index + 1}<ArrowRight size={12} strokeWidth={2} /></p>
      <h3 id={`${id}-t`} className="tf-hform__title" tabIndex={-1}>
        {q.title}{q.required ? <span className="tf-hform__req" aria-label="required"> *</span> : null}
      </h3>
      {q.description && <p className="tf-hform__desc">{q.description}</p>}
      <div ref={ref} className="tf-hform__control">
        <QuestionInput question={q} value={value} onChange={onChange} labelId={`${id}-t`} isInvalid={error !== undefined} onPicked={onPicked} booking={booking} onUpload={onUpload} />
      </div>
      {error && <p className="tf-hform__error" role="alert"><CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{error}</p>}
    </div>
  );
}

/** What was sent, read back: each answered question's title over its answer. */
export function SentAnswers({ questions, answers, booking }: { readonly questions: ReadonlyArray<FormQuestion>; readonly answers: FormAnswers; readonly booking?: BookingSource }) {
  const rows = questions.map((q) => ({ q, text: answerText(q, answers[q.id], booking) })).filter((r) => r.text !== '');
  if (rows.length === 0) return null;
  return (
    <dl className="tf-hform__sent">
      {rows.map(({ q, text }) => (
        <div key={q.id} className="tf-hform__sent-row"><dt>{q.title}</dt><dd>{text}</dd></div>
      ))}
    </dl>
  );
}

/** Finish later: one quiet line that saves a draft, then opens to "Saved" and Copy link (21 accordion), Copy swapping to Copied. */
export function FinishLater({ onSave }: { readonly onSave: () => Promise<string> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [failedCopy, setFailedCopy] = useState(false);
  const save = async () => {
    setState('saving');
    try { setLink(await onSave()); setState('saved'); } catch { setState('failed'); }
  };
  const copy = async () => {
    // Only say "copied" when it was; otherwise the link stays on screen to select.
    try { await navigator.clipboard.writeText(link); } catch { setFailedCopy(true); return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="tf-hform__later" data-open={state === 'saved' || undefined}>
      {failedCopy && <p className="tf-hform__error" role="alert">Copy didn’t work. Select this link and copy it: {link}</p>}
      {state !== 'saved' && (
        <AriaButton className="tf-hform__later-btn" onPress={() => { void save(); }} isDisabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : state === 'failed' ? "Couldn't save. Try again" : 'Finish later'}
        </AriaButton>
      )}
      <div className="tf-hform__later-panel">
        <div className="tf-hform__later-clip">
          <p className="tf-hform__later-row" role="status">
            <span className="tf-hform__later-saved"><SuccessCheck size={14} />Saved. Your answers wait for you.</span>
            <Button size="sm" variant="soft" icon={<Copy size={14} strokeWidth={1.75} />} onPress={() => { void copy(); }}>
              <TextSwap swapKey={copied ? 'y' : 'n'}>{copied ? 'Copied' : 'Copy link'}</TextSwap>
            </Button>
          </p>
        </div>
      </div>
    </div>
  );
}

/** The thank you: a drawn green check (10 success check), the words revealing (18), then what was sent. */
function Thanks({ show, title, line, children }: { readonly show: boolean; readonly title: string; readonly line?: string; readonly children: ReactNode }) {
  return (
    <div className="tf-hform__done">
      {show && (
        <>
          <span className="tf-hform__check" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg></span>
          <div className="tf-hform__reveal">
            <h2 className="tf-hform__reveal-line tf-hform__done-title" tabIndex={-1} data-autofocus>{title}</h2>
            {line && <p className="tf-hform__reveal-line tf-hform__done-sub">{line}</p>}
          </div>
          <div className="tf-hform__reveal-line tf-hform__done-sent">{children}</div>
        </>
      )}
    </div>
  );
}

/**
 * The form a guest fills in: one question at a time with a progress bar, Back and OK (Enter goes on), or every question on one
 * card. Required answers and emails are checked; a refused step shakes. Ends on a thank you with the sent answers.
 */
export function HostedForm({ title, description, questions, mode = 'one', onSubmit, onFinishLater, booking, onUpload, logic = [], thanks = { title: 'Thanks, we got it.', line: 'Your answers are in. You can close this page.' } }: HostedFormProps) {
  const [answers, setAnswers] = useState<FormAnswers>({});
  const answersRef = useRef(answers); answersRef.current = answers;
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const advance = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(advance.current), []);

  const setAnswer = (id: string) => (next: AnswerValue | ((cur: AnswerValue | undefined) => AnswerValue)) => {
    setAnswers((all) => {
      const value = typeof next === 'function' ? next(all[id]) : next;
      return { ...all, [id]: value };
    });
    // A shown error clears the moment the answer passes; a new one never appears while typing.
    setErrors((all) => {
      if (all[id] === undefined) return all;
      const q = questions.find((x) => x.id === id);
      const value = typeof next === 'function' ? undefined : next;
      if (!q || value === undefined || checkAnswer(q, value) !== undefined) return all;
      const { [id]: _gone, ...rest } = all;
      return rest;
    });
  };

  const refuse = (found: Readonly<Record<string, string>>) => { setErrors(found); setAttempt((n) => n + 1); };
  const send = async (only?: ReadonlySet<string>) => {
    if (sending) return;
    setSending(true); setFailed(false);
    const out = only && logic.length ? Object.fromEntries(Object.entries(answers).filter(([k]) => only.has(k))) : answers;
    try { await onSubmit(out); setSent(true); } catch { setFailed(true); } finally { setSending(false); }
  };
  const last = questions.length - 1;
  /** Where the visitor came from, so Back retraces a jump instead of landing on a skipped question. */
  const trail = useRef<number[]>([]);
  /** The step after this one: a matching rule's target, the end, or simply the next question. */
  const after = (at: number, all: FormAnswers): number | 'end' => {
    const q = questions[at]; const a = q ? all[q.id] : undefined;
    const said = Array.isArray(a) ? a.map(String) : a === undefined ? [] : [String(a)];
    const rule = q ? logic.find((r) => r.when === q.id && said.includes(r.is)) : undefined;
    if (rule) { if (rule.goto === 'end') return 'end'; const to = questions.findIndex((x) => x.id === rule.goto); if (to > at) return to; }
    return at === last ? 'end' : at + 1;
  };
  const go = (at: number, all: FormAnswers = answers) => { const to = after(at, all); if (to === 'end') void send(visited(at)); else { trail.current.push(at); setStep(to); } };
  /** The questions on the path they took: answers left behind on a branch they backed out of aren't sent. */
  const visited = (at: number) => new Set([...trail.current, at].map((n) => questions[n]?.id).filter((x): x is string => x !== undefined));
  const next = () => {
    window.clearTimeout(advance.current);
    const q = questions[step];
    if (!q) return;
    const problem = checkAnswer(q, answers[q.id]);
    if (problem) { refuse({ [q.id]: problem }); return; }
    setErrors({});
    go(step);
  };
  const back = () => { window.clearTimeout(advance.current); setErrors({}); const prev = trail.current.pop(); setStep((s) => prev ?? Math.max(0, s - 1)); };
  // A single choice picked by pointer or letter goes on by itself after a short look at the tick, never from the last question.
  const picked = () => {
    if (step === last) return;
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => { const to = after(step, answersRef.current); if (to !== 'end') { trail.current.push(step); setStep(to); } }, 450);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, [role=button], [role=grid], [role=row], [role=listbox], [role=option], [role=spinbutton], a')) return;
    e.preventDefault();
    next();
  };

  const submitPage = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    for (const q of questions) { const p = checkAnswer(q, answers[q.id]); if (p) found[q.id] = p; }
    const first = questions.find((q) => found[q.id]);
    if (first) {
      refuse(found);
      const el = e.currentTarget.querySelector<HTMLElement>(`[data-question="${first.id}"] .tf-hform__title`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    void send();
  };

  const slot = (q: FormQuestion, n: number, large: boolean) => (
    <QuestionSlot key={q.id} question={q} index={n} value={answers[q.id]} onChange={setAnswer(q.id)} error={errors[q.id]} attempt={attempt}
      large={large} onPicked={large && (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating') ? picked : undefined} booking={booking} onUpload={onUpload} />
  );
  const alert = failed && <p className="tf-hform__alert" role="alert"><CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />We couldn't send that. Check your connection and try again.</p>;
  const later = onFinishLater && <FinishLater onSave={() => onFinishLater(answers)} />;
  const done = (
    <Thanks show={sent} title={thanks.title} line={thanks.line}>
      <SentAnswers questions={questions} answers={answers} booking={booking} />
    </Thanks>
  );

  const oneAtATime = (
    <div className="tf-hform__one" onKeyDown={onKeyDown}>
      <div className="tf-hform__bar" data-hidden={sent || undefined}>
        <IconButton label="Previous question" size="sm" onPress={back} isDisabled={step === 0 || sent}><ArrowLeft size={16} strokeWidth={1.75} /></IconButton>
        <span className="tf-hform__form-name">{title}{description && step === 0 && !sent ? <span className="tf-hform__lede-one">{description}</span> : null}</span>
        <span className="tf-hform__count tf-num" aria-hidden="true">{Math.min(step + 1, questions.length)} / {questions.length}</span>
      </div>
      <ProgressBar size="sm" aria-label="Progress" value={sent ? questions.length : step} maxValue={questions.length} className="tf-hform__progress" />
      <Pages label={title} page={sent ? questions.length : step} pages={[
        ...questions.map((q, n) => (
          <div key={q.id} className="tf-hform__step">
            {slot(q, n, true)}
            <div className="tf-hform__actions">
              {(() => { const ends = n === last || after(n, answers) === 'end'; return (
                <Button variant="primary" size="lg" onPress={next} isPending={sending && n === step} iconEnd={ends ? undefined : <Check size={16} strokeWidth={2} aria-hidden="true" />}>
                  {ends ? 'Submit' : 'OK'}
                </Button>); })()}
              <span className="tf-hform__hint" aria-hidden="true">press <Kbd>Enter</Kbd><CornerDownLeft size={12} strokeWidth={1.75} /></span>
            </div>
            {n === step && alert}
          </div>
        )),
        done,
      ]} />
      {!sent && later}
    </div>
  );

  const onePage = (
    <Pages label={title} page={sent ? 1 : 0} pages={[
      <form className="tf-hform__page-form" onSubmit={submitPage} noValidate>
        <header className="tf-hform__head">
          <h2 className="tf-hform__name">{title}</h2>
          {description && <p className="tf-hform__lede">{description}</p>}
        </header>
        {questions.map((q, n) => slot(q, n, false))}
        {alert}
        <Button type="submit" variant="primary" size="lg" isPending={sending} className="tf-hform__submit">Submit</Button>
        {later}
      </form>,
      done,
    ]} />
  );

  return (
    <div className="tf-hform">
      <div className="tf-hform__card">{mode === 'one' ? oneAtATime : onePage}</div>
      <a className="tf-hform__foot" href="https://www.timefix.com" target="_blank" rel="noreferrer"><span>Powered by</span><Logo size={16} /></a>
    </div>
  );
}
