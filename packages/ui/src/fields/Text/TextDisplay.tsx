import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { EmptyValue, ValueActions } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Text: one line in the body style, cut with an ellipsis and the full text in a tooltip; Copy beside it on the panel. */
export function TextDisplay({ value, surface }: DisplayProps<'text'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const text = value as string;
  return (
    <ValueActions surface={surface} copy={text}>
      <TruncatedText>{text}</TruncatedText>
    </ValueActions>
  );
}
