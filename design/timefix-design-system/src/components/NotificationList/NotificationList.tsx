import { Button as AriaButton, Dialog, DialogTrigger, GridList, GridListHeader, GridListItem, GridListSection, Popover } from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Archive, Check, CheckCheck, Inbox } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { Collapse } from '../Motion/Motion.tsx';
import './NotificationList.css';

/** One notification: who, what they did, on what, and when. `group` is "Today" or "Earlier". */
export interface Notification {
  readonly id: string;
  readonly actor: string;
  /** The verb phrase between actor and object ("mentioned you on"). */
  readonly action: string;
  readonly object: string;
  /** A line quoted from the comment or booking. */
  readonly excerpt?: string;
  readonly time: string;
  readonly group: 'Today' | 'Earlier';
  readonly read: boolean;
}

/** A bell with a count badge that slides and pops in when something new arrives (transitions.dev 03 notification badge). Pressing it opens `children` in a popover. */
export function NotificationBell({ count, children }: { readonly count: number; readonly children: ReactNode }) {
  const shown = useRef(count);
  if (count > 0) shown.current = count;
  return (
    <DialogTrigger>
      <span className="tf-bell">
        <Tooltip label="Notifications" shortcut="G N"><IconButton label={count ? `Notifications, ${count} unread` : 'Notifications'} variant="secondary"><Bell size={16} strokeWidth={1.75} /></IconButton></Tooltip>
        <span className="tf-bell__badge" data-open={count > 0} aria-hidden="true"><span className="tf-bell__dot">{shown.current > 9 ? '9+' : shown.current}</span></span>
      </span>
      <Popover placement="bottom end" offset={8} className="tf-bell-pop tf-overlay">
        <Dialog aria-label="Notifications" className="tf-bell-pop__dialog">{children}</Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** Props for NotificationList. */
export interface NotificationListProps {
  readonly items: ReadonlyArray<Notification>;
  /** Opens a notification (and marks it read). */
  readonly onOpen: (id: string) => void;
  readonly onReadChange: (id: string, read: boolean) => void;
  readonly onReadAll: () => void;
  /** Called once the Undo window has passed. */
  readonly onArchive: (id: string) => void;
}

const UNDO_MS = 5000;

/** The inbox: unread dots, who did what and when, grouped Today and Earlier; Mark all read fades the dots; Archive folds a row into "Archived · Undo" before it goes. */
export function NotificationList({ items, onOpen, onReadChange, onReadAll, onArchive }: NotificationListProps) {
  const [archiving, setArchiving] = useState<ReadonlyMap<string, 'undo' | 'gone'>>(new Map());
  const timers = useRef(new Map<string, number[]>());
  useEffect(() => () => { for (const ts of timers.current.values()) ts.forEach((t) => window.clearTimeout(t)); }, []);
  const setPhase = (id: string, phase?: 'undo' | 'gone') => setArchiving((m) => { const n = new Map(m); if (phase) n.set(id, phase); else n.delete(id); return n; });
  const archive = (id: string) => {
    setPhase(id, 'undo');
    timers.current.set(id, [
      window.setTimeout(() => setPhase(id, 'gone'), UNDO_MS),
      window.setTimeout(() => { onArchive(id); setPhase(id); timers.current.delete(id); }, UNDO_MS + 260),
    ]);
  };
  const undo = (id: string) => { for (const t of timers.current.get(id) ?? []) window.clearTimeout(t); timers.current.delete(id); setPhase(id); };
  const unread = items.filter((n) => !n.read && !archiving.has(n.id)).length;
  const groups = (['Today', 'Earlier'] as const).map((g) => [g, items.filter((n) => n.group === g)] as const).filter(([, list]) => list.length > 0);

  return (
    <section className="tf-inbox" aria-label="Notifications"
      onKeyDown={(e) => {
        if (e.key !== 'e' || e.metaKey || e.ctrlKey || !(e.target instanceof HTMLElement) || e.target.closest('input, textarea')) return;
        const id = e.target.closest<HTMLElement>('[data-key]')?.dataset.key;
        if (id && !archiving.has(id)) { e.preventDefault(); archive(id); }
      }}>
      <header className="tf-inbox__head">
        <h3 className="tf-inbox__title">Inbox</h3>
        <span className="tf-inbox__count tf-num">{unread ? `${unread} unread` : 'All read'}</span>
        <Button size="sm" variant="ghost" icon={<CheckCheck size={14} strokeWidth={1.75} />} isDisabled={unread === 0} onPress={onReadAll}>Mark all read</Button>
      </header>
      {items.length === 0 ? (
        <p className="tf-inbox__empty"><Inbox size={20} strokeWidth={1.75} aria-hidden="true" /><strong>You're all caught up</strong><span>Mentions, assignments and bookings land here.</span></p>
      ) : (
        <GridList aria-label="Notifications" className="tf-inbox__list" onAction={(key) => { const id = String(key); if (!archiving.has(id)) onOpen(id); }}>
          {groups.map(([g, list]) => (
            <GridListSection key={g} className="tf-inbox__section">
              <GridListHeader className="tf-inbox__group">{g}</GridListHeader>
              {list.map((n) => {
                const phase = archiving.get(n.id);
                return (
                  <GridListItem key={n.id} id={n.id} textValue={phase ? 'Archived' : `${n.actor} ${n.action} ${n.object}, ${n.time}${n.read ? '' : ', unread'}`} className="tf-inbox__row">
                    <Collapse open={phase !== 'gone'}>
                      {phase ? (
                        <div className="tf-inbox__undo"><Archive size={14} strokeWidth={1.75} aria-hidden="true" /><span>Archived</span><span aria-hidden="true">·</span><AriaButton className="tf-inbox__undo-btn" onPress={() => undo(n.id)}>Undo</AriaButton></div>
                      ) : (
                        <div className={cx('tf-inbox__item', !n.read && 'is-unread')}>
                          <span className="tf-inbox__dot" aria-hidden="true" />
                          <Avatar name={n.actor} size={28} />
                          <span className="tf-inbox__text">
                            <span className="tf-inbox__sentence"><strong>{n.actor}</strong> {n.action} <strong>{n.object}</strong></span>
                            {n.excerpt && <span className="tf-inbox__excerpt">{n.excerpt}</span>}
                          </span>
                          <time className="tf-inbox__time">{n.time}</time>
                          <span className="tf-inbox__actions">
                            <Tooltip label={n.read ? 'Mark unread' : 'Mark read'}><IconButton size="sm" label={n.read ? 'Mark unread' : 'Mark read'} onPress={() => onReadChange(n.id, !n.read)}>{n.read ? <span className="tf-inbox__dot-icon" /> : <Check size={14} strokeWidth={1.75} />}</IconButton></Tooltip>
                            <Tooltip label="Archive" shortcut="E"><IconButton size="sm" label="Archive" onPress={() => archive(n.id)}><Archive size={14} strokeWidth={1.75} /></IconButton></Tooltip>
                          </span>
                        </div>
                      )}
                    </Collapse>
                  </GridListItem>
                );
              })}
            </GridListSection>
          ))}
        </GridList>
      )}
    </section>
  );
}
