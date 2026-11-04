import { useMeter } from 'react-aria';
import '../../lib/custom-properties.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { strings } from './strings.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Meter.module.css';

/** Props for Meter. */
export interface MeterProps {
  /** What is measured ("Records"). */
  readonly label: string;
  /** How much is used. It may pass the limit. */
  readonly value: number;
  /** The plan's limit. */
  readonly maxValue: number;
  /**
   * `usage` (the default) is a plan's limit: accent, orange near it, red past it. `share` is a part of a whole in a
   * row of figures (people reaching a form's question, a source's views): one data colour at every share, since
   * nothing is wrong at 90%, and the head left to the row's own cells.
   */
  readonly tone?: 'usage' | 'share';
  /** What screen readers hear for the value, when the row says it otherwise ("4 of 6 people"). */
  readonly valueText?: string;
}

/** From this share of the limit, the meter warns. */
export const METER_WARNING_SHARE = 0.8;

/** Usage against a plan's limit: accent while there's room, orange near the limit, red past it. Built on React Aria's `useMeter`. */
export function Meter({ label, value, maxValue, tone: kind = 'usage', valueText: said }: MeterProps) {
  const { locale } = useFormatSettings();
  const share = maxValue > 0 ? value / maxValue : 1;
  const tone = kind === 'share' ? 'share' : share > 1 ? 'over' : share >= METER_WARNING_SHARE ? 'warning' : 'ok';
  const number = new Intl.NumberFormat(locale);
  const valueText = said ?? strings.usage(number.format(value), number.format(maxValue));
  const shown = Math.min(value, maxValue);
  const { meterProps, labelProps } = useMeter({ label, value: shown, maxValue, valueLabel: valueText });
  const percentage = maxValue > 0 ? (shown / maxValue) * 100 : 100;
  return (
    // React Aria gives "meter progressbar"; every browser we support has meter, and axe reads the pair as neither.
    <div {...meterProps} role="meter" aria-valuenow={shown} className={styles.root}>
      {tone === 'share' ? (
        // A share in a row of figures: the row's own cells show the label and the number, so they are read only.
        <VisuallyHidden>
          <span {...labelProps}>{label}</span> <span>{valueText}</span>
        </VisuallyHidden>
      ) : (
        <span className={styles.head}>
          <span {...labelProps} className={styles.label}>
            {label}
          </span>
          <span className={styles.value} data-tone={tone}>
            {valueText}
            {tone === 'over' && ` · ${strings.over}`}
          </span>
        </span>
      )}
      <span className={styles.track}>
        <span className={styles.fill} data-tone={tone} style={{ '--meter': `${String(percentage)}%` }} />
      </span>
    </div>
  );
}
