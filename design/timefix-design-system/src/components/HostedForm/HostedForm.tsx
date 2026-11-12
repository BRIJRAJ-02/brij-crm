import { Button as AriaButton, I18nProvider, useLocale } from 'react-aria-components';
import { useEffect, useId, useMemo, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Copy, CornerDownLeft } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { useShake } from '../Field/Field.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { ProgressBar } from '../Progress/Progress.tsx';
import { GUEST_WORDS, answerText, checkAnswer, localeOf, type FormLang, type AnswerValue, type BookingSource, type FormAnswers, type FormQuestion } from './answers.ts';
import { QuestionInput, type UploadFile } from './QuestionInput.tsx';
import { guestLookProps, type GuestLookValue } from '../GuestLook/GuestLook.tsx';
import { LookContext, type LookScope } from '../../lib/look.ts';
import './HostedForm.css';

export * from './answers.ts';
export { QuestionInput, type QuestionInputProps, type UploadFile } from './QuestionInput.tsx';

/** One question per screen (Typeform's way), every question on one card (Tally's page), or steps: a page per group of questions. */
export type HostedFormMode = 'one' | 'page' | 'steps';
/** A thank-you message besides the main one: a jump, a rule or a route can end a visit here. `{{score}}` in its words shows the score. */
export interface FormEnding { readonly id: string; readonly title: string; readonly line?: string; readonly action?: { readonly label: string; readonly href: string } }
/** The visitor's language for the form's own words (buttons, hints, steps, answer checks). Question words are the owner's. */
export type { FormLang } from './answers.ts';
/** What a send carries besides the answers: which ending it reached, the score, and the seconds from first answer to send. */
export interface SendMeta { readonly ending?: string; readonly score: number; readonly secs: number }

const WORDS: Readonly<Record<FormLang, { readonly ok: string; readonly submit: string; readonly next: string; readonly back: string; readonly press: string; readonly step: (n: number, of: number) => string; readonly thanks: string; readonly prev: string }>> = {
  en: { ok: 'OK', submit: 'Submit', next: 'Next', back: 'Back', press: 'press', step: (n, of) => `Step ${n} of ${of}`, thanks: 'Thanks, we got it.', prev: 'Previous question' },
  hi: { ok: 'ठीक है', submit: 'भेजें', next: 'आगे', back: 'पीछे', press: 'दबाएँ', step: (n, of) => `चरण ${n} / ${of}`, thanks: 'धन्यवाद, हमें मिल गया।', prev: 'पिछला सवाल' },
  es: { ok: 'Vale', submit: 'Enviar', next: 'Siguiente', back: 'Atrás', press: 'pulsa', step: (n, of) => `Paso ${n} de ${of}`, thanks: 'Gracias, lo tenemos.', prev: 'Pregunta anterior' },
  fr: { ok: 'OK', submit: 'Envoyer', next: 'Suivant', back: 'Retour', press: 'appuyez sur', step: (n, of) => `Étape ${n} sur ${of}`, thanks: 'Merci, c’est reçu.', prev: 'Question précédente' },
  de: { ok: 'OK', submit: 'Senden', next: 'Weiter', back: 'Zurück', press: 'drücke', step: (n, of) => `Schritt ${n} von ${of}`, thanks: 'Danke, ist angekommen.', prev: 'Vorherige Frage' },
};
/** The languages a form can speak, as the picker lists them. */
export const FORM_LANGS: ReadonlyArray<{ readonly id: FormLang; readonly label: string }> = [{ id: 'en', label: 'English' }, { id: 'hi', label: 'Hindi' }, { id: 'es', label: 'Spanish' }, { id: 'fr', label: 'French' }, { id: 'de', label: 'German' }];

