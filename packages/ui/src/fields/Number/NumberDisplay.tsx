import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { formatDecimal, formatNumber } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { strings } from './strings.ts';

/**
 * Number: the exact decimal in the language's grouping, in tabular figures
 * (end aligned in cells); a percent attribute adds the sign to the number as
 * typed (12.5 shows "12.5%"). An attribute's Decimals fixes how many show,
 * and Compact writes it short ("1.2M"); whenever what shows drops digits
 * (compact, or rounded to fewer decimals), the exact number is in a tooltip
 * and read by screen readers in its place.
 */
export function NumberDisplay({ attribute, value, surface }: DisplayProps<'number'>) {
  const { locale } = useFormatSettings();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const exact = value as string;
  const shown = formatNumber(exact, locale, { decimals: attribute.decimals, isCompact: attribute.isCompact });
  const text = attribute.isPercent === true ? strings.percent(shown) : shown;
  // The exact number, padded to the same decimals: a tooltip only when what shows drops something (compact, rounded).
  const full = formatDecimal(exact, locale, attribute.decimals ?? 0);
  if (full === shown) return <TruncatedText isNumeric>{text}</TruncatedText>;
  return (
    <Tooltip content={full} isTextTrigger>
      <>
        <span aria-hidden="true">
          <TruncatedText isNumeric>{text}</TruncatedText>
        </span>
        <VisuallyHidden>{full}</VisuallyHidden>
      </>
    </Tooltip>
  );
}
