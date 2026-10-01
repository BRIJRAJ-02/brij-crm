import { useFormatSettings } from '../../provider/context.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Badge.module.css';
import { strings } from './strings.ts';

/** `neutral` (the default) for counts beside a label, `accent` for counts that ask for attention (unread). */
export type BadgeTone = 'neutral' | 'accent';

/** Props for Badge. */
export interface BadgeProps {
  /** The count. Over `max` it shows as "99+". */
  readonly count: number;
  readonly max?: number;
  readonly tone?: BadgeTone;
  /** What it counts, read after the number by screen readers ("unread"). */
  readonly label?: string;
}

/** A small count beside a tab, a nav item or a list: 3, or 99+ past the limit. */
export function Badge({ count, max = 99, tone = 'neutral', label }: BadgeProps) {
  const { locale } = useFormatSettings();
  const number = new Intl.NumberFormat(locale);
  const text = count > max ? strings.overMax(number.format(max)) : number.format(count);
  return (
    <span className={styles.root} data-tone={tone}>
      {text}
      {label !== undefined && <VisuallyHidden> {label}</VisuallyHidden>}
    </span>
  );
}
