import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import styles from './LongTextDisplay.module.css';

/** Long text: clipped to one line in cells and on cards; the whole text, with its line breaks, elsewhere. */
export function LongTextDisplay({ value, surface }: DisplayProps<'long_text'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const text = value as string;
  if (surface === 'cell' || surface === 'card' || surface === 'filter') {
    return <TruncatedText>{text.replaceAll(/\s+/g, ' ')}</TruncatedText>;
  }
  return <span className={styles.root}>{text}</span>;
}
