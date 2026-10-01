import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef, FieldAttribute } from '../types.ts';
import { asList, listFromText, refuse } from '../values.ts';
import { optionOf, SelectDisplay } from './SelectDisplay.tsx';
import { SelectEditor } from './SelectEditor.tsx';

/** Finds an option by its label, ignoring case; archived options can't be chosen by text. */
export function optionByLabel(attribute: FieldAttribute, label: string) {
  const wanted = label.trim().toLocaleLowerCase();
  const option = attribute.options?.find((candidate) => candidate.label.toLocaleLowerCase() === wanted);
  if (option === undefined) return refuse(`No option called “${label.trim()}”.`);
  return option.archived ? refuse(`“${option.label}” is archived, so it can’t be chosen.`) : option.id;
}

/** The select type: one option, or several when the attribute allows it. */
export const selectType: AttributeTypeDef<'select'> = {
  type: 'select',
  icon: 'tag',
  Display: SelectDisplay,
  Editor: SelectEditor,
  operators: (attribute) =>
    withEmpty(
      attribute.allowMultiple
        ? ['contains_any_of', 'contains_all_of', 'contains_none_of']
        : ['is', 'is_not', 'is_any_of'],
    ),
  toText: (value, context) =>
    asList<string>(value)
      .map((id) => optionOf(context.attribute, id).label)
      .join(', '),
  fromText: (text, context) =>
    context.attribute.allowMultiple
      ? listFromText(text, (part) => optionByLabel(context.attribute, part))
      : optionByLabel(context.attribute, text),
  align: 'start',
  editIn: 'popover',
  width: 'default',
};