/** The score of some answers: each picked choice adds its points. */
export function scoreOf(questions: ReadonlyArray<FormQuestion>, answers: FormAnswers): number {
  return questions.reduce((n, q) => { if (!q.points) return n; const a = answers[q.id]; const picks = Array.isArray(a) ? a.map(String) : a === undefined ? [] : [String(a)]; return n + picks.reduce((m, x) => m + (q.points?.[x] ?? 0), 0); }, 0);
}
/** Questions grouped into steps: a new step starts at each question marked `step` (the first always starts one). */
export function stepsOf(questions: ReadonlyArray<FormQuestion>): ReadonlyArray<ReadonlyArray<number>> {
  const out: number[][] = [];
  questions.forEach((q, n) => { if (n === 0 || q.step) out.push([n]); else out[out.length - 1]?.push(n); });
  return out;
}
/** One logic rule, in plain words: "If <question> is <answer>, go to <question>" (or "the end"). One question at a time only. */
export interface FormRule { readonly id: string; readonly when: string; readonly is: string; readonly goto: string }

/** Props for HostedForm. It never touches the network: answers leave through `onSubmit`. */
export interface HostedFormProps {
  readonly title: string;
  readonly description?: string;
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly mode?: HostedFormMode;
  /** Resolves once the answers are stored; a rejection keeps the visitor on the form with an alert. `meta` says the ending, score and time. */
  readonly onSubmit: (answers: FormAnswers, meta?: SendMeta) => Promise<void>;
  /** Saves a draft and resolves with the link to come back to. Without it there is no "Finish later". */
  readonly onFinishLater?: (answers: FormAnswers) => Promise<string>;
  /** Open times for a booking question. */
  readonly booking?: BookingSource;
  readonly onUpload?: UploadFile;
  /** Thank-you words; the defaults are Tally's plain ones. */
  readonly thanks?: { readonly title: string; readonly line?: string; /** A button on the thank you ("See our pricing"), opening its link in a new tab. */ readonly action?: { readonly label: string; readonly href: string } };
  /** Each question the visitor reaches, once per visit (one at a time only): feeds "Where people stop". */
  readonly onReach?: (questionId: string) => void;
  /** The last button's words ("Submit" unless the owner set their own, like "Get my quote"). */
  readonly submitLabel?: string;
  /** Answers filled from the link (?email=…&name=…), by question id; hidden fields take theirs from here too. */
  readonly prefill?: Readonly<Record<string, string>>;
  /** Who the form is from: a cover band with their logo overlapping it, their name and a line under it. */
  readonly brand?: { readonly name: string; readonly logoSrc?: string; readonly line?: string };
  /** Jumps between questions by answer (one question at a time). */
  readonly logic?: ReadonlyArray<FormRule>;
  /** What the form wears (the same four looks and Custom as booking pages): its accent on buttons and choices, its face, light or dark. */
  readonly look?: GuestLookValue;
  /** Other thank-you messages a jump ('end:<id>') or `endingFor` can end on. */
  readonly endings?: ReadonlyArray<FormEnding>;
  /** Picks the ending for what was answered (the form's After they send routes); undefined is the main thank you. */
  readonly endingFor?: (answers: FormAnswers, score: number) => string | undefined;
  /** The form's own words in this language. */
  readonly lang?: FormLang;
  /** Square corners on the card, choices and buttons. */
  readonly corners?: 'rounded' | 'square';
  /** The page sits framed on another surface (a guest view inside the app): its ground gets the large rounded corners. */
  readonly isFramed?: boolean;
  /** In the builder's preview: the headline, the line under it and the last button are edited in place. */
  readonly onEdit?: { readonly title?: (v: string) => void; readonly description?: (v: string) => void; readonly submitLabel?: (v: string) => void };
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
  readonly lang: FormLang;
}

