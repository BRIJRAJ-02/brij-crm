import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import styles from './SectionTabs.module.css';

/** One section a SectionTabs row links to. */
export interface SectionTab {
  readonly id: string;
  readonly label: string;
  /** Where it goes: the section's own anchor (`#s-…`). */
  readonly href: string;
}

/** Props for SectionTabs. */
export interface SectionTabsProps {
  /** What the row moves between ("Sections"). Read by screen readers as the navigation's name. */
  readonly label: string;
  readonly sections: readonly SectionTab[];
  /** The section under the reader now; its pill is filled and the fill slides to it when it changes. */
  readonly current?: string | undefined;
  /** A tab was pressed: the caller scrolls (or lets the anchor jump). */
  readonly onSelect?: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A long page's sections as a row of pills that follow the reader (spec 0065, AC-6529; spec 0068, AC-6803 and
 * AC-6806's sliding tabs): links to each section's anchor, the current one marked by a fill that slides between pills
 * as the page scrolls (transitions.dev's tabs sliding), and the row scrolling sideways to keep it in view. The first
 * place is drawn without moving; reduced motion moves it at once. A navigation landmark of links, so each is a real
 * link a reader can open, copy or follow by keyboard.
 */
export function SectionTabs({ label, sections, current, onSelect }: SectionTabsProps) {
  const row = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const ids = sections.map((section) => section.id).join('|');
  useLayoutEffect(() => {
    const list = row.current;
    const marker = fill.current;
    if (list === null || marker === null) return undefined;
    const place = (isInstant: boolean) => {
      const chosen = list.querySelector<HTMLElement>('[aria-current="location"]');
      if (chosen === null) {
        marker.dataset.hidden = '';
        return;
      }
      delete marker.dataset.hidden;
      if (isInstant) marker.dataset.instant = '';
      marker.style.setProperty('--fill-x', `${String(chosen.offsetLeft)}px`);
      marker.style.setProperty('--fill-width', `${String(chosen.offsetWidth)}px`);
      if (isInstant) {
        // Lay out at the new place before motion returns, so the first place never slides in from the start.
        marker.getBoundingClientRect();
        delete marker.dataset.instant;
      }
      const reduce = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      list.scrollTo({
        left: chosen.offsetLeft - list.clientWidth / 2 + chosen.offsetWidth / 2,
        behavior: isInstant || reduce ? 'auto' : 'smooth',
      });
    };
    place(!placed.current);
    placed.current = true;
    // A face that loads late or a resized window changes the pills' widths: the fill follows at once.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => place(true));
    observer.observe(list);
    return () => observer.disconnect();
  }, [current, ids]);
  return (
    <nav aria-label={label} className={styles.root}>
      <div className={styles.row} ref={row}>
        <span className={styles.fill} ref={fill} aria-hidden="true" data-hidden="" />
        {sections.map((section) => (
          <a
            key={section.id}
            href={section.href}
            className={styles.tab}
            aria-current={section.id === current ? 'location' : undefined}
            onClick={(event) => onSelect?.(section.id, event)}
          >
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
