import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { formatDate, formatDayNear } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { useToday } from '../../provider/today.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/**
 * Date: the day in the member's date format ("Oct 8, 2026"), shifted by no
 * time zone. Today, tomorrow and yesterday read as the word, on every surface
 * (a cell, the panel, a card, a form, a filter, an import preview), with the
 * exact date in a tooltip and read after it by screen readers; any other day
 * is the exact date. Re-renders only when the day changes (`useToday`).
 */
export function DateDisplay({ value, surface }: DisplayProps<'date'>) {
  const { locale, dateFormat } = useFormatSettings();
  const today = useToday();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const day = value as string;
  const exact = formatDate(day, locale, dateFormat);
  const near = formatDayNear(day, today, locale);
  if (near === undefined) return <TruncatedText>{exact}</TruncatedText>;
  return (
    <Tooltip content={exact} isTextTrigger>
      <>
        <time dateTime={day}>
          <TruncatedText>{near}</TruncatedText>
        </time>
        <VisuallyHidden>{exact}</VisuallyHidden>
      </>
    </Tooltip>
  );
}
