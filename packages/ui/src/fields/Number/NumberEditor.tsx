import { parseLocaleDecimal } from '../../lib/decimal.ts';
import { formatDecimal } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** Number: a Field read in the language's format (1.234,5 in German), never through a lossy JS number. */
export function NumberEditor(props: EditorProps<'number'>) {
  const { locale } = useFormatSettings();
  const initial = typeof props.value === 'string' ? formatDecimal(props.value, locale) : '';
  const example = formatDecimal('1234.5', locale);
  return (
    <TextLikeEditor<'number'>
      {...props}
      initial={initial}
      inputMode="decimal"
      hint={props.surface === 'cell' ? undefined : strings.hint(example)}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'number'>(props.attribute, null);
        const canonical = parseLocaleDecimal(draft, locale);
        return canonical === undefined
          ? { ok: false, message: strings.invalid(example) }
          : toCommittable<'number'>(props.attribute, canonical);
      }}
    />
  );
}