/** A question's number, heading, description, control and error line; shakes when an attempt is refused (12). */
function QuestionSlot({ question: q, index, value, onChange, error, attempt, large, onPicked, booking, onUpload, lang }: SlotProps) {
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
        {q.title}{q.required ? <span className="tf-hform__req" aria-label={GUEST_WORDS[lang].required}> *</span> : null}
      </h3>
      {q.description && <p className="tf-hform__desc">{q.description}</p>}
      <div ref={ref} className="tf-hform__control">
        <QuestionInput question={q} value={value} onChange={onChange} labelId={`${id}-t`} isInvalid={error !== undefined} onPicked={onPicked} booking={booking} onUpload={onUpload} lang={lang} />
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
export function FinishLater({ onSave, lang = 'en' }: { readonly onSave: () => Promise<string>; /** The form's language for its words. */ readonly lang?: FormLang }) {
  const g = GUEST_WORDS[lang];
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
      {failedCopy && <p className="tf-hform__error" role="alert">{g.copyFailed(link)}</p>}
      {state !== 'saved' && (
        <AriaButton className="tf-hform__later-btn" onPress={() => { void save(); }} isDisabled={state === 'saving'}>
          {state === 'saving' ? g.saving : state === 'failed' ? g.saveFailed : g.finishLater}
        </AriaButton>
      )}
      <div className="tf-hform__later-panel">
        <div className="tf-hform__later-clip">
          <p className="tf-hform__later-row" role="status">
            <span className="tf-hform__later-saved"><SuccessCheck size={14} />{g.saved}</span>
            <Button size="sm" variant="soft" icon={<Copy size={14} strokeWidth={1.75} />} onPress={() => { void copy(); }}>
              <TextSwap swapKey={copied ? 'y' : 'n'}>{copied ? g.copied : g.copyLink}</TextSwap>
            </Button>
          </p>
        </div>
      </div>
    </div>
  );
}

