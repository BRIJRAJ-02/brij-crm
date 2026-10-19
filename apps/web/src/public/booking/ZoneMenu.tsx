// The time zone row and its searchable list (spec 0025 experience, AC-668):
// the whole rail row is the button, reading "Dubai time (GMT+4)" with a
// chevron. It opens a search over every zone ("Search city or GMT offset"),
// the current zone first while the search is empty. Each row is the zone,
// its offset and a tick on the current one. Every typed word must match the
// zone's name or offset ("york", "+8", "asia sing"). Arrows move, Enter
// picks, Esc closes, and focus goes back to the row. A combobox with a
// listbox, by hand, since the public bundle carries no component library.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './booking.module.css';
import { strings } from './strings.ts';
import { offsetLabel, zoneDisplay } from './time.ts';

/** Every zone this browser knows, the current one first. */
function allZones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [current, ...listed.filter((zone) => zone !== current)];
}

/** The row and, while open, the search and the list. */
export function ZoneMenu({
  zone,
  now,
  onChange,
}: {
  readonly zone: string;
  readonly now: number;
  readonly onChange: (zone: string) => void;
}) {
  // When the list opened: its offsets are read at that moment, and only while it is open.
  const [openedAt, setOpenedAt] = useState<number | undefined>(undefined);
  const isOpen = openedAt !== undefined;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const row = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const zones = useMemo(
    () =>
      openedAt === undefined
        ? []
        : allZones(zone).map((each) => {
            const name = each.replaceAll('_', ' ');
            const offset = offsetLabel(each, openedAt);
            return { zone: each, name, offset, words: `${name} ${offset}`.replaceAll('/', ' ').toLowerCase() };
          }),
    [openedAt, zone],
  );
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
  const matches = terms.length === 0 ? zones : zones.filter((each) => terms.every((term) => each.words.includes(term)));
  useEffect(() => {
    if (isOpen) search.current?.focus({ preventScroll: true });
  }, [isOpen]);
  // The highlighted row stays in view by scrolling the list alone, never the page.
  useEffect(() => {
    const box = listRef.current;
    const item = box?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`);
    if (box === null || item === null || item === undefined) return;
    const itemBox = item.getBoundingClientRect();
    const listBox = box.getBoundingClientRect();
    if (itemBox.top < listBox.top) box.scrollTop -= listBox.top - itemBox.top;
    else if (itemBox.bottom > listBox.bottom) box.scrollTop += itemBox.bottom - listBox.bottom;
  }, [active, isOpen]);
  const close = (pick?: string) => {
    if (pick !== undefined) onChange(pick);
    setOpenedAt(undefined);
    setQuery('');
    row.current?.focus();
  };
  const display = zoneDisplay(zone, now);
  return (
    <div className={styles.zone}>
      <button
        ref={row}
        type="button"
        className={styles.zoneRow}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={strings.changeZone(display)}
        title={display}
        onClick={() => {
          if (isOpen) {
            setOpenedAt(undefined);
            return;
          }
          setActive(0);
          setOpenedAt(now);
        }}
      >
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span className={styles.zoneText}>{display}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" data-open={isOpen ? '' : undefined}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          className={styles.zoneMenu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpenedAt(undefined);
              setQuery('');
            }
          }}
        >
          <input
            ref={search}
            className={styles.input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={strings.zoneSearch}
            placeholder={strings.zoneSearch}
            autoComplete="off"
            spellCheck={false}
            {...(matches[active] === undefined ? {} : { 'aria-activedescendant': `${listId}-${String(active)}` })}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const pick = matches[active];
                if (pick !== undefined) close(pick.zone);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          />
          <ul ref={listRef} id={listId} role="listbox" aria-label={strings.timeZone} className={styles.zoneList}>
            {matches.length === 0 ? (
              <li className={styles.zoneEmpty}>{strings.zoneNone(query.trim())}</li>
            ) : (
              matches.map((each, index) => (
                // The keyboard drives the list from the search field (aria-activedescendant); a press picks too.
                <li
                  key={each.zone}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={each.zone === zone}
                  data-index={index}
                  data-active={index === active ? '' : undefined}
                  className={styles.zoneOption}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    close(each.zone);
                  }}
                >
                  <span className={styles.zoneName}>{each.name}</span>
                  <span className={styles.zoneOffset}>{each.offset}</span>
                  <span className={styles.zoneTick} aria-hidden="true">
                    {each.zone === zone && (
                      <svg className={styles.iconSmall} viewBox="0 0 24 24">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
