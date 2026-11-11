// Small parts the flow's screens share: copy with a morph, the scaled guest preview, page pictures, menus and the page slide.
import { copyText } from '../../lib/copy.ts';
import { type Key } from 'react-aria-components';
import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Clock, Code2, Copy, CopyPlus, History, LayoutList, Link2, Mail, MessageCircle, MoreHorizontal, Pencil, QrCode as QrIcon, Share, Share2, Ticket, Trash2, X as XIcon } from 'lucide-react';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { BookingFlow, type BookingFlowProps, type BookingRequest } from '../BookingFlow/BookingFlow.tsx';
import { BookingPagePicture } from '../BookingPagePicture/BookingPagePicture.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { SuccessCheck, TextMorph, TextSwap } from '../Motion/Motion.tsx';
import { cx } from '../../lib/cx.ts';
import { ShareSheet } from '../ShareSheet/ShareSheet.tsx';
import { HOST, PLACES, pageUrl, ZONES, ZONE_OFFSET, HOST_ZONE, guestZone, offsetOf, zonesWithGuest, hoursFor, lengthOf, lengthsText, openTimes, placeOf, type BookingPage, type BookingsState, type PlaceKind, placeLabel } from './state.ts';

/** 16px and 14px Lucide icons. */
export const i16 = { size: 16, strokeWidth: 1.75 } as const;
export const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** A "Copy …" button whose label morphs to "Copied" for a moment (33 text morph, 09 icon swap). */
export function CopyButton({ value, label = 'Copy link', variant = 'primary', size = 'md', onCopied }: {
  readonly value: string; readonly label?: string; readonly variant?: 'primary' | 'secondary' | 'ghost'; readonly size?: 'sm' | 'md'; readonly onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <>
      <Button variant={variant} size={size} icon={<span className="tf-bkf__swapicon" data-on={copied || undefined}><Copy {...i14} /><SuccessCheck size={14} /></span>}
        onPress={() => { void copyText(value).then((ok) => { setCopied(ok); if (ok) onCopied?.(); }); }}>
        <TextMorph text={copied ? 'Copied' : label} />
      </Button>
      <span className="tf-sr-only" role="status">{copied ? 'Copied to the clipboard' : ''}</span>
    </>
  );
}

/** The real BookingFlow drawn at a scale and inert: the guest's view beside every form. Its box follows its height (01 card resize). */
export function ScaledPreview({ children, designWidth, label, fill = false }: { readonly children: ReactNode; readonly designWidth: number; readonly label: string; readonly fill?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 0.4, height: 0 });
  useLayoutEffect(() => {
    const o = outer.current;
    const n = inner.current;
    if (!o || !n) return undefined;
    const update = () => { const scale = Math.min(1, o.clientWidth / designWidth); setBox({ scale, height: Math.ceil(n.offsetHeight * scale) }); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(n);
    return () => ro.disconnect();
  }, [designWidth]);
  return (
    <div ref={outer} className={cx('tf-bkf__scaled', fill && 'tf-bkf__scaled--fill')} style={{ height: fill ? undefined : box.height || undefined }} inert aria-label={label} role="img">
      <div ref={inner} className="tf-bkf__scaled-inner" style={{ width: designWidth, transform: `scale(${box.scale})` }}>{children}</div>
    </div>
  );
}

