import { TextArea, TextField, ToggleButton } from 'react-aria-components';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Reply, ThumbsUp, Check, CheckCheck, Eye, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { NumberRoll, DropIn } from '../Motion/Motion.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Mention } from '../RecordChip/RecordChip.tsx';
import './CommentThread.css';

/** The three reactions: agree, done, seen. Icons, never emoji. */
export type ReactionKind = 'agree' | 'done' | 'seen';
const REACTIONS: ReadonlyArray<{ readonly kind: ReactionKind; readonly label: string; readonly icon: ReactNode }> = [
  { kind: 'agree', label: 'Agree', icon: <ThumbsUp size={12} strokeWidth={2} /> },
  { kind: 'done', label: 'Done', icon: <Check size={12} strokeWidth={2.25} /> },
  { kind: 'seen', label: 'Seen', icon: <Eye size={12} strokeWidth={2} /> },
];

/** A comment. `reactions` maps a kind to who reacted; `time` is a label ("2h ago"). */
export interface Comment {
  readonly id: string;
  readonly author: string;
  readonly time: string;
  readonly body: string;
  readonly replyTo?: string;
  /** A top-level comment marked done: it folds away under "Resolved". */
  readonly resolved?: boolean;
  readonly reactions?: Readonly<Partial<Record<ReactionKind, ReadonlyArray<string>>>>;
}

