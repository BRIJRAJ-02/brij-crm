import { useEffect, useReducer, useRef, useState } from 'react';
import { Button as AriaButton, I18nProvider, type Key } from 'react-aria-components';
import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { ArrowLeft, CalendarDays, Eye, FlaskConical, Home, Inbox, LayoutGrid, LogOut, Monitor, Play, RotateCcw, Scissors, Settings, Smartphone, Store, User, Users, UtensilsCrossed } from 'lucide-react';
import { AppShell, TabBar, TopBar } from '../AppShell/AppShell.tsx';
import { Sidebar, WorkspaceSwitcher, NavItem, NavSection, PersonRow } from '../Sidebar/Sidebar.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { Button } from '../Button/Button.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { BusinessPage, type BookingBase, type BusinessChoice } from '../BusinessPage/BusinessPage.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';
import { i14, i16 } from '../BookingsFlow/parts.tsx';
import { CalendarTab, AppointmentDrawer, ServicesTab, TeamTab } from './salon.tsx';
import { ReservationsTab, TablesTab } from './restaurant.tsx';
import { BusinessTab } from './page.tsx';
import { lumen, olive } from './seed.ts';
import {
  at, bizReducer, dayKey, doers, first, fitTables, minutesOf, nextId, pageProblems, pickAny, priceText, sameDay, serviceById, serviceSlots, staffById, tableSlots, variantOf,
  type Appointment, type BizState, type Reservation,
} from './state.ts';
import '../BookingsFlow/BookingsFlow.css';
import './BusinessFlow.css';

export { bizReducer, lumen, olive };
export type { BizState };

/** Props for BusinessFlow. */
export interface BusinessFlowProps {
  /** Where the flow starts: the salon by default. */
  readonly initialState?: BizState;
  /** Shows the Demo menu: switch business, and see the page as a guest. */
  readonly showDemoMenu?: boolean;
}

const SECTIONS = {
  salon: [
    { id: 'calendar', label: 'Calendar', short: 'Calendar', icon: <CalendarDays {...i16} /> },
    { id: 'services', label: 'Services', short: 'Services', icon: <Scissors {...i16} /> },
    { id: 'team', label: 'Team', short: 'Team', icon: <Users {...i16} /> },
    { id: 'page', label: 'Business page', short: 'Page', icon: <Store {...i16} /> },
  ],
  restaurant: [
    { id: 'reservations', label: 'Reservations', short: 'Bookings', icon: <CalendarDays {...i16} /> },
    { id: 'tables', label: 'Tables', short: 'Tables', icon: <LayoutGrid {...i16} /> },
    { id: 'page', label: 'Business page', short: 'Page', icon: <Store {...i16} /> },
  ],
} as const;

