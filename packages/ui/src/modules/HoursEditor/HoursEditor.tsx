import { Button } from '../../atoms/Button/Button.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import styles from './HoursEditor.module.css';
import { strings } from './strings.ts';

/** One range of a day, local `HH:MM` times, the end after the start. */
export type HoursRange = readonly [start: string, end: string];

/** One row: a weekday, or a date that has its own hours. */
export interface HoursRow {
  readonly id: string;
  /** "Monday", or "Tue 24 Dec". */
  readonly label: string;
  /** Its ranges; none is a day off. */
  readonly ranges: readonly HoursRange[];
  /** What's wrong with the row, said under it. */
  readonly error?: string;
}

/** Props for HoursEditor. */
export interface HoursEditorProps {
  /** What the rows are ("Weekly hours", "Date overrides"), for screen readers. */
  readonly label: string;
  readonly rows: readonly HoursRow[];
  /** A row's new ranges: one added, changed or removed, or none for a day off. */
  readonly onChange: (rowId: string, ranges: readonly HoursRange[]) => void;
  /** Rows that can be taken away (date overrides) show a remove button. */
  readonly onRemoveRow?: (rowId: string) => void;
  /** The times a range may start or end on, every this many minutes. Default 15. */
  readonly stepMinutes?: number;
  readonly isDisabled?: boolean;
}

/** `HH:MM` for minutes from midnight; 1440 is 24:00, the end of the day. */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** The range a new one takes: after the row's last, an hour long, inside the day. */
function nextRange(ranges: readonly HoursRange[]): HoursRange {
  const last = ranges.at(-1);
  if (last === undefined) return ['09:00', '17:00'];
  const start = Math.min(minutesOf(last[1]) + 60, 1380);
  return [clock(start), clock(Math.min(start + 60, 1440))];
}

/**
 * Weekly hours or date overrides, as rows of time ranges (spec 0025, AC-624):
 * a switch turns the day on (09:00 to 17:00) or off, each range is a pair of
 * time Selects with a remove button, and Add a range adds the next hour. Rows
 * a caller may take away (a date override) carry a remove button. A row's
 * error shows under it. Disabled while the caller saves nothing.
 */
export function HoursEditor({
  label,
  rows,
  onChange,
  onRemoveRow,
  stepMinutes = 15,
  isDisabled = false,
}: HoursEditorProps) {
  const step = stepMinutes > 0 ? stepMinutes : 15;
  const starts: SelectItem[] = [];
  const ends: SelectItem[] = [];
  for (let minutes = 0; minutes <= 1440; minutes += step) {
    if (minutes < 1440) starts.push({ id: clock(minutes), label: clock(minutes) });
    if (minutes > 0) ends.push({ id: clock(minutes), label: clock(minutes) });
  }
  return (
    <ul className={styles.root} aria-label={label}>
      {rows.map((row) => {
        const isOn = row.ranges.length > 0;
        const replace = (index: number, range: HoursRange) =>
          onChange(
            row.id,
            row.ranges.map((each, at) => (at === index ? range : each)),
          );
        return (
          <li key={row.id} className={styles.row} data-off={isOn ? undefined : ''}>
            <div className={styles.day}>
              <Switch
                label={row.label}
                isSelected={isOn}
                isDisabled={isDisabled}
                onChange={(selected) => onChange(row.id, selected ? [nextRange([])] : [])}
              />
            </div>
            <div className={styles.ranges}>
              {isOn ? (
                row.ranges.map((range, index) => (
                  <div key={`${range[0]}-${String(index)}`} className={styles.range}>
                    <Select
                      label={strings.from(row.label)}
                      isLabelHidden
                      size="sm"
                      items={starts}
                      value={range[0]}
                      isDisabled={isDisabled}
                      onChange={(id) => {
                        if (id !== null) replace(index, [id, range[1]]);
                      }}
                    />
                    <span className={styles.to} aria-hidden="true">
                      {strings.to}
                    </span>
                    <Select
                      label={strings.until(row.label)}
                      isLabelHidden
                      size="sm"
                      items={ends}
                      value={range[1]}
                      isDisabled={isDisabled}
                      onChange={(id) => {
                        if (id !== null) replace(index, [range[0], id]);
                      }}
                    />
                    <Button
                      variant="ghost"
                      icon="x"
                      label={strings.removeRange(row.label, range[0], range[1])}
                      isDisabled={isDisabled}
                      onPress={() =>
                        onChange(
                          row.id,
                          row.ranges.filter((_, at) => at !== index),
                        )
                      }
                    />
                  </div>
                ))
              ) : (
                <span className={styles.offLabel}>{strings.unavailable}</span>
              )}
              {row.error !== undefined && (
                <p className={styles.error} role="alert">
                  {row.error}
                </p>
              )}
            </div>
            <div className={styles.actions}>
              {isOn && (
                <Button
                  variant="ghost"
                  icon="plus"
                  label={strings.addRange(row.label)}
                  isDisabled={isDisabled || row.ranges.length >= 6}
                  onPress={() => onChange(row.id, [...row.ranges, nextRange(row.ranges)])}
                />
              )}
              {onRemoveRow !== undefined && (
                <Button
                  variant="ghost"
                  icon="trash"
                  label={strings.removeRow(row.label)}
                  isDisabled={isDisabled}
                  onPress={() => onRemoveRow(row.id)}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
