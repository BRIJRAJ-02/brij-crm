import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Text: one line in the body style, cut with an ellipsis and the full text in a tooltip. */
export function TextDisplay({ value, surface }: DisplayProps<'text'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <TruncatedText>{value as string}</TruncatedText>;
}
