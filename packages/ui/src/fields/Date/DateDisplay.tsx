import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { formatDate } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Date: the day in the language ("Oct 8, 2026"), shifted by no time zone. */
export function DateDisplay({ value, surface }: DisplayProps<'date'>) {
  const { locale } = useFormatSettings();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <TruncatedText>{formatDate(value as string, locale)}</TruncatedText>;
}
