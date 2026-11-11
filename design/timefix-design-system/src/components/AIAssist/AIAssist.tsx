import { Button as AriaButton, TextArea, TextField } from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkles, ArrowUp, Square, Copy, Check, NotebookPen, X, RotateCcw } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton, Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { ThinkingLine } from '../Motion/Motion.tsx';
import './AIAssist.css';

/** The violet AI sparkle: the only place the `ai` colour appears. Marks a value AI filled or a control that asks AI. */
export function AIMark({ size = 14, label = 'Filled by AI' }: { readonly size?: number; readonly label?: string }) {
  return <span className="tf-ai-mark" role="img" aria-label={label}><Sparkles size={size} strokeWidth={1.75} /></span>;
}

/** "AI enriched" (or your words) as a white tag with the violet sparkle: a fact AI found, waiting to be trusted or edited. */
export function AITag({ children = 'AI enriched' }: { readonly children?: ReactNode }) {
  return <Tag size="sm" outline icon={<AIMark size={12} label="" />}>{children}</Tag>;
}

/** Model output that resolves word by word through opacity as it arrives (transitions.dev 30 streaming text). Pass the text so far. */
export function StreamText({ text }: { readonly text: string }) {
  const words = text.split(/(\s+)/);
  return <span className="tf-stream">{words.map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} className="tf-stream__w">{w}</span>))}</span>;
}

/** One question and its answer, through its phases. */
interface Turn { readonly id: number; readonly question: string; readonly answer: string; readonly phase: 'thinking' | 'streaming' | 'done' | 'stopped' }

/** Props for AIAssist. */
export interface AIAssistProps {
  /** What the AI is looking at ("Acme Corp"). */
  readonly context: string;
  readonly suggestions: ReadonlyArray<string>;
  /** The status lines shown while it thinks. */
  readonly thinking?: ReadonlyArray<string>;
  /** Answers a question. The panel streams the returned text in. */
  readonly onAsk: (question: string) => Promise<string>;
  readonly onInsertNote?: (answer: string) => void;
  readonly onClose?: () => void;
}

/** The Ask AI panel: suggested questions, a prompt, thinking states while it works, the answer streaming in, then Copy and Save as note. */
export function AIAssist({ context, suggestions, thinking = ['Reading the timeline', 'Checking notes and emails', 'Writing the answer'], onAsk, onInsertNote, onClose }: AIAssistProps) {
  const [draft, setDraft] = useState('');
  const [turn, setTurn] = useState<Turn>();
  const [copied, setCopied] = useState(false);
  const run = useRef(0);
  const busy = turn?.phase === 'thinking' || turn?.phase === 'streaming';

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const id = ++run.current;
    setDraft('');
    setTurn({ id, question, answer: '', phase: 'thinking' });
    const full = await onAsk(question);
    const words = full.split(/(\s+)/);
    let n = 0;
    const tick = () => {
      if (run.current !== id) return;
      n += 2;
      setTurn((t) => (t && t.id === id && t.phase !== 'stopped' ? { ...t, answer: words.slice(0, n).join(''), phase: n >= words.length ? 'done' : 'streaming' } : t));
      if (n < words.length) window.setTimeout(tick, 60);
    };
    tick();
  };
  const stop = () => { run.current += 1; setTurn((t) => (t ? { ...t, phase: 'stopped' } : t)); };
  const copy = () => { if (turn) void navigator.clipboard?.writeText(turn.answer).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };

  return (
    <section className="tf-ai" aria-label="Ask AI">
      <header className="tf-ai__head">
        <AIMark size={16} label="" />
        <h3 className="tf-ai__title">Ask AI</h3>
        <span className="tf-ai__context">about {context}</span>
        {turn && !busy && <IconButton size="sm" label="New question" onPress={() => setTurn(undefined)}><RotateCcw size={14} strokeWidth={1.75} /></IconButton>}
        {onClose && <IconButton size="sm" label="Close" onPress={onClose}><X size={14} strokeWidth={1.75} /></IconButton>}
      </header>

      <div className="tf-ai__body">
        {!turn ? (
          <div className="tf-ai__start">
            <div className="tf-ai__reveal">
              <strong className="tf-ai__line tf-ai__line--1">What do you want to know about {context}?</strong>
              <span className="tf-ai__line tf-ai__line--2">Answers come from this record's activity, notes, emails and meetings.</span>
            </div>
            <div className="tf-ai__suggestions">
              {suggestions.map((s, i) => (
                <AriaButton key={s} className="tf-ai__chip" style={{ '--tf-i': i } as React.CSSProperties} onPress={() => void ask(s)}>{s}</AriaButton>
              ))}
            </div>
          </div>
        ) : (
          <div className="tf-ai__turn">
            <p className="tf-ai__question">{turn.question}</p>
            {turn.phase === 'thinking' ? (
              <p className="tf-ai__thinking"><AIMark size={14} label="" /><ThinkingLine states={thinking} /></p>
            ) : (
              <div className="tf-ai__answer" aria-live="polite" aria-busy={busy}>
                <StreamText text={turn.answer} />
                {turn.phase === 'stopped' && <span className="tf-ai__stopped"> Stopped.</span>}
              </div>
            )}
            {(turn.phase === 'done' || turn.phase === 'stopped') && (
              <div className="tf-ai__actions">
                <Button size="sm" variant="ghost" onPress={copy} icon={<span className="tf-ai__swap" data-state={copied ? 'b' : 'a'}><Copy className="tf-ai__swap-a" size={14} strokeWidth={1.75} /><Check className="tf-ai__swap-b" size={14} strokeWidth={2} /></span>}>{copied ? 'Copied' : 'Copy'}</Button>
                {onInsertNote && <Button size="sm" variant="ghost" icon={<NotebookPen size={14} strokeWidth={1.75} />} onPress={() => onInsertNote(turn.answer)}>Save as note</Button>}
              </div>
            )}
          </div>
        )}
      </div>

      <TextField aria-label="Ask a question" value={draft} onChange={setDraft} className="tf-ai__prompt">
        <TextArea className="tf-ai__input" rows={1} placeholder={`Ask about ${context}…`}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft); } }} />
        <span className="tf-ai__prompt-foot">
          <span className="tf-ai__hint"><Kbd>↵</Kbd> to ask</span>
          {busy
            ? <IconButton size="sm" variant="secondary" label="Stop" onPress={stop}><Square size={12} strokeWidth={2} /></IconButton>
            : <IconButton size="sm" variant="primary" label="Ask" isDisabled={!draft.trim()} onPress={() => void ask(draft)}><ArrowUp size={14} strokeWidth={2} /></IconButton>}
        </span>
      </TextField>
    </section>
  );
}
