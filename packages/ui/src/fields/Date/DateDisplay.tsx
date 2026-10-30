import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { formatDate, formatDayNear, todayIn } from '../../lib/format.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps, Surface } from '../types.ts';

/** Where a near day reads as a word: a cell, the record panel and a card. A form, a filter and a preview keep the date. */
function readsNear(surface: Surface): boolean {
  return surface === 'cell' || surface === 'panel' || surface === 'card';
}

/**
 * Date: the day in the member's date format ("Oct 8, 2026"), shifted by no
 * time zone. Within a week of today, in a cell, the panel or a card, it reads
 * as a word ("Tomorrow", "3 days ago"), as Attio's and Linear's do, with the
 * exact date in a tooltip and read after it by screen readers.
 */
export function DateDisplay({ value, surface }: DisplayProps<'date'>) {
  const { locale, timeZone, dateFormat } = useFormatSettings();
  const now = useNow();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const day = value as string;
  const exact = formatDate(day, locale, dateFormat);
  const near = readsNear(surface) ? formatDayNear(day, todayIn(now, timeZone), locale) : undefined;
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
