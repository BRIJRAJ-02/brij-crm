import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './BarStrip.module.css';

/** One bar: a period and its count. */
export interface BarStripBar {
  /** Unique within the strip (the week's start). */
  readonly id: string;
  /** What the bar says in its tooltip and to screen readers: "Week of 6 Oct: 3 meetings". */
  readonly label: string;
  /** The count, zero or more. */
  readonly value: number;
}

/** Props for BarStrip. */
export interface BarStripProps {
  /** What the strip shows, named for screen readers: "Sam Lee, meetings per week". */
  readonly label: string;
  /** The bars, oldest first. */
  readonly bars: readonly BarStripBar[];
  /**
   * The value a full height bar stands for. Give strips that sit together (one per table row) the same `max`
   * so their bars compare; it defaults to this strip's largest value.
   */
  readonly max?: number;
  /**
   * `row` (the default) fits a table row; `chart` fills its container's width at a chart's height, the bars
   * sharing the width, for a page's daily figures (the operator console, spec 0047).
   */
  readonly size?: 'row' | 'chart';
  /** Under a `chart`: the first and last period's names, at its two ends ("23 Sep", "Today"). */
  readonly axis?: { readonly start: string; readonly end: string };
}

/**
 * A small bar chart: one thin bar per period on one shared scale, in one data hue, each naming its period and
 * count in a tooltip on hover. Screen readers hear the same lines as a list. `row` fits a trend beside a name (a
 * rotation's last 12 weeks per member); `chart` a page's daily figures, its two ends named under it. It draws no
 * value axis: say the figures that matter in words beside it.
 */
export function BarStrip({ label, bars, max, size = 'row', axis }: BarStripProps) {
  const top = Math.max(max ?? 0, ...bars.map((bar) => bar.value), 0);
  return (
    <span className={styles.root} data-size={size}>
      <span className={styles.plot} data-size={size} aria-hidden="true">
        {bars.map((bar) => {
          const share = top === 0 ? 0 : Math.max(0, bar.value) / top;
          return (
            <Tooltip key={bar.id} content={bar.label} isTextTrigger>
              <span className={styles.slot}>
                <span
                  className={styles.bar}
                  data-empty={bar.value <= 0 || undefined}
                  style={{ '--bar': `${String(Math.round(share * 1000) / 10)}%` }}
                />
              </span>
            </Tooltip>
          );
        })}
      </span>
      {size === 'chart' && axis !== undefined && (
        <span className={styles.axis} aria-hidden="true">
          <span>{axis.start}</span>
          <span>{axis.end}</span>
        </span>
      )}
      <VisuallyHidden>
        <span>{label}</span>
        <ul>
          {bars.map((bar) => (
            <li key={bar.id}>{bar.label}</li>
          ))}
        </ul>
      </VisuallyHidden>
    </span>
  );
}