/** Text with each "@Name" of a known person drawn as the shared Mention (`me` marks a mention of the reader). */
export function MentionText({ text, people, me }: { readonly text: string; readonly people: ReadonlyArray<string>; readonly me?: string }) {
  if (people.length === 0) return <>{text}</>;
  const re = new RegExp(`(@(?:${people.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return <>{text.split(re).map((part, i) => (i % 2 === 1 ? <Mention key={i} name={part.slice(1)} isSelf={part.slice(1) === me} /> : part))}</>;
}

function CommentItem({ c, me, people, fresh, onReact, onReply, onResolve }: { readonly c: Comment; readonly me: string; readonly people: ReadonlyArray<string>; readonly fresh: boolean; readonly onReact: (id: string, k: ReactionKind) => void; readonly onReply: (c: Comment) => void; readonly onResolve?: (id: string, resolved: boolean) => void }) {
  const used = REACTIONS.filter((r) => (c.reactions?.[r.kind]?.length ?? 0) > 0);
  return (
    <li>
      <DropIn animate={fresh}>
        <article className="tf-comment" aria-label={`${c.author}, ${c.time}`}>
          <Avatar name={c.author} size={28} />
          <div className="tf-comment__main">
            <p className="tf-comment__head"><strong>{c.author}</strong><time>{c.time}</time></p>
            {c.replyTo && <p className="tf-comment__reply-to"><Reply size={12} strokeWidth={1.75} aria-hidden="true" />Replying to {c.replyTo}</p>}
            <p className="tf-comment__body"><MentionText text={c.body} people={people} me={me} /></p>
            {used.length > 0 && (
              <div className="tf-comment__reactions" role="group" aria-label="Reactions">
                {used.map((r) => {
                  const who = c.reactions?.[r.kind] ?? [];
                  return (
                    <Tooltip key={r.kind} label={`${r.label}: ${who.join(', ')}`}>
                      <ToggleButton className="tf-reaction" isSelected={who.includes(me)} onChange={() => onReact(c.id, r.kind)} aria-label={`${r.label}, ${who.length}`}>
                        {r.icon}<NumberRoll value={who.length} />
                      </ToggleButton>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
          <div className="tf-comment__hover" role="toolbar" aria-label="Comment actions">
            {REACTIONS.map((r) => (
              <Tooltip key={r.kind} label={r.label}><IconButton size="sm" label={r.label} onPress={() => onReact(c.id, r.kind)}>{r.icon}</IconButton></Tooltip>
            ))}
            <Tooltip label="Reply" shortcut="R"><IconButton size="sm" label="Reply" onPress={() => onReply(c)}><Reply size={14} strokeWidth={1.75} /></IconButton></Tooltip>
            {onResolve && !c.replyTo && <Tooltip label={c.resolved ? 'Reopen' : 'Resolve'}><IconButton size="sm" label={c.resolved ? 'Reopen' : 'Resolve'} onPress={() => onResolve(c.id, !c.resolved)}><CheckCheck size={14} strokeWidth={1.75} /></IconButton></Tooltip>}
          </div>
        </article>
      </DropIn>
    </li>
  );
}

/** Props for CommentComposer. */
export interface CommentComposerProps {
  /** Who can be mentioned. */
  readonly people: ReadonlyArray<string>;
  /** Sends the comment; the composer shows sending until it resolves. */
  readonly onSend: (body: string) => Promise<void>;
  readonly replyingTo?: string;
  readonly onCancelReply?: () => void;
  readonly placeholder?: string;
}

/** Writing a comment: type @ to mention someone (arrows, Enter or Tab to pick, Esc to dismiss), ⌘↵ to send. */
export function CommentComposer({ people, onSend, replyingTo, onCancelReply, placeholder = 'Comment, or @mention someone…' }: CommentComposerProps) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<{ readonly start: number; readonly q: string }>();
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const matches = query ? people.filter((p) => p.toLowerCase().includes(query.q.toLowerCase())).slice(0, 6) : [];
  const open = query !== undefined && matches.length > 0;

  const track = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\w ]{0,20})$/.exec(before);
    if (m && !/\s{2}|\s$/.test(m[2] ?? '')) { setQuery({ start: caret - (m[2]?.length ?? 0) - 1, q: m[2] ?? '' }); setActive(0); }
    else setQuery(undefined);
  };
  const pick = (name: string) => {
    if (!query) return;
    const caret = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, query.start)}@${name} ${text.slice(caret)}`;
    const pos = query.start + name.length + 2;
    setText(next);
    setQuery(undefined);
    window.requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); });
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try { await onSend(body); setText(''); } finally { setSending(false); area.current?.focus(); }
  };

  return (
    <div ref={box} className={cx('tf-composer', sending && 'is-sending')}>
      {replyingTo && (
        <p className="tf-composer__replying"><Reply size={12} strokeWidth={1.75} aria-hidden="true" />Replying to {replyingTo}
          {onCancelReply && <IconButton size="sm" label="Cancel reply" onPress={onCancelReply} className="tf-composer__unreply"><X size={12} strokeWidth={2} /></IconButton>}
        </p>
      )}
      <TextField aria-label="Comment" value={text} onChange={(v) => { setText(v); track(v, area.current?.selectionStart ?? v.length); }} isDisabled={sending} className="tf-composer__field">
        <TextArea ref={area} className="tf-composer__input" rows={2} placeholder={placeholder}
          role={open ? 'combobox' : undefined} aria-expanded={open} aria-controls={open ? listId : undefined} aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active] ?? ''); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(undefined); return; }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
          }}
          onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)} />
      </TextField>
      <div className="tf-composer__foot">
        <span className="tf-composer__hint"><Kbd>@</Kbd> mention · <Kbd>⌘↵</Kbd> send</span>
        <IconButton size="sm" variant="primary" label="Send comment" isPending={sending} isDisabled={!text.trim()} onPress={() => void send()}><ArrowUp size={14} strokeWidth={2} /></IconButton>
      </div>
      {/* The shared surface; focus stays in the textarea, so the rows are a virtual-focus listbox driven by the caret. */}
      <Popover triggerRef={box} isOpen={open} isNonModal placement="bottom start" offset={4} width="menu" onOpenChange={(o) => { if (!o) setQuery(undefined); }}>
        <div id={listId} role="listbox" aria-label="People" className="tf-composer__mentions">
          {matches.map((p, i) => (
            <div key={p} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={cx('tf-composer__mention', i === active && 'is-active')}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <Avatar name={p} size={20} /><span>{p}</span>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Props for CommentThread. */
export interface CommentThreadProps {
  readonly comments: ReadonlyArray<Comment>;
  /** The viewer, for which reactions are theirs. */
  readonly me: string;
  readonly people: ReadonlyArray<string>;
  readonly onReact: (id: string, kind: ReactionKind) => void;
  /** `replyTo` is who they answer (shown on the reply); `replyId` is the comment they answered, to file the reply under its thread. */
  readonly onSend: (body: string, replyTo?: string, replyId?: string) => Promise<void>;
  /** Ids that arrived since the thread drew; they drop in. */
  readonly freshIds?: ReadonlySet<string>;
  /** Resolve a top-level comment, or reopen it. Resolved threads fold under "Resolved". */
  readonly onResolve?: (id: string, resolved: boolean) => void;
}

/** A conversation on a record: comments oldest first with mentions, icon reactions and Reply on hover, and the composer at the foot. */
export function CommentThread({ comments, me, people, onReact, onSend, freshIds, onResolve }: CommentThreadProps) {
  const [replying, setReplying] = useState<Comment>();
  const [showResolved, setShowResolved] = useState(false);
  // A thread is a top-level comment and the replies after it; resolved threads fold away.
  const threadOf = (i: number): string | undefined => { for (let j = i; j >= 0; j--) { const x = comments[j]; if (x && !x.replyTo) return x.id; } return undefined; };
  const isResolved = (i: number) => comments.find((x) => x.id === threadOf(i))?.resolved === true;
  const open = comments.filter((_, i) => !isResolved(i));
  const done = comments.filter((_, i) => isResolved(i));
  const item = (c: Comment) => <CommentItem key={c.id} c={c} me={me} people={people} fresh={freshIds?.has(c.id) ?? false} onReact={onReact} onReply={setReplying} onResolve={onResolve} />;
  return (
    <section className="tf-thread" aria-label="Comments">
      {open.length === 0 ? <p className="tf-thread__empty">{done.length ? 'Every thread is resolved.' : 'No comments yet. Start the conversation below.'}</p> : <ol className="tf-thread__list">{open.map(item)}</ol>}
      {done.length > 0 && <>
        <Button size="sm" variant="ghost" onPress={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : `Resolved (${done.filter((c) => !c.replyTo).length})`}</Button>
        {showResolved && <ol className="tf-thread__list tf-thread__list--resolved">{done.map(item)}</ol>}
      </>}
      <CommentComposer people={people} replyingTo={replying?.author} onCancelReply={() => setReplying(undefined)}
        onSend={async (body) => { await onSend(body, replying?.author, replying?.id); setReplying(undefined); }} />
    </section>
  );
}
