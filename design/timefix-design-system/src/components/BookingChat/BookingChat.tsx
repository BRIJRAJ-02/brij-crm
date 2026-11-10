import { Button as AriaButton, Input, TextField } from 'react-aria-components';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUp, CalendarPlus } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { Spinner, SuccessCheck, ThinkingLine } from '../Motion/Motion.tsx';
import { StreamText } from '../AIAssist/AIAssist.tsx';
import { cx } from '../../lib/cx.ts';
import './BookingChat.css';

/** One offered time: the page's id for it, the label shown ("2:30 PM") and, if it differs, what a screen reader says. */
export interface BookingChatTime { readonly id: string; readonly label: string; readonly name?: string }
/** The times of one day under the day's name ("Thu 13 Nov"). */
export interface BookingChatDay { readonly day: string; readonly times: ReadonlyArray<BookingChatTime> }

/** One line of the conversation, oldest first. Only the last host line's times and suggestions can be pressed. */
export interface BookingChatLine {
  readonly id: string;
  readonly role: 'guest' | 'host';
  readonly text: string;
  readonly days?: ReadonlyArray<BookingChatDay>;
  readonly suggestions?: ReadonlyArray<string>;
  /** The reply is still arriving: its words resolve as they come, and its times wait until it is whole. */
  readonly isStreaming?: boolean;
}

/** The booking the chat made, for the booked card. */
export interface BookingChatBooked { readonly title: string; readonly when: string; readonly where: string; readonly email?: string }

/** Props for BookingChat. It holds no conversation of its own: the page owns `lines` and answers `onSend`. */
export interface BookingChatProps {
  readonly host: { readonly name: string; readonly avatarSrc?: string };
  /** "Discovery call · 30 min". */
  readonly title: string;
  readonly lines: ReadonlyArray<BookingChatLine>;
  /** A reply is being worked out: the host's bubble shows the thinking line. */
  readonly isThinking?: boolean;
  readonly thinking?: ReadonlyArray<string>;
  /** Set once booked: the booked card ends the thread and the box closes. */
  readonly booked?: BookingChatBooked;
  readonly onSend: (text: string) => void;
  /** Books an offered time in place; the chip shows it working until this resolves. */
  readonly onPickTime: (time: BookingChatTime, day: string) => Promise<void> | void;
  readonly placeholder?: string;
  /** Inside another card (the booking page's Chat view): no header, frame or foot of its own. */
  readonly bare?: boolean;
}