/** Business booking as one live flow: a salon books services with a person, a restaurant books tables. The guest's side is the business page. */
export function BusinessFlow({ initialState, showDemoMenu = false }: BusinessFlowProps) {
  const [state, dispatch] = useReducer(bizReducer, initialState ?? lumen());
  const { toast } = useToast();
  const kind = state.business.kind;
  const sections = SECTIONS[kind];
  const [tab, setTab] = useState<string>(sections[0].id);
  const [apptId, setApptId] = useState<string>();
  const [guest, setGuest] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const made = useRef<{ readonly appointments: Appointment[]; readonly reservations: Reservation[] }>({ appointments: [], reservations: [] });
  useEffect(() => { if (!sections.some((x) => x.id === tab)) setTab(sections[0].id); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = sections.find((x) => x.id === tab) ?? sections[0];
  const now = new Date();
  const todayCount = kind === 'salon' ? state.appointments.filter((a) => a.status === 'booked' && sameDay(a.start, now)).length : state.reservations.filter((r) => (r.status === 'booked' || r.status === 'confirmed') && sameDay(r.start, now)).length;
  const problems = pageProblems(state).length;

  const demo = (k: Key) => {
    if (k === 'guest') { made.current = { appointments: [], reservations: [] }; setGuest(true); return; }
    if (k === 'salon' || k === 'restaurant') { dispatch({ type: 'reset', state: k === 'salon' ? lumen() : olive() }); setApptId(undefined); toast({ message: k === 'salon' ? 'Now: Lumen Hair Studio' : 'Now: Olive Kitchen' }); return; }
    if (k === 'reload') { dispatch({ type: 'reset', state: kind === 'salon' ? lumen() : olive() }); toast({ message: 'Reloaded' }); }
  };
  /** Back from the guest view: what the guest booked lands in the book, with a toast that opens it. */
  const closeGuest = () => {
    setGuest(false);
    const { appointments, reservations } = made.current;
    made.current = { appointments: [], reservations: [] };
    if (appointments.length) {
      dispatch({ type: 'patch', patch: { appointments: [...state.appointments, ...appointments] } });
      const a = appointments[appointments.length - 1];
      if (a) { setTab('calendar'); toast({ message: `${a.client.name} booked ${serviceById(state, a.serviceId)?.name ?? ''} with ${first(staffById(state, a.staffId)?.name ?? '')}, ${formatDay(a.start)} at ${formatClock(minutesOf(a.start))}`, action: { label: 'Open', onAction: () => setApptId(a.id) } }); }
    }
    if (reservations.length) {
      dispatch({ type: 'patch', patch: { reservations: [...state.reservations, ...reservations] } });
      const r = reservations[reservations.length - 1];
      if (r) { setTab('reservations'); toast({ message: `${r.guest.name} booked a table for ${r.party}, ${formatDay(r.start)} at ${formatClock(minutesOf(r.start))}`, tone: 'success' }); }
    }
  };

  const sidebar = (
    <Sidebar isCollapsed={collapsed} onCollapsedChange={setCollapsed}
      header={<WorkspaceSwitcher name={state.business.name} plan={state.business.kindLabel} mark={<LogoMark size={28} />}>
        <MenuItem id="settings" icon={<Settings {...i16} />}>Workspace settings</MenuItem>
      </WorkspaceSwitcher>}
      footer={<PersonRow name="Priya Raman" email="priya@northwind.com">
        <MenuItem id="profile" icon={<User {...i16} />}>Profile</MenuItem>
        <MenuSeparator />
        <MenuItem id="signout" icon={<LogOut {...i16} />}>Sign out</MenuItem>
      </PersonRow>}>
      <NavItem label="Home" icon={<Home {...i16} />} onPress={() => undefined} />
      <NavItem label="Inbox" icon={<Inbox {...i16} />} onPress={() => undefined} />
      <NavSection title="Business">
        {sections.map((x) => <NavItem key={x.id} label={x.label} icon={x.icon} isCurrent={tab === x.id} badge={x.id === 'page' && problems ? problems : undefined} count={x.id === sections[0].id && todayCount ? todayCount : undefined} onPress={() => setTab(x.id)} />)}
      </NavSection>
    </Sidebar>
  );

  const demoMenu = showDemoMenu && (
    <MenuTrigger>
      <Button size="sm" variant="ghost" icon={<FlaskConical {...i14} />}>Demo</Button>
      <Menu aria-label="Demo" placement="bottom end" onAction={demo}>
        <MenuSection title="As a guest">
          <MenuItem id="guest" icon={<Play {...i16} />} description={kind === 'salon' ? 'Pick a service, a person, a time' : 'Pick a party size and a time'}>Your business page</MenuItem>
        </MenuSection>
        <MenuSection title="Business">
          <MenuItem id="salon" icon={<Scissors {...i16} />} description="Services with staff">Lumen Hair Studio</MenuItem>
          <MenuItem id="restaurant" icon={<UtensilsCrossed {...i16} />} description="Tables and reservations">Olive Kitchen</MenuItem>
          <MenuItem id="reload" icon={<RotateCcw {...i16} />}>Reload this one</MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );

  return (
    <I18nProvider locale="en-GB">
      {guest ? <GuestView state={state} made={made.current} onClose={closeGuest} /> : (
        <AppShell sidebar={sidebar} className="tf-bkf tf-bzf"
          mobileNav={<TabBar aria-label="Business" current={tab} items={sections.map((x) => ({ id: x.id, label: x.short, icon: x.icon, badge: x.id === 'page' && problems ? problems : undefined }))} onChange={setTab} />}>
          <TopBar title={<Breadcrumbs size="title" items={[{ id: current.id, label: current.label, icon: current.icon }]} />} actions={<>{demoMenu}</>} />
          <div className="tf-bkf__body">
            <div className="tf-bkf__panel">
              {tab === 'calendar' && <CalendarTab state={state} dispatch={dispatch} onOpen={setApptId} />}
              {tab === 'services' && <ServicesTab state={state} dispatch={dispatch} />}
              {tab === 'team' && <TeamTab state={state} dispatch={dispatch} />}
              {tab === 'reservations' && <ReservationsTab state={state} dispatch={dispatch} />}
              {tab === 'tables' && <TablesTab state={state} dispatch={dispatch} />}
              {tab === 'page' && <BusinessTab state={state} dispatch={dispatch} onGuest={() => demo('guest')} onGo={setTab} />}
            </div>
          </div>
          <AppointmentDrawer state={state} dispatch={dispatch} id={apptId} onClose={() => setApptId(undefined)} />
        </AppShell>
      )}
    </I18nProvider>
  );
}

const asDate = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day);

/** The guest's view: the public business page, its times worked out from the real book. What they book waits until they come back. */
function GuestView({ state, made, onClose }: { readonly state: BizState; readonly made: { readonly appointments: Appointment[]; readonly reservations: Reservation[] }; readonly onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, []);
  const b = state.business;
  const now = new Date();
  // The book as the guest sees it, including anything they booked in this visit.
  const live = (): BizState => ({ ...state, appointments: [...state.appointments, ...made.appointments], reservations: [...state.reservations, ...made.reservations] });
  const salon = b.kind === 'salon';
  const online = state.services.filter((x) => x.online && !x.archived && doers(state, x).length > 0);
  const categories = state.categories.map((c) => ({ id: c.id, name: c.name, services: online.filter((x) => x.categoryId === c.id).flatMap((x) => x.variants.map((v) => ({
    id: `${x.id}|${v.id}`, name: x.variants.length > 1 ? `${x.name} · ${v.name}` : x.name, minutes: v.minutes, price: priceText(v), description: x.description || undefined,
  }))) })).filter((c) => c.services.length > 0);
  const hoursToday = b.hours[dayKey(now)];
  const booking = (choice: BusinessChoice): BookingBase => {
    const [sid = '', vid = ''] = (choice.serviceId ?? '').split('|');
    const svc = serviceById(state, sid);
    const variant = variantOf(svc, vid);
    const slots = (d: CalendarDate) => (salon ? (svc && variant ? serviceSlots(live(), svc, variant, choice.staffId, asDate(d), now) : []) : tableSlots(live(), choice.party, asDate(d), now));
    return {
      today: todayIn(getLocalTimeZone()), isDayOpen: (d) => slots(d).length > 0, slotsFor: slots,
      timeZones: [{ id: 'Asia/Kolkata', label: 'India Standard Time' }], defaultTimeZone: 'Asia/Kolkata',
      onBook: (r) => new Promise<void>((resolve, reject) => {
        window.setTimeout(() => {
          const day = asDate(r.date);
          const st = live();
          if (salon && svc && variant) {
            const who = choice.staffId === 'any' ? pickAny(st, svc, day, r.minutes, r.minutes + variant.minutes)?.id : choice.staffId;
            if (!who) { reject(new Error('taken')); return; }
            made.appointments.push({ id: nextId('a'), serviceId: svc.id, variantId: variant.id, staffId: who, start: at(day, r.minutes), end: at(day, r.minutes + variant.minutes), client: { name: r.name, phone: '', email: r.email }, status: 'booked', source: 'online', note: r.notes || undefined });
          } else {
            const tables = fitTables(st, choice.party, day, r.minutes, true);
            if (!tables) { reject(new Error('taken')); return; }
            made.reservations.push({ id: nextId('r'), start: at(day, r.minutes), party: choice.party, tables: tables.map((t) => t.id), guest: { name: r.name, phone: '', email: r.email }, note: r.notes, status: 'booked', source: 'online' });
          }
          resolve();
        }, 700);
      }),
    };
  };
  const staffFor = (serviceId: string) => { const svc = serviceById(state, serviceId.split('|')[0] ?? ''); return (svc ? doers(state, svc) : []).map((p) => ({ id: p.id, name: p.name, role: p.title })); };
  return (
    <div className="tf-bkf-guestmode">
      <header className="tf-bkf-guestmode__bar" aria-label="Guest mode">
        <span className="tf-bkf-guestmode__label"><Eye {...i14} aria-hidden="true" />Viewing as a guest</span>
        <SegmentedControl aria-label="Device" size="sm" selectedKey={device} onSelectionChange={(k) => setDevice(k === 'phone' ? 'phone' : 'desktop')}
          items={[{ id: 'desktop', label: 'Desktop', icon: <Monitor {...i14} /> }, { id: 'phone', label: 'Phone', icon: <Smartphone {...i14} /> }]} />
        <span className="tf-bkf-guestmode__url">timefix.com/{b.handle}</span>
        <span className="tf-bkf__spacer" />
        <AriaButton ref={back} className="tf-bkf-guestmode__back" onPress={onClose}><ArrowLeft {...i14} aria-hidden="true" />Back to {b.name}</AriaButton>
      </header>
      <main className="tf-bkf-guestmode__page" data-device={device}>
        <div className="tf-bkf-guestmode__frame" data-device={device}>
          {!b.published || pageProblems(state).length > 0 ? (
            <div className="tf-bzf-closed"><Store size={20} strokeWidth={1.75} aria-hidden="true" /><strong>{b.name} isn’t taking bookings online right now</strong><span>Call {b.phone} to book.</span></div>
          ) : (
            <BusinessPage mode={salon ? 'services' : 'table'} categories={categories} staff={state.staff.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, role: p.title }))} staffFor={staffFor}
              partyMax={state.online.partyMax} tableMinutes={state.online.turn} booking={booking}
              business={{ name: b.name, kind: b.kindLabel, address: b.address, phone: b.phone, opensAt: hoursToday.ranges[0]?.start ?? 0, closesAt: hoursToday.ranges[hoursToday.ranges.length - 1]?.end ?? 0, now: minutesOf(now), rating: 4.8, reviews: salon ? 312 : 1204 }} />
          )}
        </div>
      </main>
    </div>
  );
}

