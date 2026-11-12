import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, MapPin, Star, Users } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { BookingFlow, type BookingFlowProps } from '../BookingFlow/BookingFlow.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { TileGrid } from '../Card/Card.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { StatusDot } from '../Tag/Tag.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import { cx } from '../../lib/cx.ts';
import { ServiceMenu, type Service, type ServiceCategory } from './ServiceMenu.tsx';
import { PartyBand } from './PartyBand.tsx';
import './BusinessPage.css';

export { ServiceMenu, type Service, type ServiceCategory, type ServiceMenuProps } from './ServiceMenu.tsx';
export { PartyBand, type PartyBandProps } from './PartyBand.tsx';

/** The booking card's part a business supplies. */
export type BookingBase = Omit<BookingFlowProps, 'host' | 'title' | 'durationMinutes' | 'location'>;
/** What the guest has chosen so far: a service (and who with), or a party size. */
export interface BusinessChoice { readonly serviceId?: string; readonly staffId: string; readonly party: number }

/** Someone a guest can book with. */
export interface BusinessStaff { readonly id: string; readonly name: string; readonly role: string }

/** The venue's facts. Times are minutes from midnight in the place's own clock. */
export interface BusinessInfo {
  readonly name: string;
  /** "Hair salon", "Physiotherapy clinic", "Neighbourhood bistro". */
  readonly kind: string;
  readonly rating?: number;
  readonly reviews?: number;
  readonly address: string;
  readonly phone?: string;
  readonly coverSrc?: string;
  readonly opensAt: number;
  readonly closesAt: number;
  /** The place's clock now, from the provider's clock, so a cached page is never wrong about being open. */
  readonly now: number;
}

/** Props for BusinessPage. `services` asks for a service and a person; `table` asks for a party size. */
export interface BusinessPageProps {
  readonly business: BusinessInfo;
  readonly mode: 'services' | 'table';
  readonly categories?: ReadonlyArray<ServiceCategory>;
  readonly staff?: ReadonlyArray<BusinessStaff>;
  /** The largest party booked online. */
  readonly partyMax?: number;
  /** The booking card's calendar, times and booking; the page fills in who, what and where. Give a function to get times for the guest's choice so far. */
  readonly booking: BookingBase | ((choice: BusinessChoice) => BookingBase);
  /** A table's length in minutes. */
  readonly tableMinutes?: number;
  /** Who does a service, when not everyone does everything. */
  readonly staffFor?: (serviceId: string) => ReadonlyArray<BusinessStaff>;
}

