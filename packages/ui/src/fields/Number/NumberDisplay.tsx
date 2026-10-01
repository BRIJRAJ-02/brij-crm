import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { formatDecimal } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Number: the exact decimal in the language's grouping, in tabular figures (end aligned in cells). */
export function NumberDisplay({ value, surface }: DisplayProps<'number'>) {
  const { locale } = useFormatSettings();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <TruncatedText isNumeric>{formatDecimal(value as string, locale)}</TruncatedText>;
}