/** A page's guest view (BookingFlow) wired to the flow's state. */
export function GuestView({ page, state, onBook, length, place, onLength, onPlace, chat, chatBooked, after, guestIs }: {
  readonly page: BookingPage; readonly state: BookingsState; readonly onBook: (r: BookingRequest) => Promise<void>; readonly length?: number; readonly place?: PlaceKind;
  /** Given, the guest can switch length or place inside the booking card. */
  readonly onLength?: (n: number) => void; readonly onPlace?: (k: PlaceKind) => void;
  /** Book by chat, offered as the third view. */
  readonly chat?: ReactNode;
  /** The chat's booking, which moves the card to the success screen. */
  readonly chatBooked?: BookingFlowProps['chatBooked'];
  /** What the guest does after booking (cancel, move, guests), passed through to the host side. */
  readonly after?: Pick<BookingFlowProps, 'onCancelled' | 'onMoved' | 'onGuestsChange'>;
  /** A guest we already know (moving their own booking): their name and email are filled in. */
  readonly guestIs?: { readonly name: string; readonly email: string };
}) {
  const now = new Date();
  const len = length ?? lengthOf(page);
  const where = PLACES[place ?? placeOf(page)];
  const slotsFor = (d: CalendarDate) => openTimes(page, state, new Date(d.year, d.month - 1, d.day), now, len);
  return (
    <BookingFlow {...after} zoneOffset={(tz) => ZONE_OFFSET[tz] ?? offsetOf(tz)} host={{ name: page.hosts.length > 1 && page.hostMode !== 'one' ? 'the team' : page.hosts[0] ?? HOST }} title={page.name || 'Untitled page'} durationMinutes={len}
      location={{ kind: where.guest, label: placeLabel(page, place ?? placeOf(page)) }} today={todayIn(getLocalTimeZone())}
      isDayOpen={(d) => slotsFor(d).length > 0} slotsFor={slotsFor} timeZones={zonesWithGuest()} defaultTimeZone={guestZone()} onBook={onBook}
      team={page.hostMode !== 'one' && page.hosts.length > 1 ? page.hosts : undefined}
      prefill={guestIs ?? (page.whoCanBook === 'form' ? { name: 'Maya Chen', email: 'maya@acme.com' } : undefined)}
      guestBusy={(d) => (d.day % 2 === 0 ? [{ start: 9 * 60, end: 11 * 60 }, { start: 15 * 60, end: 16 * 60 }] : [{ start: 13 * 60, end: 14 * 60 + 30 }])}
      defaultView={page.defaultView ?? 'month'} chat={chat} chatBooked={chatBooked}
      changeCutoff={(page.cancelCutoff ?? 0) > 0 || (page.moveCutoff ?? 0) > 0 ? { cancelHours: page.cancelCutoff ?? 0, moveHours: page.moveCutoff ?? 0, message: page.tooLateMessage } : undefined}
      durations={page.durations} onDurationChange={onLength} places={page.places.map((k) => ({ id: k, label: placeLabel(page, k) }))} placeId={place ?? placeOf(page)} onPlaceChange={onPlace ? (k) => onPlace(k as PlaceKind) : undefined} />
  );
}
/** onBook for previews: nothing happens. */
export const noBook = () => Promise.resolve();

/** A page's picture (BookingPagePicture) at a third of its size for a list row. */
export function PagePicture({ page, state }: { readonly page: BookingPage; readonly state: BookingsState }) {
  const week = hoursFor(page, state);
  return (
    <span className="tf-bkf__pic" aria-hidden="true">
      <span className="tf-bkf__pic-scale">
        <BookingPagePicture host={page.owner} title={page.name} duration={lengthsText(page)} openDays={HOURS_DAYS.map((d) => week[d].on)} hue={page.accent} />
      </span>
    </span>
  );
}

/** The ways to share a page. */
export type ShareHow = 'copy' | 'times' | 'once' | 'embed' | 'linkpage' | 'qr' | 'email' | 'whatsapp' | 'more';
/** One Share button for a page: one menu, ordered by how often each is used. */
export function ShareMenu({ page, onShare, size = 'sm', handle = 'priya' }: { readonly page: BookingPage; readonly onShare: (page: BookingPage, how: ShareHow) => void; readonly size?: 'sm' | 'md'; /** The workspace's handle, for the link and its code. */ readonly handle?: string }) {
  const [open, setOpen] = useState(false);
  const live = page.links.filter((l) => !l.revoked).length;
  const run = (how: ShareHow) => { setOpen(false); onShare(page, how); };
  return (
    <>
      <Button size={size} variant="secondary" icon={<Share2 {...i14} />} aria-label={`Share ${page.name}`} onPress={() => setOpen(true)}>Share</Button>
      <ShareSheet isOpen={open} onOpenChange={setOpen} title={`Share ${page.name}`} url={pageUrl(page.slug, handle)} name={page.name} invite="Pick a time that suits you:" onSite={() => run('embed')}
        description={page.isOn ? undefined : 'It’s hidden, so guests see that it isn’t taking bookings until you turn it on.'}
        extra={<>
          <Button size="sm" variant="ghost" icon={<Clock {...i14} />} onPress={() => run('times')}>Offer specific times</Button>
          <Button size="sm" variant="ghost" icon={<Ticket {...i14} />} onPress={() => run('once')}>{live ? `One-time links · ${live}` : 'One-time link'}</Button>
          <Button size="sm" variant="ghost" icon={<LayoutList {...i14} />} onPress={() => run('linkpage')}>Add to link page</Button>
        </>} />
    </>
  );
}

