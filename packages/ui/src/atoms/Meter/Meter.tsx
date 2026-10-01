import { useMeter } from 'react-aria';
import '../../lib/custom-properties.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { strings } from './strings.ts';
import styles from './Meter.module.css';

/** Props for Meter. */
export interface MeterProps {
  /** What is measured ("Records"). */
  readonly label: string;
  /** How much is used. It may pass the limit. */
  readonly value: number;
  /** The plan's limit. */
  readonly maxValue: number;
}

/** From this share of the limit, the meter warns. */
export const METER_WARNING_SHARE = 0.8;

/** Usage against a plan's limit: accent while there's room, orange near the limit, red past it. Built on React Aria's `useMeter`. */
export function Meter({ label, value, maxValue }: MeterProps) {
  const { locale } = useFormatSettings();
  const share = maxValue > 0 ? value / maxValue : 1;
  const tone = share > 1 ? 'over' : share >= METER_WARNING_SHARE ? 'warning' : 'ok';
  const number = new Intl.NumberFormat(locale);
  const valueText = strings.usage(number.format(value), number.format(maxValue));
  const shown = Math.min(value, maxValue);
  const { meterProps, labelProps } = useMeter({ label, value: shown, maxValue, valueLabel: valueText });
  const percentage = maxValue > 0 ? (shown / maxValue) * 100 : 100;
  return (
    // React Aria gives "meter progressbar"; every browser we support has meter, and axe reads the pair as neither.
    <div {...meterProps} role="meter" aria-valuenow={shown} className={styles.root}>
      <span className={styles.head}>
        <span {...labelProps} className={styles.label}>
          {label}
        </span>
        <span className={styles.value} data-tone={tone}>
          {valueText}
          {tone === 'over' && ` · ${strings.over}`}
        </span>
      </span>
      <span className={styles.track}>
        <span className={styles.fill} data-tone={tone} style={{ '--meter': `${String(percentage)}%` }} />
      </span>
    </div>
  );
}
