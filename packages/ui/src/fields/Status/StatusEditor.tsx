import { Select } from '../../molecules/Select/Select.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** Status: a Select with dot options; archived statuses can't be chosen. Always one value. */
export function StatusEditor({ attribute, value, surface, onCommit }: EditorProps<'status'>) {
  const isCompact = surface === 'cell' || surface === 'filter';
  return (
    <Select
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      optionStyle="dot"
      placeholder={strings.choose(attribute.name)}
      isRequired={attribute.isRequired}
      isClearable={!attribute.isRequired}
      value={typeof value === 'string' ? value : null}
      items={(attribute.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        hue: option.hue,
        isArchived: option.archived,
      }))}
      onChange={(next) => {
        const result = toCommittable<'status'>(attribute, next);
        if (result.ok) onCommit(result.value);
      }}
    />
  );
}