/** The guest booking assistant: host bubbles on the left, the guest's on the right, offered times that book in place, replies that stream in, a thinking line while it looks, and a booked card at the end. */
export function BookingChat({ host, title, lines, isThinking = false, thinking, booked, onSend, onPickTime, placeholder = 'When works for you?', bare = false }: BookingChatProps) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string>();
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = host.name.split(' ')[0] ?? host.name;
  const states = thinking ?? [`Checking ${first}'s calendar`, 'Finding open times'];

  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' });
  }, [lines, isThinking, booked, pending]);

  const lastHost = [...lines].reverse().find((l) => l.role === 'host');
  const offersOpen = lastHost !== undefined && lastHost === lines[lines.length - 1] && !lastHost.isStreaming && !isThinking && !booked;
  const busy = isThinking || pending !== undefined || lastHost?.isStreaming === true;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || booked) return;
    onSend(t);
    setDraft('');
    input.current?.focus();
  };
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); send(draft); };
  const pick = async (time: BookingChatTime, day: string) => {
    if (busy) return;
    setPending(time.id);
    try { await onPickTime(time, day); } finally { setPending(undefined); }
  };

  return (
    <div className={bare ? 'tf-chat tf-chat--bare' : 'tf-chat'}>
      <section className="tf-chat__card" aria-label={`Book with ${host.name}`}>
        {!bare && <header className="tf-chat__head">
          <Avatar name={host.name} src={host.avatarSrc} size={36} />
          <div className="tf-chat__who">
            <h2 className="tf-chat__name">{host.name}</h2>
            <p className="tf-chat__title">{title}</p>
          </div>
        </header>}

        <div ref={thread} className="tf-chat__thread" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversation" tabIndex={0}>
          {lines.map((line, n) => {
            const prev = lines[n - 1];
            const startsRun = prev?.role !== line.role;
            const isOpen = offersOpen && line === lastHost;
            return (
              <div key={line.id} className={cx('tf-chat__line', `tf-chat__line--${line.role}`, startsRun && 'tf-chat__line--start')}>
                {line.role === 'host' && <span className="tf-chat__face">{startsRun && <Avatar name={host.name} src={host.avatarSrc} size={28} />}</span>}
                <div className="tf-chat__stack">
                  <p className="tf-chat__bubble">
                    {line.role === 'host' ? <StreamText text={line.text} /> : line.text}
                    {line.isStreaming && <span className="tf-chat__caret" aria-hidden="true" />}
                  </p>
                  {isOpen && line.days && line.days.length > 0 && (
                    <div className="tf-chat__offers">
                      {line.days.map((d, di) => (
                        <div key={d.day} className="tf-chat__day" style={{ '--tf-chat-i': di } as CSSProperties}>
                          <span className="tf-chat__day-name">{d.day}</span>
                          <span className="tf-chat__times">
                            {d.times.map((t) => (
                              <AriaButton key={t.id} className="tf-chat__time" aria-label={`Book ${d.day}, ${t.name ?? t.label}`}
                                data-pending={pending === t.id || undefined} isDisabled={pending !== undefined && pending !== t.id}
                                onPress={() => void pick(t, d.day)}>
                                {pending === t.id && <Spinner size={14} label="Booking" />}
                                <span className="tf-num">{t.label}</span>
                              </AriaButton>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {isOpen && line.suggestions && line.suggestions.length > 0 && (
                    <div className="tf-chat__suggest" style={{ '--tf-chat-i': line.days?.length ?? 0 } as CSSProperties}>
                      {line.suggestions.map((s) => (
                        <AriaButton key={s} className="tf-chat__chip" isDisabled={pending !== undefined} onPress={() => send(s)}>{s}</AriaButton>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isThinking && (
            <div className={cx('tf-chat__line', 'tf-chat__line--host', lines[lines.length - 1]?.role !== 'host' && 'tf-chat__line--start')}>
              <span className="tf-chat__face">{lines[lines.length - 1]?.role !== 'host' && <Avatar name={host.name} src={host.avatarSrc} size={28} />}</span>
              <p className="tf-chat__bubble tf-chat__bubble--thinking"><ThinkingLine states={states} hold={1400} /></p>
            </div>
          )}

          {booked && (
            <div className="tf-chat__booked" role="status">
              <span className="tf-chat__check" aria-hidden="true"><SuccessCheck size={20} /></span>
              <h3 className="tf-chat__booked-title">You're booked</h3>
              <p className="tf-chat__booked-sub">{booked.email ? `An invitation is on its way to ${booked.email}.` : 'An invitation is on its way.'}</p>
              <dl className="tf-chat__summary">
                <dt>What</dt><dd>{booked.title}</dd>
                <dt>When</dt><dd className="tf-num">{booked.when}</dd>
                <dt>Where</dt><dd>{booked.where}</dd>
              </dl>
              <span className="tf-row tf-chat__add">
                {['Google', 'Outlook', 'Apple'].map((p) => <Button key={p} size="sm" icon={<CalendarPlus size={14} strokeWidth={1.75} />}>{p}</Button>)}
              </span>
            </div>
          )}
        </div>

        <form className="tf-chat__composer" onSubmit={submit} data-closed={booked ? true : undefined}>
          <TextField aria-label={placeholder} value={draft} onChange={setDraft} isDisabled={booked !== undefined} className="tf-chat__field">
            <Input ref={input} className="tf-chat__input" placeholder={booked ? 'Booked. See you then.' : placeholder} autoComplete="off" />
          </TextField>
          <IconButton type="submit" label="Send" variant={draft.trim() && !busy ? 'primary' : 'secondary'} isDisabled={booked !== undefined || busy || !draft.trim()} size="lg" className="tf-chat__send">
            <ArrowUp size={16} strokeWidth={2} />
          </IconButton>
        </form>
      </section>
      {!bare && <a className="tf-chat__foot" href="https://www.timefix.com" target="_blank" rel="noreferrer">
        <span>Powered by</span><Logo size={16} />
      </a>}
      {!bare && <a className="tf-chat__foot tf-chat__foot--cta" href="https://www.timefix.com/signup" target="_blank" rel="noreferrer">Create your own booking page, free</a>}
    </div>
  );
}
