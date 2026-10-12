import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { formatDecimal } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { strings } from './strings.ts';

/**
 * Number: the exact decimal in the language's grouping, in tabular figures
 * (end aligned in cells); a percent attribute adds the sign to the number as
 * typed (12.5 shows "12.5%").
 */
export function NumberDisplay({ attribute, value, surface }: DisplayProps<'number'>) {
  const { locale } = useFormatSettings();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const shown = formatDecimal(value as string, locale);
  return <TruncatedText isNumeric>{attribute.isPercent === true ? strings.percent(shown) : shown}</TruncatedText>;
}
