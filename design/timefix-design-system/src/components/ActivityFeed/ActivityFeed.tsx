import { Button as AriaButton, Disclosure, DisclosurePanel } from 'react-aria-components';
import { Fragment, createContext, useContext, type ReactNode } from 'react';
import { ArrowRight, Plus, CalendarCheck, Mail, StickyNote, ChevronDown, CalendarX, Phone, Users, CheckSquare, FileText, PenLine } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { AttributeDisplay, AttributeIcon, type Attribute, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import { formatClock, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDate, formatDay, relativeDayLabel } from '../../lib/format.ts';
import { DropIn } from '../Motion/Motion.tsx';
import './ActivityFeed.css';

/** One value that changed: the attribute, before and after. Both draw with the attribute's own display. */
export interface ActivityChange { readonly attribute: Attribute; readonly from: AttributeValue; readonly to: AttributeValue }

/** Something that happened to a record, `at` when it happened. The feed words the day ("Today", "Mon 3 Nov") and the time ("2:05 PM") itself. */
export type ActivityEvent = { readonly id: string; readonly at: Date; readonly actor: string } & (
  | { readonly kind: 'change'; readonly changes: ReadonlyArray<ActivityChange> }
  | { readonly kind: 'created'; readonly object: string }
  | { readonly kind: 'booked'; readonly meeting: string; readonly when: Date }
  | { readonly kind: 'cancelled'; readonly meeting: string; readonly when: Date }
  | { readonly kind: 'emailed'; readonly subject: string; readonly preview?: string }
  | { readonly kind: 'note'; readonly title: string }
  | { readonly kind: 'comment'; readonly body: string }
  /** A call or meeting someone logged: what about, a line of facts (duration, outcome, who else), and notes. */
  | { readonly kind: 'logged'; readonly what: 'call' | 'meeting'; readonly title: string; readonly detail?: string; readonly notes?: string }
  /** A task made or ticked on the record. */
  | { readonly kind: 'task'; readonly title: string; readonly done: boolean }
  /** Anything else said in a line after who did it ("changed Stage to Won", "sent the Contact us form"); `mark` picks the icon. */
  | { readonly kind: 'line'; readonly text: string; readonly mark?: 'change' | 'form' | 'email' | 'call' | 'meeting' }
);

/** The clock the feed reads in, and the moment "Today" is counted from. */
const FeedClock = createContext<{ readonly now: Date; readonly hour12: boolean; readonly actions?: (e: ActivityEvent) => ReactNode }>({ now: new Date(), hour12: true });

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** A meeting's moment: "Thu 13 Nov, 2:00 PM". */
const meetingWhen = (d: Date, hour12: boolean) => `${formatDay(d)}, ${formatClock(minutesOf(d), hour12)}`;
/** An event's label: its time on today or yesterday, else its date. */
function timeLabel(at: Date, now: Date, hour12: boolean): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return sameDay(at, now) || sameDay(at, yesterday) ? formatClock(minutesOf(at), hour12) : formatDate(at, now);
}

/** "Lead → Qualified": the old value, an arrow, the new one, each in its attribute's display. */
export function ChangeDiff({ change }: { readonly change: ActivityChange }) {
  return (
    <span className="tf-diff">
      <span className="tf-diff__attr"><AttributeIcon type={change.attribute.type} size={14} />{change.attribute.name}</span>
      <span className="tf-diff__old"><AttributeDisplay attribute={change.attribute} value={change.from} asLink={false} empty="Empty" maxVisible={2} /></span>
      <ArrowRight className="tf-diff__arrow" size={14} strokeWidth={1.75} aria-label="to" />
      <span className="tf-diff__new"><AttributeDisplay attribute={change.attribute} value={change.to} asLink={false} empty="Empty" maxVisible={2} /></span>
    </span>
  );
}

