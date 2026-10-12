import { Select } from '../../molecules/Select/Select.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/**
 * Status: a Select with dot options; archived statuses can't be chosen.
 * Always one value. With `onCreateOption`, the list searches and offers
 * "Create "<typed>"" for a stage it doesn't have.
 */
export function StatusEditor({
  attribute,
  value,
  surface,
  onCommit,
  onCancel,
  autoOpen = false,
  startText,
  onCreateOption,
}: EditorProps<'status'>) {
  const isCompact = isCompactSurface(surface);
  return (
    <Select
      // Opened by the grid: closing the list ends the edit.
      {...(autoOpen
        ? {
            defaultOpen: true,
            onOpenChange: (isOpen: boolean) => {
              if (!isOpen) onCancel?.();
            },
          }
        : {})}
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      variant={surface === 'cell' ? 'cell' : 'default'}
      optionStyle="dot"
      placeholder={strings.choose(attribute.name)}
      isRequired={attribute.isRequired}
      isClearable={!attribute.isRequired}
      value={typeof value === 'string' ? value : null}
      {...(onCreateOption === undefined
        ? {}
        : {
            onCreate: onCreateOption,
            searchLabel: strings.search(attribute.name),
            ...(startText === undefined ? {} : { defaultSearch: startText }),
          })}
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
