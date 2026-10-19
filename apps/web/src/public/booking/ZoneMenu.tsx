// The time zone row and its searchable list (spec 0025 experience, AC-668):
// the row reads "Dubai time (GMT+4)"; pressing it opens a search field over
// every zone ("Search city or GMT offset"). Arrows move, Enter picks, Esc
// closes, and focus goes back to the row. A combobox with a listbox, by hand,
// since the public bundle carries no component library.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './booking.module.css';
import { strings } from './strings.ts';
import { offsetLabel, zoneDisplay } from './time.ts';

/** Every zone this browser knows, the current one first when it isn't listed. */
function allZones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(current) ? listed : [current, ...listed];
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
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const row = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const zones = useMemo(
    () => allZones(zone).map((each) => ({ zone: each, label: zoneDisplay(each, now), offset: offsetLabel(each, now) })),
    [zone, now],
  );
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? zones
      : zones.filter(
          (each) =>
            each.zone.toLowerCase().replaceAll('_', ' ').includes(needle) ||
            each.offset.toLowerCase().includes(needle.replace(/\s/g, '')),
        );
  useEffect(() => {
    if (isOpen) search.current?.focus();
  }, [isOpen]);
  const close = (pick?: string) => {
    if (pick !== undefined) onChange(pick);
    setOpen(false);
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
        onClick={() => {
          setActive(
            Math.max(
              0,
              zones.findIndex((each) => each.zone === zone),
            ),
          );
          setOpen((open) => !open);
        }}
      >
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span>{display}</span>
      </button>
      {isOpen && (
        <div
          className={styles.zoneMenu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpen(false);
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
          <ul id={listId} role="listbox" aria-label={strings.timeZone} className={styles.zoneList}>
            {matches.length === 0 ? (
              <li className={styles.muted}>{strings.zoneNone}</li>
            ) : (
              matches.map((each, index) => (
                // The keyboard drives the list from the search field (aria-activedescendant); a press picks too.
                // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events
                <li
                  key={each.zone}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={each.zone === zone}
                  data-active={index === active ? '' : undefined}
                  className={styles.zoneOption}
                  ref={(element) => {
                    if (index === active) element?.scrollIntoView({ block: 'nearest' });
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => close(each.zone)}
                >
                  <span>{each.zone.replaceAll('_', ' ')}</span>
                  <span className={styles.muted}>{each.offset}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