function Marker({ e }: { readonly e: ActivityEvent }) {
  const icon = (node: ReactNode, tone?: 'time') => <span className={cx('tf-feed__well', tone && `tf-feed__well--${tone}`)} aria-hidden="true">{node}</span>;
  switch (e.kind) {
    case 'created': return icon(<Plus size={14} strokeWidth={1.75} />);
    case 'booked': return icon(<CalendarCheck size={14} strokeWidth={1.75} />, 'time');
    case 'cancelled': return icon(<CalendarX size={14} strokeWidth={1.75} />);
    case 'emailed': return icon(<Mail size={14} strokeWidth={1.75} />);
    case 'note': return icon(<StickyNote size={14} strokeWidth={1.75} />);
    case 'logged': return icon(e.what === 'call' ? <Phone size={14} strokeWidth={1.75} /> : <Users size={14} strokeWidth={1.75} />, 'time');
    case 'task': return icon(<CheckSquare size={14} strokeWidth={1.75} />);
    case 'line': return icon(e.mark === 'form' ? <FileText size={14} strokeWidth={1.75} /> : e.mark === 'email' ? <Mail size={14} strokeWidth={1.75} /> : e.mark === 'call' ? <Phone size={14} strokeWidth={1.75} /> : e.mark === 'meeting' ? <Users size={14} strokeWidth={1.75} /> : <PenLine size={14} strokeWidth={1.75} />, e.mark === 'call' || e.mark === 'meeting' ? 'time' : undefined);
    default: return <Avatar name={e.actor} size={20} />;
  }
}

function Line({ e }: { readonly e: ActivityEvent }) {
  const { hour12 } = useContext(FeedClock);
  const who = <strong className="tf-feed__actor">{e.actor}</strong>;
  switch (e.kind) {
    case 'change': {
      const [first, ...rest] = e.changes;
      return <>{who} changed <strong>{first?.attribute.name}</strong>{rest.length > 0 && <> and {rest.length} other {rest.length === 1 ? 'attribute' : 'attributes'}</>}</>;
    }
    case 'created': return <>{who} created this {e.object}</>;
    case 'booked': return <>{who} booked <strong>{e.meeting}</strong> for <span className="tf-num">{meetingWhen(e.when, hour12)}</span></>;
    case 'cancelled': return <>{who} cancelled <strong>{e.meeting}</strong> on <span className="tf-num">{meetingWhen(e.when, hour12)}</span></>;
    case 'emailed': return <>{who} emailed <strong>{e.subject}</strong></>;
    case 'note': return <>{who} added a note <strong>{e.title}</strong></>;
    case 'comment': return <>{who} commented</>;
    case 'logged': return <>{who} logged a {e.what} <strong>{e.title}</strong></>;
    case 'task': return <>{who} {e.done ? 'finished' : 'added'} the task <strong>{e.title}</strong></>;
    case 'line': return <>{who} {e.text}</>;
  }
}

function Body({ e }: { readonly e: ActivityEvent }) {
  if (e.kind === 'comment') return <p className="tf-feed__comment">{e.body}</p>;
  if (e.kind === 'emailed' && e.preview) return <p className="tf-feed__preview">{e.preview}</p>;
  if (e.kind === 'logged' && (e.detail || e.notes)) return <>{e.detail && <p className="tf-feed__preview tf-num">{e.detail}</p>}{e.notes && <p className="tf-feed__comment">{e.notes}</p>}</>;
  if (e.kind !== 'change') return null;
  const [first, ...rest] = e.changes;
  return (
    <div className="tf-feed__diffs">
      {first && <ChangeDiff change={first} />}
      {rest.length > 0 && (
        <Disclosure className="tf-feed__more">
          {({ isExpanded }) => (
            <>
              <DisclosurePanel className="tf-feed__more-panel"><div className="tf-feed__more-inner">{rest.map((c) => <ChangeDiff key={c.attribute.id} change={c} />)}</div></DisclosurePanel>
              <AriaButton slot="trigger" className="tf-feed__pill">{isExpanded ? 'Hide all changes' : `Show all ${e.changes.length} changes`}</AriaButton>
            </>
          )}
        </Disclosure>
      )}
    </div>
  );
}

