import type { SelectOption } from '@crm/contracts/values';
import { Tag, TagList } from '../../atoms/Tag/Tag.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps, FieldAttribute } from '../types.ts';
import { asList } from '../values.ts';
import { strings } from './strings.ts';

/** The option an id names, or a gray stand in when the option is gone. */
export function optionOf(attribute: FieldAttribute, id: string): SelectOption {
  return (
    attribute.options?.find((option) => option.id === id) ?? { id, label: strings.unknown, hue: 'gray', archived: true }
  );
}

/** Select: a Tag in the option's hue, or a TagList with "+N" when the attribute allows several; archived options muted. */
export function SelectDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'select'>) {
  const ids = asList<string>(value);
  if (ids.length === 0) return <EmptyValue surface={surface} />;
  const options = ids.map((id) => optionOf(attribute, id));
  if (!attribute.allowMultiple && options[0] !== undefined) {
    const option = options[0];
    return (
      <Tag hue={option.hue} isArchived={option.archived}>
        {option.label}
      </Tag>
    );
  }
  return (
    <TagList
      tags={options.map((option) => ({
        id: option.id,
        label: option.label,
        hue: option.hue,
        isArchived: option.archived,
      }))}
      {...(maxVisible === undefined ? {} : { maxVisible })}
    />
  );
}
