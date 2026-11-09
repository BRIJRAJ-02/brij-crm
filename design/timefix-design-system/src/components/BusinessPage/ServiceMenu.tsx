import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Tabs } from '../Tabs/Tabs.tsx';

/** One bookable service: its name, length, price as the business writes it, and an optional line about it. */
export interface Service {
  readonly id: string;
  readonly name: string;
  readonly minutes: number;
  /** "£45" or "from £60". */
  readonly price: string;
  readonly description?: string;
}
/** A section of the menu: Haircuts, Colour, Treatments. */
export interface ServiceCategory { readonly id: string; readonly name: string; readonly services: ReadonlyArray<Service> }

/** Props for ServiceMenu. */
export interface ServiceMenuProps {
  readonly categories: ReadonlyArray<ServiceCategory>;
  readonly onBook: (service: Service) => void;
  /** The heading above the tabs. */
  readonly title?: string;
}

const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)} hr ${m % 60} min`);

/** A business's service menu: category tabs that stick under the top and follow the scroll, then each service with its length, price and Book. */
export function ServiceMenu({ categories, onBook, title = 'Services' }: ServiceMenuProps) {
  const [current, setCurrent] = useState(categories[0]?.id ?? '');
  const bar = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const jumping = useRef(0);

  // Scroll spy: the current tab is the last section whose top has passed under the tabs. Reads on scroll of any
  // scroller (the page or a preview box), once a frame.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      if (Date.now() < jumping.current) return;
      const line = (bar.current?.getBoundingClientRect().bottom ?? 0) + 8;
      let now = categories[0]?.id ?? '';
      for (const c of categories) {
        const top = sections.current[c.id]?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) now = c.id;
      }
      setCurrent(now);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => { document.removeEventListener('scroll', onScroll, { capture: true }); if (frame) window.cancelAnimationFrame(frame); };
  }, [categories]);

  const go = (id: string) => {
    setCurrent(id);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    jumping.current = Date.now() + (still ? 50 : 700);
    sections.current[id]?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <section className="tf-svc" aria-label={title}>
      <h2 className="tf-biz__h2">{title}</h2>
      {categories.length > 1 && (
        <div ref={bar} className="tf-svc__tabs">
          <Tabs aria-label="Service categories" items={categories.map((c) => ({ id: c.id, label: c.name, count: c.services.length }))} selectedKey={current} onSelectionChange={go} />
        </div>
      )}
      {categories.map((c) => (
        <div key={c.id} ref={(el) => { sections.current[c.id] = el; }} className="tf-svc__section" aria-labelledby={`tf-svc-${c.id}`} role="group">
          <h3 id={`tf-svc-${c.id}`} className="tf-svc__name">{c.name}</h3>
          <ul className="tf-svc__list">
            {c.services.map((s) => (
              <li key={s.id} className="tf-svc__row">
                <div className="tf-svc__text">
                  <span className="tf-svc__title">{s.name}</span>
                  {s.description && <span className="tf-svc__desc">{s.description}</span>}
                  <span className="tf-svc__meta"><Clock size={14} strokeWidth={1.75} aria-hidden /><span className="tf-num">{lengthLabel(s.minutes)}</span></span>
                </div>
                <span className="tf-svc__price tf-num">{s.price}</span>
                <Button size="md" variant="secondary" onPress={() => onBook(s)} aria-label={`Book ${s.name}, ${lengthLabel(s.minutes)}, ${s.price}`}>Book</Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
