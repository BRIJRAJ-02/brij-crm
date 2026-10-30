import { formatDecimal } from '../../lib/format.ts';
import { parseAmount } from '../../lib/parse-input.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/**
 * Number: a Field read in the language's format (1.234,5 in German), never
 * through a lossy JS number. It forgives what people paste: "1,200", "1.2k",
 * "2M", "(300)", "12%" and a stray currency sign all read (`parseAmount`).
 */
export function NumberEditor(props: EditorProps<'number'>) {
  const { locale } = useFormatSettings();
  const initial = typeof props.value === 'string' ? formatDecimal(props.value, locale) : '';
  const example = formatDecimal('1234.5', locale);
  return (
    <TextLikeEditor<'number'>
      {...props}
      initial={initial}
      inputMode="decimal"
      align="end"
      {...(props.attribute.isPercent === true ? { suffix: strings.percentSign } : {})}
      placeholder={example}
      {...(isCompactSurface(props.surface) ? {} : { hint: strings.hint(example) })}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'number'>(props.attribute, null);
        const parsed = parseAmount(draft, { locale });
        return parsed === undefined
          ? { ok: false, message: strings.invalid(example) }
          : toCommittable<'number'>(props.attribute, parsed.amount);
      }}
    />
  );
}
