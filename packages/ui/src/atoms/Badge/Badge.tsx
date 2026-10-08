import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Badge.module.css';
import { strings } from './strings.ts';

/** `neutral` (the default) for counts beside a label, `accent` for counts that ask for attention (unread). */
export type BadgeTone = 'neutral' | 'accent';

/** What every Badge takes, count or label. */
interface BadgeBase {
  readonly tone?: BadgeTone;
  /** What it counts, read after the number by screen readers ("unread"). */
  readonly label?: string;
}

/** Props for Badge: a count, or a short label (a row's note, "New"). */
export type BadgeProps = BadgeBase &
  (
    | {
        /** The count. Over `max` it shows as "99+". */
        readonly count: number;
        readonly max?: number;
        /** The count is a floor, not the total (a capped count, "10,000+"). */
        readonly isAtLeast?: boolean;
        readonly text?: never;
      }
    | {
        /** A short label in place of a count; past the room it has, it truncates and keeps its full text. */
        readonly text: string;
        readonly count?: never;
        readonly max?: never;
        readonly isAtLeast?: never;
      }
  );

/** A small count beside a tab, a nav item or a list (3, 99+, or 10,000+ at least), or a short label. */
export function Badge(props: BadgeProps) {
  const { tone = 'neutral', label } = props;
  const { locale } = useFormatSettings();
  const number = memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale));
  let shown: string;
  if (props.text !== undefined) shown = props.text;
  else {
    const max = props.max ?? 99;
    if (props.isAtLeast === true) shown = strings.overMax(number.format(Math.min(props.count, max)));
    else shown = props.count > max ? strings.overMax(number.format(max)) : number.format(props.count);
  }
  return (
    <span className={styles.root} data-tone={tone} data-text={props.text === undefined ? undefined : ''}>
      {props.text === undefined ? shown : <span className={styles.text}>{shown}</span>}
      {label !== undefined && <VisuallyHidden> {label}</VisuallyHidden>}
    </span>
  );
}