/** 08 page side by side inside a box that eases to the showing step's height (01 card resize). */
function Steps({ step, pages }: { readonly step: number; readonly pages: ReadonlyArray<ReactNode> }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const mounted = useRef(false);
  const [box, setBox] = useState<{ readonly height: number; readonly animate: boolean }>();
  useLayoutEffect(() => {
    const el = refs.current[step];
    if (!el) return undefined;
    setBox({ height: el.offsetHeight, animate: mounted.current });
    mounted.current = true;
    const ro = new ResizeObserver(() => setBox({ height: el.offsetHeight, animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    refs.current[step]?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step]);
  return (
    <div className={cx('tf-biz__steps', !box?.animate && 'is-following')} style={{ height: box?.height }}>
      {pages.map((p, n) => (
        <section key={n} ref={(el) => { refs.current[n] = el; }} className="tf-biz__step" data-pos={n < step ? 'before' : n > step ? 'after' : 'current'} inert={n !== step}>{p}</section>
      ))}
    </div>
  );
}

/** A Fresha-style public business page: cover, name, rating, address and whether it is open, the service menu or a party size, a person to see, then the booking card. */
export function BusinessPage({ business, mode, categories = [], staff: allStaff = [], partyMax = 8, booking, tableMinutes = 90, staffFor }: BusinessPageProps) {
  const [step, setStep] = useState<'page' | 'staff' | 'book'>('page');
  const [service, setService] = useState<Service>();
  const [person, setPerson] = useState('any');
  const [party, setParty] = useState(2);
  const staff = service && staffFor ? staffFor(service.id) : allStaff;

  const open = business.now >= business.opensAt && business.now < business.closesAt;
  const status = open ? `Open now · Closes at ${formatClock(business.closesAt)}` : `Closed · Opens at ${formatClock(business.opensAt)}`;
  const chosen = staff.find((s) => s.id === person);
  const base = typeof booking === 'function' ? booking({ serviceId: service?.id, staffId: person, party }) : booking;
  const pickService = (s: Service) => { setService(s); setStep(allStaff.length > 0 ? 'staff' : 'book'); };
  const back = () => setStep(step === 'book' && mode === 'services' && allStaff.length > 0 ? 'staff' : 'page');
  const index = step === 'page' ? 0 : step === 'staff' ? 1 : 2;

  const head = (
    <header className="tf-biz__head">
      <span className="tf-biz__logo"><Avatar name={business.name} size={44} shape="square" /></span>
      <h1 className="tf-biz__name">{business.name}</h1>
      <p className="tf-biz__line">
        <span>{business.kind}</span>
        {business.rating !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tf-biz__rating"><Star size={14} strokeWidth={1.75} aria-hidden /><span className="tf-num">{business.rating.toFixed(1)}</span>
              {business.reviews !== undefined && <span className="tf-biz__muted tf-num">({business.reviews.toLocaleString('en-US')} reviews)</span>}</span>
          </>
        )}
      </p>
      <p className="tf-biz__line"><MapPin size={14} strokeWidth={1.75} aria-hidden /><span>{business.address}</span></p>
      <p className="tf-biz__line tf-biz__status"><StatusDot hue={open ? 'green' : 'gray'}>{status}</StatusDot></p>
    </header>
  );

  const page = (
    <div className="tf-biz__page">
      {head}
      {mode === 'services'
        ? <ServiceMenu categories={categories} onBook={pickService} />
        : (
          <section className="tf-biz__table" aria-label="Reserve a table">
            <h2 className="tf-biz__h2">Reserve a table</h2>
            <PartyBand value={party} onChange={setParty} max={partyMax} phone={business.phone} />
            <Button variant="primary" size="lg" isDisabled={party >= partyMax} onPress={() => setStep('book')} className="tf-biz__cta">Find a table</Button>
          </section>
        )}
    </div>
  );

  const staffStep = (
    <div className="tf-biz__pane">
      <div className="tf-biz__back">
        <IconButton label="Back to services" size="sm" onPress={back}><ArrowLeft size={16} strokeWidth={1.75} /></IconButton>
        <h2 className="tf-biz__h2" tabIndex={-1} data-autofocus>Who would you like to see?</h2>
      </div>
      {service && <p className="tf-biz__muted">{service.name} · {service.price}</p>}
      <TileGrid label="Person" isLabelHidden columns={2} value={person} onChange={setPerson} items={[
        { id: 'any', title: 'Anyone available', description: 'The most open times', icon: <Users size={16} strokeWidth={1.75} /> },
        ...staff.map((s) => ({ id: s.id, title: s.name, description: s.role, icon: <Avatar name={s.name} size={28} /> })),
      ]} />
      <Button variant="primary" size="lg" onPress={() => setStep('book')} className="tf-biz__cta">Continue</Button>
    </div>
  );

  const bookStep = (
    <div className="tf-biz__pane">
      <div className="tf-biz__back">
        <IconButton label={mode === 'table' ? 'Back to party size' : 'Back'} size="sm" onPress={back}><ArrowLeft size={16} strokeWidth={1.75} /></IconButton>
        <h2 className="tf-biz__h2" tabIndex={-1} data-autofocus>Pick a time</h2>
      </div>
      {step === 'book' && (
        <BookingFlow {...base} key={`${service?.id ?? ''}-${person}-${party}`}
          host={{ name: mode === 'table' ? business.name : chosen?.name ?? business.name }}
          title={mode === 'table' ? `Table for ${party}` : service?.name ?? ''}
          durationMinutes={mode === 'table' ? tableMinutes : service?.minutes ?? 30}
          location={{ kind: 'place', label: business.address }} />
      )}
    </div>
  );

  return (
    <div className={cx('tf-biz', !business.coverSrc && 'tf-biz--plain')}>
      {business.coverSrc && <div className="tf-biz__cover"><img src={business.coverSrc} alt="" className="tf-biz__cover-img" /></div>}
      <div className="tf-biz__body">
        <Steps step={index} pages={[page, staffStep, bookStep]} />
      </div>
      {/* The booking card carries its own foot. */}
      {step !== 'book' && <a className="tf-biz__foot" href="https://www.timefix.com" target="_blank" rel="noreferrer"><span>Powered by</span><Logo size={16} /></a>}
    </div>
  );
}