/** The ⋯ menu of a page: Edit, Duplicate, then Delete under a line. */
/** Copy to another workspace, when the app around Bookings offers it: every page's ⋯ menu then has the item. */
export const CopyPageContext = createContext<((page: BookingPage) => void) | undefined>(undefined);

export function PageMoreMenu({ page, onAction, withEdit = true, withVersions = false }: { readonly page: BookingPage; readonly onAction: (key: 'edit' | 'duplicate' | 'delete' | 'versions') => void; readonly withEdit?: boolean; readonly withVersions?: boolean }) {
  const copyWs = useContext(CopyPageContext);
  return (
    <MenuTrigger>
      <IconButton size="sm" label={`More for ${page.name}`}><MoreHorizontal {...i16} /></IconButton>
      <Menu aria-label={`More for ${page.name}`} placement="bottom end" onAction={(k: Key) => { if (k === 'copyws') copyWs?.(page); else onAction(String(k) as 'edit'); }}>
        {withEdit && <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit</MenuItem>}
        {withVersions && <MenuItem id="versions" icon={<History {...i16} />} description="Restore an earlier one">Versions</MenuItem>}
        <MenuItem id="duplicate" icon={<CopyPlus {...i16} />}>Duplicate</MenuItem>
        {copyWs && <MenuItem id="copyws" icon={<Copy {...i16} />}>Copy to another workspace…</MenuItem>}
        <MenuSeparator />
        <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

/** Live or Off (the words every publishable thing uses): a switch that takes effect at once, its word swapping. */
export function OnSwitch({ page, onChange }: { readonly page: BookingPage; readonly onChange: (isOn: boolean) => void }) {
  return (
    <Switch isSelected={page.isOn} onChange={onChange} aria-label={`${page.name} takes bookings`}>
      <span className="tf-bkf__onword"><TextSwap swapKey={page.isOn ? 'on' : 'off'}>{page.isOn ? 'Live' : 'Off'}</TextSwap></span>
    </Switch>
  );
}

/** transitions.dev 08 page side-by-side: the page before waits 8px left, the one after 8px right, both faded; the box eases
 *  to the showing page's height when the step changes (01 card resize) and follows it directly otherwise. */
export function SlidePages({ step, pages }: { readonly step: number; readonly pages: ReadonlyArray<ReactNode> }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const shown = useRef(step);
  const [box, setBox] = useState<{ readonly height: number; readonly animate: boolean }>();
  useLayoutEffect(() => {
    const el = refs.current[step];
    if (!el) return undefined;
    setBox({ height: el.offsetHeight, animate: shown.current !== step });
    shown.current = step;
    const ro = new ResizeObserver(() => setBox({ height: el.offsetHeight, animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);
  return (
    <div className={cx('tf-bkf__slide', box?.animate && 'is-resizing')} style={{ height: box?.height }}>
      {pages.map((page, n) => (
        <section key={n} ref={(el) => { refs.current[n] = el; }} className="tf-bkf__slide-page" data-pos={n < step ? 'before' : n > step ? 'after' : 'current'} inert={n !== step} aria-hidden={n !== step}>
          {page}
        </section>
      ))}
    </div>
  );
}

/** A small grey heading over a group of controls. */
export function Eyebrow({ children }: { readonly children: ReactNode }) {
  return <p className="tf-bkf__eyebrow">{children}</p>;
}

/** One section of a tab: a title, a grey one-liner and its content. Sections stack 32px apart with a hairline between; never a card. */
export function Section({ title, description, action, children, className }: { readonly title: string; readonly description?: ReactNode; readonly action?: ReactNode; readonly children: ReactNode; readonly className?: string }) {
  return (
    <section className={cx('tf-bkf-section', className)} aria-label={title}>
      <header className="tf-bkf-section__head">
        <div className="tf-bkf-section__titles">
          <h2 className="tf-bkf-section__title">{title}</h2>
          {description !== undefined && <p className="tf-bkf-section__desc">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The row under the tabs, the same on every tab: the view or scope on the left, a quiet count, and the tab's one main action (ink) on the right. */
/** One setting as a row: its name and a line of help on the left, the control on the right. Rows divide with a hairline. */
export function SettingRow({ title, description, children }: { readonly title: string; readonly description?: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="tf-bkf-setting">
      <div className="tf-bkf-setting__text">
        <span className="tf-bkf-setting__title">{title}</span>
        {description !== undefined && <span className="tf-bkf-setting__desc">{description}</span>}
      </div>
      <div className="tf-bkf-setting__control">{children}</div>
    </div>
  );
}

export function TabToolbar({ start, count, action }: { readonly start?: ReactNode; readonly count?: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="tf-bkf__toolbar">
      {start}
      {count !== undefined && <span className="tf-bkf__toolbar-count tf-num">{count}</span>}
      <span className="tf-bkf__spacer" />
      {action}
    </div>
  );
}

/** The workspaces the demo can switch between: a team taking meetings, a salon, a restaurant. One app, one Bookings. */
export type WorkspaceId = 'northwind' | 'lumen' | 'olive';
const WORKSPACES: ReadonlyArray<{ readonly id: WorkspaceId; readonly name: string; readonly kind: string }> = [
  { id: 'northwind', name: 'Northwind', kind: 'Team meetings' }, { id: 'lumen', name: 'Lumen Hair Studio', kind: 'Hair salon' }, { id: 'olive', name: 'Olive Kitchen', kind: 'Restaurant' },
];
/** The switcher menu's workspace list, the current one ticked. Its keys are `ws:<id>`. */
export function WorkspaceItems({ current }: { readonly current: WorkspaceId }) {
  return (
    <MenuSection title="Workspaces">
      {WORKSPACES.map((w) => <MenuItem key={w.id} id={`ws:${w.id}`} icon={<Avatar name={w.name} shape="square" size={20} />} description={w.kind}>{w.id === current ? `${w.name} ✓` : w.name}</MenuItem>)}
    </MenuSection>
  );
}

/** Days off on a set of hours or a page's own hours: dates with no times, each removable, and a date picker to add one. */
export function DaysOffEditor({ value, onChange, label = 'Days off' }: { readonly value: ReadonlyArray<string>; readonly onChange: (days: ReadonlyArray<string>) => void; readonly label?: string }) {
  const [pick, setPick] = useState<CalendarDate | null>(null);
  const today = todayIn(getLocalTimeZone());
  const ahead = [...value].filter((d) => d >= today.toString()).sort();
  const add = () => { if (!pick) return; const d = pick.toString(); if (!value.includes(d)) onChange([...value, d].sort()); setPick(null); };
  return (
    <div className="tf-bkf-daysoff">
      <span className="tf-bkf__label">{label}</span>
      {ahead.length === 0 ? <span className="tf-bkf__muted">No days off yet</span> : (
        <ul className="tf-bkf-daysoff__list" aria-label={label}>
          {ahead.map((d) => {
            const [y, m, dd] = d.split('-').map(Number);
            const date = new Date(y ?? 2026, (m ?? 1) - 1, dd ?? 1);
            return (
              <li key={d} className="tf-bkf-daysoff__item">
                <span className="tf-num">{date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <IconButton size="sm" label={`Remove ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`} onPress={() => onChange(value.filter((x) => x !== d))}><XIcon {...i14} /></IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <div className="tf-bkf-daysoff__add">
        <DatePicker label="Add a day off" value={pick} minValue={today} onChange={setPick} />
        <Button size="sm" variant="secondary" isDisabled={!pick} onPress={add}>Add</Button>
      </div>
    </div>
  );
}