/** The thank you: a drawn green check (10 success check), the words revealing (18), then what was sent. */
function Thanks({ show, title, line, action, children }: { readonly show: boolean; readonly title: string; readonly line?: string; readonly action?: { readonly label: string; readonly href: string }; readonly children: ReactNode }) {
  return (
    <div className="tf-hform__done">
      {show && (
        <>
          <span className="tf-hform__check" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg></span>
          <div className="tf-hform__reveal">
            <h2 className="tf-hform__reveal-line tf-hform__done-title" tabIndex={-1} data-autofocus>{title}</h2>
            {line && <p className="tf-hform__reveal-line tf-hform__done-sub">{line}</p>}
            {action && /^https?:\/\//.test(action.href) && <span className="tf-hform__reveal-line"><Button variant="primary" iconEnd={<ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />} onPress={() => { window.open(action.href, '_blank', 'noopener'); }}>{action.label}</Button></span>}
          </div>
          <div className="tf-hform__reveal-line tf-hform__done-sent">{children}</div>
        </>
      )}
    </div>
  );
}

/** A word edited in place in the builder's preview: it reads as the text it stands for until focused. */
function InPlace({ value, onChange, label, className, placeholder }: { readonly value: string; readonly onChange: (v: string) => void; readonly label: string; readonly className: string; readonly placeholder?: string }) {
  return <input className={cx('tf-hform__edit', className)} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
}

/**
 * The quiet "Powered by Timefix" link under a hosted form, also under other pages Timefix hosts (a shared Insights page).
 * `align="center"` centres it in a column that stretches its children; left out, its parent places it (a form centres it).
 */
export function PoweredByFoot({ align }: { readonly align?: 'center' }) {
  return <a className={cx('tf-hform__foot', align === 'center' && 'tf-hform__foot--center')} href="https://www.timefix.com" target="_blank" rel="noreferrer"><span>Powered by</span><Logo size={16} /></a>;
}

/**
 * The form a guest fills in: one question at a time with a progress bar, Back and OK (Enter goes on), every question on one
 * card, or steps (a page per group). Required answers and emails are checked; a refused step shakes. Ends on a thank you (or one of
 * the form's endings) with the sent answers.
 */
export function HostedForm({ title, description, questions: allQuestions, mode = 'one', onSubmit, onFinishLater, booking, onUpload, logic = [], submitLabel, prefill = {}, brand, onReach, look, thanks: thanksIn, endings = [], endingFor, lang = 'en', corners = 'rounded', onEdit, isFramed = false }: HostedFormProps) {
  const w = WORDS[lang];
  const g = GUEST_WORDS[lang];
  const parentLocale = useLocale().locale;
  const submitWords = submitLabel ?? w.submit;
  const thanks = thanksIn ?? { title: w.thanks, line: g.thanksLine };
  // Hidden fields never show: they carry their value (from the link or the default) straight into the answers.
  const questions = allQuestions.filter((q) => q.kind !== 'hidden');
  const hiddenAnswers = Object.fromEntries(allQuestions.filter((q) => q.kind === 'hidden').map((q) => [q.id, prefill[q.id] ?? q.defaultValue ?? '']));
  const [answers, setAnswers] = useState<FormAnswers>(() => Object.fromEntries(Object.entries(prefill).filter(([k]) => questions.some((q) => q.id === k))));
  const answersRef = useRef(answers); answersRef.current = answers;
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);
  const [ended, setEnded] = useState<string>();
  const firstAt = useRef<number | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const reachOnce = (id: string | undefined) => { if (!id || !onReach || seen.current.has(id)) return; seen.current.add(id); onReach(id); };
  const groups = stepsOf(questions);
  useEffect(() => {
    if (mode === 'one') reachOnce(questions[step]?.id);
    if (mode === 'steps') (groups[step] ?? []).forEach((n) => reachOnce(questions[n]?.id));
  }, [step, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const advance = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(advance.current), []);

  const setAnswer = (id: string) => (next: AnswerValue | ((cur: AnswerValue | undefined) => AnswerValue)) => {
    firstAt.current = firstAt.current ?? Date.now();
    // On one page, a question counts as reached once it has an answer: "Where people stop" works for every layout.
    if (mode === 'page') reachOnce(id);
    setAnswers((all) => {
      const value = typeof next === 'function' ? next(all[id]) : next;
      return { ...all, [id]: value };
    });
    // A shown error clears the moment the answer passes; a new one never appears while typing.
    setErrors((all) => {
      if (all[id] === undefined) return all;
      const q = questions.find((x) => x.id === id);
      const value = typeof next === 'function' ? undefined : next;
      if (!q || value === undefined || checkAnswer(q, value, lang) !== undefined) return all;
      const { [id]: _gone, ...rest } = all;
      return rest;
    });
  };

  const refuse = (found: Readonly<Record<string, string>>) => { setErrors(found); setAttempt((n) => n + 1); };
  const hasLogic = logic.length > 0 || questions.some((q) => q.showIf || q.jumps?.length);
  const send = async (only?: ReadonlySet<string>, ending?: string) => {
    if (sending) return;
    setSending(true); setFailed(false);
    const out = only && hasLogic ? Object.fromEntries(Object.entries(answers).filter(([k]) => only.has(k))) : answers;
    const all = { ...hiddenAnswers, ...out };
    const score = scoreOf(questions, all);
    const end = ending ?? endingFor?.(all, score);
    try { await onSubmit(all, { ending: end, score, secs: firstAt.current ? Math.max(1, Math.round((Date.now() - firstAt.current) / 1000)) : 0 }); setEnded(end); setSent(true); } catch { setFailed(true); } finally { setSending(false); }
  };
  const last = questions.length - 1;
  /** Whether a question with Show only if is on: its source answer matches (a multi-choice answer that includes it counts). */
  const shown = (q: FormQuestion, all: FormAnswers) => { if (!q.showIf) return true; const a = all[q.showIf.questionId]; return Array.isArray(a) ? a.map(String).includes(q.showIf.is) : a !== undefined && String(a) === q.showIf.is; };
  /** Where the visitor came from, so Back retraces a jump instead of landing on a skipped question. */
  const trail = useRef<number[]>([]);
  /** A question's jump for what was said: a form rule, then its own jump by answer, then its Otherwise line. */
  const jumpOf = (q: FormQuestion | undefined, all: FormAnswers): string | undefined => {
    if (!q) return undefined;
    const a = all[q.id];
    const said = Array.isArray(a) ? a.map(String) : a === undefined ? [] : [String(a)];
    const rule = logic.find((r) => r.when === q.id && said.includes(r.is));
    if (rule) return rule.goto;
    const own = q.jumps?.find((j) => j.is !== '*' && said.includes(j.is));
    if (own) return own.to;
    return said.length ? q.jumps?.find((j) => j.is === '*')?.to : undefined;
  };
  /** The step after this one: a matching jump's target, the end (or an ending), or simply the next question. */
  const after = (at: number, all: FormAnswers): number | 'end' | `end:${string}` => {
    const goto = jumpOf(questions[at], all);
    let to: number | 'end' = at === last ? 'end' : at + 1;
    if (goto === 'end') return 'end';
    if (goto?.startsWith('end:')) return goto as `end:${string}`;
    if (goto) { const t = questions.findIndex((x) => x.id === goto); if (t > at) to = t; }
    // A question shown only for another answer is skipped when that answer wasn't given.
    while (to !== 'end' && questions[to] && !shown(questions[to], all)) to = to === last ? 'end' : to + 1;
    return to;
  };
  const endOf = (to: 'end' | `end:${string}`) => (to === 'end' ? undefined : to.slice(4));
  const go = (at: number, all: FormAnswers = answers) => { const to = after(at, all); if (typeof to !== 'number') void send(visited(at), endOf(to)); else { trail.current.push(at); setStep(to); } };
  /** The questions on the path they took: answers left behind on a branch they backed out of aren't sent. */
  const visited = (at: number) => new Set([...trail.current, at].map((n) => questions[n]?.id).filter((x): x is string => x !== undefined));
  const next = () => {
    window.clearTimeout(advance.current);
    const q = questions[step];
    if (!q) return;
    const problem = checkAnswer(q, answers[q.id], lang);
    if (problem) { refuse({ [q.id]: problem }); return; }
    setErrors({});
    go(step);
  };
  const back = () => { window.clearTimeout(advance.current); setErrors({}); const prev = trail.current.pop(); setStep((s) => prev ?? Math.max(0, s - 1)); };
  // A single choice picked by pointer or letter goes on by itself after a short look at the tick, never from the last question.
  const picked = () => {
    if (step === last) return;
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => { const to = after(step, answersRef.current); if (typeof to === 'number') { trail.current.push(step); setStep(to); } }, 450);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, [role=button], [role=grid], [role=row], [role=listbox], [role=option], [role=spinbutton], a, .tf-hform__edit')) return;
    e.preventDefault();
    next();
  };

  const submitPage = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    for (const q of questions) { if (!shown(q, answers)) continue; const p = checkAnswer(q, answers[q.id], lang); if (p) found[q.id] = p; }
    const first = questions.find((q) => found[q.id]);
    if (first) {
      refuse(found);
      const el = e.currentTarget.querySelector<HTMLElement>(`[data-question="${first.id}"] .tf-hform__title`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Hidden answers aren't kept.
    void send(new Set(questions.filter((q) => shown(q, answers)).map((q) => q.id)));
  };

  /* Steps: a page per group; Next checks the group's shown questions, then follows the first jump among them. */
  const stepTrail = useRef<number[]>([]);
  const groupOf = (n: number) => groups.findIndex((g) => g.includes(n));
  const nextStep = () => {
    const g = groups[step] ?? [];
    const found: Record<string, string> = {};
    for (const n of g) { const q = questions[n]; if (!q || !shown(q, answers)) continue; const p = checkAnswer(q, answers[q.id], lang); if (p) found[q.id] = p; }
    if (Object.keys(found).length) { refuse(found); return; }
    setErrors({});
    const jump = g.map((n) => jumpOf(questions[n], answers)).find((x) => x !== undefined);
    const sendNow = (ending?: string) => void send(new Set(stepTrail.current.concat(step).flatMap((s) => (groups[s] ?? []).map((n) => questions[n]?.id ?? ''))), ending);
    if (jump === 'end') { sendNow(); return; }
    if (jump?.startsWith('end:')) { sendNow(jump.slice(4)); return; }
    let to = jump ? groupOf(questions.findIndex((x) => x.id === jump)) : step + 1;
    if (to <= step) to = step + 1;
    // A step whose every question is hidden by Show only if is skipped.
    while (to < groups.length && !(groups[to] ?? []).some((n) => { const q = questions[n]; return q !== undefined && shown(q, answers); })) to += 1;
    if (to >= groups.length) { sendNow(); return; }
    stepTrail.current.push(step); setStep(to);
  };
  const backStep = () => { setErrors({}); const prev = stepTrail.current.pop(); setStep((s) => prev ?? Math.max(0, s - 1)); };

  const slot = (q: FormQuestion, n: number, large: boolean) => (
    <QuestionSlot key={q.id} question={q} index={n} value={answers[q.id]} onChange={setAnswer(q.id)} error={errors[q.id]} attempt={attempt}
      large={large} onPicked={large && (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating' || q.kind === 'yesno' || q.kind === 'scale' || q.kind === 'country') ? picked : undefined} booking={booking} onUpload={onUpload} lang={lang} />
  );
  const alert = failed && <p className="tf-hform__alert" role="alert"><CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />{g.sendFailed}</p>;
  const later = onFinishLater && <FinishLater onSave={() => onFinishLater(answers)} lang={lang} />;
  const score = scoreOf(questions, answers);
  const recall = (x: string | undefined) => x?.replace(/\{\{\s*score\s*\}\}/g, String(score));
  const ending = endings.find((e) => e.id === ended);
  const done = (
    <Thanks show={sent} title={recall(ending?.title ?? thanks.title) ?? ''} line={recall(ending ? ending.line : thanks.line)} action={ending ? ending.action : thanks.action}>
      <SentAnswers questions={questions} answers={answers} booking={booking} />
    </Thanks>
  );
  const submitButton = (onPress: (() => void) | undefined, isPending: boolean, type?: 'submit') => (onEdit?.submitLabel
    ? <InPlace className="tf-hform__edit-btn" label="Edit the button" value={submitLabel ?? ''} placeholder={w.submit} onChange={onEdit.submitLabel} />
    : <Button type={type} variant="primary" size="lg" onPress={onPress} isPending={isPending} className={type ? 'tf-hform__submit' : undefined}>{submitWords}</Button>);
  const nameLine = onEdit?.title ? <InPlace className="tf-hform__edit-name" label="Edit the headline" value={title} placeholder="Untitled form" onChange={onEdit.title} /> : title;
  const ledeLine = (cls: string) => (onEdit?.description ? <InPlace className={cx(cls, 'tf-hform__edit-lede')} label="Edit the line under the headline" value={description ?? ''} placeholder="Add a line under it (optional)" onChange={onEdit.description} />
    : description ? <span className={cls}>{description}</span> : null);

  const oneAtATime = (
    <div className="tf-hform__one" onKeyDown={onKeyDown}>
      <div className="tf-hform__bar" data-hidden={sent || undefined}>
        <IconButton label={w.prev} size="sm" onPress={back} isDisabled={step === 0 || sent}><ArrowLeft size={16} strokeWidth={1.75} /></IconButton>
        <span className="tf-hform__form-name">{nameLine}{step === 0 && !sent ? ledeLine('tf-hform__lede-one') : null}</span>
        <span className="tf-hform__count tf-num" aria-hidden="true">{Math.min(step + 1, questions.length)} / {questions.length}</span>
      </div>
      <ProgressBar size="sm" aria-label={g.progress} value={sent ? questions.length : step} maxValue={questions.length} className="tf-hform__progress" />
      <Pages label={title} page={sent ? questions.length : step} pages={[
        ...questions.map((q, n) => (
          <div key={q.id} className="tf-hform__step">
            {slot(q, n, true)}
            <div className="tf-hform__actions">
              {(() => { const ends = n === last || typeof after(n, answers) !== 'number'; return ends ? submitButton(next, sending && n === step) : (
                <Button variant="primary" size="lg" onPress={next} isPending={sending && n === step} iconEnd={<Check size={16} strokeWidth={2} aria-hidden="true" />}>{w.ok}</Button>); })()}
              <span className="tf-hform__hint" aria-hidden="true">{w.press} <Kbd>Enter</Kbd><CornerDownLeft size={12} strokeWidth={1.75} /></span>
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
          <h2 className="tf-hform__name">{nameLine}</h2>
          {ledeLine('tf-hform__lede')}
        </header>
        {questions.map((q, n) => (shown(q, answers) ? slot(q, n, false) : null))}
        {alert}
        {submitButton(undefined, sending, 'submit')}
        {later}
      </form>,
      done,
    ]} />
  );

  const steps = (
    <div className="tf-hform__steps">
      <header className="tf-hform__head" data-hidden={sent || undefined}>
        <h2 className="tf-hform__name">{nameLine}</h2>
        {step === 0 ? ledeLine('tf-hform__lede') : null}
      </header>
      <ProgressBar size="sm" aria-label={g.progress} value={sent ? groups.length : step} maxValue={groups.length} className="tf-hform__progress tf-hform__progress--steps" />
      <Pages label={title} page={sent ? groups.length : step} pages={[
        ...groups.map((g, s) => {
          const head = questions[g[0] ?? 0]?.step?.title;
          const isLast = s === groups.length - 1;
          return (
            <form key={s} className="tf-hform__page-form" noValidate onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              <p className="tf-hform__stephead"><span className="tf-num">{w.step(s + 1, groups.length)}</span>{head ? <strong>{head}</strong> : null}</p>
              {g.map((n) => { const q = questions[n]; return q && shown(q, answers) ? slot(q, n, false) : null; })}
              {s === step && alert}
              <div className="tf-hform__stepacts">
                {s > 0 && <Button variant="ghost" size="lg" onPress={backStep} icon={<ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />}>{w.back}</Button>}
                {isLast ? submitButton(undefined, sending, 'submit') : <Button type="submit" variant="primary" size="lg" iconEnd={<ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />}>{w.next}</Button>}
              </div>
            </form>
          );
        }),
        done,
      ]} />
      {!sent && later}
    </div>
  );

  // Its dropdowns and date pickers open outside the page: they wear its look (theme, accent, face, corners) and speak its language.
  const scope = useMemo<LookScope | undefined>(() => {
    if (!look && corners !== 'square') return undefined;
    const base = look ? guestLookProps(look) : undefined;
    return { 'data-theme': base?.['data-theme'], style: { ...base?.style, ...(corners === 'square' ? SQUARE_RADII : {}) } };
  }, [look, corners]);
  const page = (
    <div className={cx('tf-hform', look && 'tf-hform--look', isFramed && 'tf-hform--framed')} data-corners={corners === 'square' ? 'square' : undefined} {...(look ? guestLookProps(look) : {})}>
      <div className="tf-hform__card">
        {brand && <div className="tf-hform__brand">
          <span className="tf-hform__cover" aria-hidden="true" />
          {brand.logoSrc ? <img className="tf-hform__logo" src={brand.logoSrc} alt="" /> : <span className="tf-hform__logo tf-hform__logo--initial" aria-hidden="true">{brand.name.slice(0, 1).toUpperCase()}</span>}
          <span className="tf-hform__from"><strong>{brand.name}</strong>{brand.line && <span>{brand.line}</span>}</span>
        </div>}
        {mode === 'one' ? oneAtATime : mode === 'steps' ? steps : onePage}
      </div>
      <PoweredByFoot />
    </div>
  );
  // Always wrapped, so changing the language never remounts the form; English keeps the surrounding locale.
  const spoken = <I18nProvider locale={lang === 'en' ? parentLocale : localeOf(lang)}>{page}</I18nProvider>;
  return <LookContext.Provider value={scope}>{spoken}</LookContext.Provider>;
}
/** Square corners, as the form's root sets them in CSS, for the popups it opens outside itself. */
const SQUARE_RADII = { '--radius-xl': 'var(--radius-xs)', '--radius-lg': 'var(--radius-xs)', '--radius-md': 'var(--radius-xs)', '--radius-sm': 'var(--radius-xs)' } as CSSProperties;
