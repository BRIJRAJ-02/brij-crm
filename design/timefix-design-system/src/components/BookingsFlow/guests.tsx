// Guests (a restaurant) and Clients (a salon): everyone who has booked, gathered by email or phone, and the profile the staff keep.
// Visits always come from bookings; the staff only add what a booking can't know (tags, notes, birthday, diet, formulas, patch test).
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Cake, Copy, FlaskConical, Mail, MapPin, Phone, Plus, Scissors, UserRound, Users } from 'lucide-react';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button } from '../Button/Button.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TextArea } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { EmptyState, NoResults } from '../EmptyState/EmptyState.tsx';
import { ALLERGENS } from '../MenuPage/MenuPage.tsx';
import { formatClock, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { copyText } from '../../lib/copy.ts';
import { cx } from '../../lib/cx.ts';
import { useToast } from '../Toast/Toast.tsx';
import { TabToolbar, i14, i16 } from './parts.tsx';
import { HOST, first, guestKey, guestsOf, nextId, plural, type BookedMeeting, type BookingsAction, type BookingsState, type GuestProfile, type GuestSummary } from './state.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Tags the staff pick from, per kind of business. */
const TAGS = { restaurant: ['VIP', 'Regular', 'Wheelchair', 'High chair', 'Celebrates here'], salon: ['VIP', 'Regular', 'Sensitive scalp', 'Prefers quiet', 'Wheelchair'] } as const;
const hueOf = (t: string) => (t === 'VIP' ? 'purple' : t === 'Allergy' || t === 'Sensitive scalp' ? 'red' : 'gray');
/** "tree nuts and milk", "gluten, eggs and fish". */
const listOf = (xs: ReadonlyArray<string>) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] ?? ''}`);
const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const DAY = 86_400_000;
/** Six months: a patch test older than this is asked for again before colour. */
const PATCH_DAYS = 183;
/** A guest who hasn't been back in this many days shows under "Not back". */
const LAPSED_DAYS = 60;

/** "14 Mar" from "03-14". */
export const birthdayText = (b: string) => { const [m, d] = b.split('-').map(Number); return m && d ? `${d} ${MONTHS[m - 1] ?? ''}` : ''; };
/** Days until a "MM-DD" birthday comes round again (0 is today). */
function daysToBirthday(b: string, now: Date): number | undefined {
  const [m, d] = b.split('-').map(Number); if (!m || !d) return undefined;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d); if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / DAY);
}
/** "3 weeks ago", "Today", "In 4 days": how far a date is, the way the front desk says it. */
function far(d: Date, now: Date): string {
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
  if (days === 0) return 'Today'; if (days === 1) return 'Tomorrow'; if (days === -1) return 'Yesterday';
  const n = Math.abs(days); const word = n < 14 ? plural(n, 'day') : n < 60 ? plural(Math.round(n / 7), 'week') : n < 730 ? plural(Math.round(n / 30), 'month') : plural(Math.round(n / 365), 'year');
  return days > 0 ? `In ${word}` : `${word} ago`;
}
/** A colour service: one in the Colour category. Those need a patch test on file. */
const isColour = (state: BookingsState, m: BookedMeeting) => state.pages.find((p) => p.id === m.pageId)?.categoryId === 'c-colour';
/** One visit, one line: "Root colour with Jo" or "Table for 4 · Terrace". */
function visitLine(state: BookingsState, m: BookedMeeting): string {
  if (m.tables) return `${m.title}${m.placeLabel ? ` · ${m.placeLabel}` : ''}`;
  return `${state.pages.find((p) => p.id === m.pageId)?.name ?? m.title} with ${first(m.host)}`;
}

/** Props for GuestsTab. */
export interface GuestsTabProps {
  readonly state: BookingsState;
  readonly onOpen: (key: string) => void;
}

/** The guest book: search by name, email or phone, a few quick filters, then one row per guest with their visits, last and next. */
export function GuestsTab({ state, onOpen }: GuestsTabProps) {
  const restaurant = state.business?.kind === 'restaurant';
  const noun = restaurant ? 'guest' : 'client';
  const [now] = useState(() => new Date());
  const all = useMemo(() => guestsOf(state, now), [state, now]);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'soon' | 'regular' | 'lapsed'>('all');
  const q = query.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
  const filters: ReadonlyArray<{ readonly id: typeof show; readonly label: string; readonly test: (g: GuestSummary) => boolean }> = [
    { id: 'all', label: 'All', test: () => true },
    { id: 'soon', label: 'Coming up', test: (g) => g.next !== undefined },
    { id: 'regular', label: 'Regulars', test: (g) => g.visits.length >= 3 || (g.profile.tags ?? []).includes('Regular') },
    { id: 'lapsed', label: `Not back in ${LAPSED_DAYS} days`, test: (g) => !g.next && g.last !== undefined && now.getTime() - g.last.getTime() > LAPSED_DAYS * DAY },
  ];
  const test = filters.find((f) => f.id === show)?.test ?? (() => true);
  const shown = all.filter((g) => test(g) && (!q || g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q) || (qd.length >= 3 && (g.phone ?? '').replace(/\D/g, '').includes(qd))));
  if (all.length === 0) return <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title={`No ${noun}s yet`} description={`Everyone who books ${restaurant ? 'a table' : 'a service'} shows here, with their visits.`} />;
  return (
    <div className="tf-bkf-guests">
      <TabToolbar start={<SearchField label={`Search ${noun}s`} placeholder="Name, email or phone" size="sm" value={query} onChange={setQuery} />}
        count={shown.length === all.length ? plural(all.length, noun) : `${shown.length} of ${all.length}`} />
      <ChoiceChips label={`Show ${noun}s`} isLabelHidden selectionMode="single" size="sm" selectedKeys={[show]} onSelectionChange={(k) => { const v = [...k][0]; if (v) setShow(v as typeof show); }}
        items={filters.map((f) => ({ id: f.id, label: f.label }))} />
      {shown.length === 0 ? <NoResults query={query || filters.find((f) => f.id === show)?.label || ''} noun={`${noun}s`} onClearFilters={() => { setQuery(''); setShow('all'); }} /> : (
        <ul className="tf-bkf-guests__list" aria-label={restaurant ? 'Guests' : 'Clients'}>
          <li className="tf-bkf-guests__head" aria-hidden="true"><span>Name</span><span className="tf-num">Visits</span><span>Last visit</span><span>Next</span>{!restaurant && <span className="tf-num">Spent</span>}</li>
          {shown.map((g) => {
            const tags = [...new Set([...(g.profile.tags ?? []), ...(g.profile.diet?.length ? ['Allergy'] : [])])];
            return (
              <li key={g.key} className={cx('tf-bkf-guests__row', !restaurant && 'has-spend')}>
                <button type="button" className="tf-bkf-guests__who" onClick={() => onOpen(g.key)} aria-label={`Open ${g.name}`}>
                  <Avatar name={g.name} size={32} />
                  <span className="tf-bkf-guests__id">
                    <span className="tf-bkf-guests__name">{g.name}{tags.map((t) => <Tag key={t} size="sm" hue={hueOf(t)}>{t}</Tag>)}</span>
                    <span className="tf-bkf__muted tf-num">{g.phone ?? g.email}{g.usual ? ` · ${restaurant ? g.usual : `sees ${first(g.usual)}`}` : ''}</span>
                  </span>
                </button>
                <span className="tf-bkf-guests__n tf-num">{g.visits.length}{g.noShows ? <span className="tf-bkf-guests__ns" aria-label={plural(g.noShows, 'no-show')}>{` · ${g.noShows} missed`}</span> : null}</span>
                <span className="tf-bkf-guests__when tf-num">{g.last ? far(g.last, now) : <span className="tf-bkf__muted">First visit ahead</span>}</span>
                <span className="tf-bkf-guests__when tf-bkf-guests__next tf-num">{g.next ? formatDay(g.next) : <span className="tf-bkf__muted">—</span>}</span>
                {!restaurant && <span className="tf-bkf-guests__spend tf-num">{g.spend ? money(g.spend) : '—'}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Props for GuestDrawer. */
export interface GuestDrawerProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  /** Open on this guest; undefined closes it. */
  readonly guestKey: string | undefined;
  readonly onClose: () => void;
  /** Opens one of their bookings. */
  readonly onBooking?: (m: BookedMeeting) => void;
  readonly isReadOnly?: boolean;
}

/** One guest or client: how often they come, what the staff should know, and every visit. Saves as you go (notes save when you leave the field). */
export function GuestDrawer({ state, dispatch, guestKey: key, onClose, onBooking, isReadOnly = false }: GuestDrawerProps) {
  const { toast } = useToast();
  const restaurant = state.business?.kind === 'restaurant';
  const [now] = useState(() => new Date());
  const [lastKey, setLastKey] = useState(key);
  if (key && key !== lastKey) setLastKey(key);
  const k = key ?? lastKey;
  const g = useMemo(() => (k ? guestsOf(state, now).find((x) => x.key === k) : undefined), [state, k, now]);
  const [notes, setNotes] = useState(g?.profile.notes ?? '');
  const [formula, setFormula] = useState<string>();
  const [patching, setPatching] = useState<'clear' | 'reaction'>();
  const [allVisits, setAllVisits] = useState(false);
  useEffect(() => { setNotes(g?.profile.notes ?? ''); setFormula(undefined); setPatching(undefined); setAllVisits(false); }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !k) return null;
  const p: GuestProfile = g.profile;
  const patch = (x: Partial<GuestProfile>) => { if (!isReadOnly) dispatch({ type: 'guest/patch', key: k, patch: x }); };
  const saveNotes = () => { if (notes.trim() !== (p.notes ?? '')) patch({ notes: notes.trim() || undefined }); };
  const copy = (label: string, text: string) => { void copyText(text).then((ok) => toast(ok ? { message: `${label} copied`, tone: 'success' } : { message: `Copy didn’t work. Select it and copy: ${text}`, tone: 'danger' })); };
  const [bm, bd] = (p.birthday ?? '').split('-');
  const setBirthday = (m?: string, d?: string) => patch({ birthday: m && d ? `${m}-${d}` : undefined });
  const toBirthday = p.birthday ? daysToBirthday(p.birthday, now) : undefined;
  // Colour coming up with no patch test on file, or one older than six months: ask for it before the day.
  const colourNext = restaurant ? undefined : g.upcoming.find((m) => isColour(state, m));
  const patchOld = !p.patch || now.getTime() - p.patch.date.getTime() > PATCH_DAYS * DAY;
  // Every visit and every no-show, newest first; five until Show all.
  const history = [...g.visits, ...state.meetings.filter((m) => m.status === 'no-show' && guestKey(m) === k)].sort((a, b) => b.start.getTime() - a.start.getTime());
  const stats: ReadonlyArray<readonly [string, string]> = [
    ['Visits', String(g.visits.length)],
    ...(restaurant ? [['Usual party', g.visits.length ? String(Math.round(g.visits.reduce((n, m) => n + (m.party ?? 2), 0) / g.visits.length)) : '—'] as const] : [['Spent', g.spend ? money(g.spend) : '—'] as const]),
    ['No-shows', String(g.noShows)],
    ['Last visit', g.last ? `${g.last.getDate()} ${MONTHS[g.last.getMonth()]}` : '—'],
  ];
  const tagItems = TAGS[restaurant ? 'restaurant' : 'salon'];
  return (
    <Drawer isOpen={key !== undefined} onOpenChange={(o) => { if (!o) { saveNotes(); onClose(); } }} title={g.name} leading={<Avatar name={g.name} size={36} />}
      subtitle={g.first ? `${restaurant ? 'Guest' : 'Client'} since ${MONTHS[g.first.getMonth()]} ${g.first.getFullYear()}` : `New ${restaurant ? 'guest' : 'client'}`}>
      <dl className="tf-bkf-guest__stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tf-num">{value}</dd></div>)}</dl>
      {colourNext && patchOld && (
        <Callout tone="warning">{p.patch ? `Their patch test was ${far(p.patch.date, now).toLowerCase()}.` : 'No patch test on file.'} {state.pages.find((x) => x.id === colourNext.pageId)?.name} is on {formatLongDay(colourNext.start)}: do one at least 48 hours before.</Callout>
      )}
      {toBirthday !== undefined && toBirthday <= 14 && <Callout tone="info">{toBirthday === 0 ? 'Their birthday is today.' : `Their birthday is ${toBirthday === 1 ? 'tomorrow' : `in ${toBirthday} days`}, on ${birthdayText(p.birthday ?? '')}.`}</Callout>}
      <dl className="tf-bkf__facts">
        {g.phone && <><dt><Phone {...i16} aria-label="Phone" /></dt><dd className="tf-bkf-guest__fact"><span className="tf-num">{g.phone}</span><Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => copy('Phone number', g.phone ?? '')}>Copy</Button></dd></>}
        {g.email && <><dt><Mail {...i16} aria-label="Email" /></dt><dd className="tf-bkf-guest__fact"><span>{g.email}</span><Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => copy('Email', g.email)}>Copy</Button></dd></>}
        {g.usual && <><dt>{restaurant ? <MapPin {...i16} aria-label="Usual area" /> : <Scissors {...i16} aria-label="Usual stylist" />}</dt><dd>{restaurant ? `Usually sits in the ${g.usual}` : `Usually sees ${g.usual}`}</dd></>}
        {p.birthday && <><dt><Cake {...i16} aria-label="Birthday" /></dt><dd>{birthdayText(p.birthday)}</dd></>}
        {(p.diet ?? []).length > 0 && <><dt><AlertTriangle {...i16} aria-label="Allergies" className="tf-bkf-guest__warn" /></dt><dd className="tf-bkf-guest__warn">Can’t eat {listOf((p.diet ?? []).map((x) => x.toLowerCase()))}</dd></>}
      </dl>
      <section className="tf-bkf__block" aria-label="What the staff should know">
        <ChoiceChips label="Tags" selectionMode="multiple" size="sm" isDisabled={isReadOnly} selectedKeys={[...(p.tags ?? [])]} onSelectionChange={(s) => patch({ tags: s.size ? [...s] : undefined })}
          items={[...new Set([...tagItems, ...(p.tags ?? [])])].map((t) => ({ id: t, label: t }))} />
        <TextArea label="Notes" rows={3} value={notes} onChange={setNotes} onBlur={saveNotes} isReadOnly={isReadOnly} placeholder={restaurant ? 'Favourite table, what they order, who they come with' : 'How they like it, what to avoid, what they said last time'} />
        <ShowMore showLabel={restaurant ? 'Birthday and allergies' : 'Birthday'} hideLabel={restaurant ? 'Hide birthday and allergies' : 'Hide birthday'}>
          <div className="tf-bkf__pair">
            <Select label="Birthday month" value={bm ?? null} isDisabled={isReadOnly} placeholder="Month" onChange={(v) => setBirthday(v ?? undefined, bd ?? '01')}
              items={MONTHS.map((m, n) => ({ id: String(n + 1).padStart(2, '0'), label: m }))} />
            <Select label="Day" value={bd ?? null} isDisabled={isReadOnly || !bm} placeholder="Day" onChange={(v) => setBirthday(bm, v ?? undefined)}
              items={Array.from({ length: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(bm ?? 1) - 1] ?? 31 }, (_, n) => ({ id: String(n + 1).padStart(2, '0'), label: String(n + 1) }))} />
          </div>
          {p.birthday && !isReadOnly && <Button size="sm" variant="ghost" onPress={() => patch({ birthday: undefined })}>Remove birthday</Button>}
          {restaurant && (
            <ChoiceChips label="Can’t eat" selectionMode="multiple" size="sm" isDisabled={isReadOnly} selectedKeys={[...(p.diet ?? [])]} onSelectionChange={(s) => patch({ diet: s.size ? [...s] : undefined })}
              items={ALLERGENS.map((a) => ({ id: a, label: a }))} />
          )}
        </ShowMore>
      </section>
      {!restaurant && (
        <section className="tf-bkf__block" aria-label="Colour">
          <h3 className="tf-bkf__block-title">Colour</h3>
          <div className="tf-bkf-guest__patch">
            <FlaskConical {...i16} aria-hidden />
            <span>{p.patch ? <>Patch test <Tag size="sm" hue={p.patch.result === 'clear' ? 'green' : 'red'}>{p.patch.result === 'clear' ? 'Clear' : 'Reaction'}</Tag> <span className="tf-bkf__muted tf-num">{formatDay(p.patch.date)}</span></> : <span className="tf-bkf__muted">No patch test on file</span>}</span>
            {!isReadOnly && patching === undefined && <Button size="sm" variant="ghost" onPress={() => setPatching('clear')}>Record a test</Button>}
          </div>
          {patching !== undefined && (
            <div className="tf-bkf-guest__add">
              <RadioGroup label="Result today" value={patching} onChange={(v) => setPatching(v === 'reaction' ? 'reaction' : 'clear')} orientation="horizontal">
                <Radio value="clear">Clear</Radio><Radio value="reaction">Reaction</Radio>
              </RadioGroup>
              <span className="tf-bkf__row"><Button size="sm" variant="primary" onPress={() => { patch({ patch: { date: new Date(), result: patching } }); setPatching(undefined); toast({ message: `Patch test saved: ${patching === 'clear' ? 'clear' : 'reaction'}`, tone: patching === 'clear' ? 'success' : 'danger' }); }}>Save test</Button>
                <Button size="sm" variant="ghost" onPress={() => setPatching(undefined)}>Cancel</Button></span>
            </div>
          )}
          {(p.formulas ?? []).length > 0 && (
            <ul className="tf-bkf-guest__formulas" aria-label="Colour formulas">
              {(p.formulas ?? []).map((f) => <li key={f.id}><span className="tf-bkf-guest__formula">{f.text}</span><span className="tf-bkf__muted tf-num">{formatDay(f.date)} · {first(f.by)}</span></li>)}
            </ul>
          )}
          {formula === undefined
            ? (!isReadOnly && <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setFormula('')}>Add formula</Button>)
            : (
              <div className="tf-bkf-guest__add">
                <TextArea label="Formula" rows={2} autoFocus value={formula} onChange={setFormula} placeholder="Brand, shades and amounts, developer, time" />
                <span className="tf-bkf__row"><Button size="sm" variant="primary" isDisabled={!formula.trim()} onPress={() => { patch({ formulas: [{ id: nextId('f'), date: new Date(), text: formula.trim(), by: HOST }, ...(p.formulas ?? [])] }); setFormula(undefined); }}>Save formula</Button>
                  <Button size="sm" variant="ghost" onPress={() => setFormula(undefined)}>Cancel</Button></span>
              </div>
            )}
        </section>
      )}
      <section className="tf-bkf__block" aria-label="Coming up">
        <h3 className="tf-bkf__block-title">Coming up</h3>
        {g.upcoming.length === 0 ? <p className="tf-bkf__muted">Nothing booked.</p> : (
          <ul className="tf-bkf-guest__visits">{g.upcoming.map((m) => <VisitRow key={m.id} state={state} m={m} onOpen={onBooking} />)}</ul>
        )}
      </section>
      <section className="tf-bkf__block" aria-label="Visits">
        <h3 className="tf-bkf__block-title">Visits <span className="tf-bkf__muted tf-num">{history.length}</span></h3>
        {history.length === 0 ? <p className="tf-bkf__muted">Their first visit is coming up.</p> : (
          <ul className="tf-bkf-guest__visits">{(allVisits ? history : history.slice(0, 5)).map((m) => <VisitRow key={m.id} state={state} m={m} onOpen={onBooking} />)}</ul>
        )}
        {history.length > 5 && <Button size="sm" variant="ghost" onPress={() => setAllVisits(!allVisits)}>{allVisits ? 'Show fewer' : `Show all ${history.length}`}</Button>}
      </section>
    </Drawer>
  );
}

function VisitRow({ state, m, onOpen }: { readonly state: BookingsState; readonly m: BookedMeeting; readonly onOpen?: (m: BookedMeeting) => void }) {
  const body = <>
    <span className="tf-bkf-guest__date tf-num"><CalendarDays {...i14} aria-hidden />{formatDay(m.start)}, {formatClock(minutesOf(m.start))}</span>
    <span className="tf-bkf-guest__what">{visitLine(state, m)}{m.status === 'no-show' && <Tag size="sm" hue="red">No-show</Tag>}{m.notes ? <span className="tf-bkf__muted">“{m.notes}”</span> : null}</span>
  </>;
  return <li>{onOpen ? <button type="button" className="tf-bkf-guest__visit" onClick={() => onOpen(m)} aria-label={`Open ${visitLine(state, m)}, ${formatLongDay(m.start)}`}>{body}</button> : <span className="tf-bkf-guest__visit">{body}</span>}</li>;
}

/** A small "Guest" or "Client" profile button for a booking's drawer. */
export function ProfileButton({ restaurant, onPress }: { readonly restaurant: boolean; readonly onPress: () => void }) {
  return <Button size="sm" variant="ghost" icon={<UserRound {...i14} />} onPress={onPress}>{restaurant ? 'Guest profile' : 'Client record'}</Button>;
}