function Item({ e, fresh }: { readonly e: ActivityEvent; readonly fresh: boolean }) {
  const { now, hour12, actions } = useContext(FeedClock);
  const acts = actions?.(e);
  const time = timeLabel(e.at, now, hour12);
  return (
    <li className="tf-feed__li">
      <DropIn animate={fresh}>
        <article className="tf-feed__item" aria-label={`${e.actor}, ${time}`}>
          <span className="tf-feed__marker"><Marker e={e} /></span>
          <div className="tf-feed__main">
            <p className="tf-feed__line"><span className="tf-feed__text"><Line e={e} /></span><time className="tf-feed__time" dateTime={e.at.toISOString()}>{time}</time>{acts && <span className="tf-feed__acts">{acts}</span>}</p>
            <Body e={e} />
          </div>
        </article>
      </DropIn>
    </li>
  );
}

function byDay(events: ReadonlyArray<ActivityEvent>, now: Date): ReadonlyArray<readonly [string, ReadonlyArray<ActivityEvent>]> {
  const days: Array<readonly [string, ActivityEvent[]]> = [];
  for (const e of events) {
    const day = relativeDayLabel(e.at, now);
    const last = days[days.length - 1];
    if (last && last[0] === day) last[1].push(e); else days.push([day, [e]]);
  }
  return days;
}

function Days({ events, freshIds }: { readonly events: ReadonlyArray<ActivityEvent>; readonly freshIds?: ReadonlySet<string> }) {
  const { now } = useContext(FeedClock);
  return (
    <>
      {byDay(events, now).map(([day, list]) => (
        <Fragment key={day}>
          <h4 className="tf-feed__day">{day}</h4>
          <ol className="tf-feed__list">{list.map((e) => <Item key={e.id} e={e} fresh={freshIds?.has(e.id) ?? false} />)}</ol>
        </Fragment>
      ))}
    </>
  );
}

/** Props for ActivityFeed. */
export interface ActivityFeedProps {
  /** Newest first. */
  readonly events: ReadonlyArray<ActivityEvent>;
  /** Older events behind "Show n older". */
  readonly older?: ReadonlyArray<ActivityEvent>;
  /** Ids that arrived live; they drop in at the top. */
  readonly freshIds?: ReadonlySet<string>;
  /** 12-hour ("2:05 PM", the default) or 24-hour ("14:05") clock, like the rest of the workspace. */
  readonly hour12?: boolean;
  /** What "Today" is counted from; the current time by default. */
  readonly now?: Date;
  /** A small control at the end of an event's line (a ⋯ menu with Edit and Delete for a logged call); nothing for most events. */
  readonly actions?: (e: ActivityEvent) => ReactNode;
}

/** A record's timeline, newest first under day headings: who did what, value changes as old → new, meetings, emails, notes and comments. */
export function ActivityFeed({ events, older = [], freshIds, hour12 = true, now, actions }: ActivityFeedProps) {
  return (
    <FeedClock.Provider value={{ now: now ?? new Date(), hour12, actions }}>
    <section className="tf-feed" aria-label="Activity">
      <Days events={events} freshIds={freshIds} />
      {older.length > 0 && (
        <Disclosure className="tf-feed__older">
          {({ isExpanded }) => (
            <>
              <DisclosurePanel className="tf-feed__more-panel"><div className="tf-feed__more-inner"><Days events={older} /></div></DisclosurePanel>
              <AriaButton slot="trigger" className="tf-feed__pill tf-feed__pill--older">
                <ChevronDown className="tf-feed__chev" size={14} strokeWidth={1.75} aria-hidden="true" />
                {isExpanded ? 'Hide older' : `Show ${older.length} older`}
              </AriaButton>
            </>
          )}
        </Disclosure>
      )}
    </section>
    </FeedClock.Provider>
  );
}
