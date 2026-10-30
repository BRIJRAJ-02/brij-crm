import { Select } from '../../molecules/Select/Select.tsx';
import { SELECT_SEARCH_THRESHOLD } from '../Select/SelectEditor.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/**
 * Status: a Select with dot options; archived statuses can't be chosen.
 * Always one value. From 8 stages, or with `onCreateOption`, the list
 * searches as it opens (from the key that opened a cell), and Create offers
 * "Create "<typed>"" for a stage it doesn't have. Held while a form sends.
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
  isDisabled = false,
}: EditorProps<'status'>) {
  const isCompact = isCompactSurface(surface);
  const options = attribute.options ?? [];
  const isSearchable = onCreateOption !== undefined || options.length >= SELECT_SEARCH_THRESHOLD;
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
      isDisabled={isDisabled}
      value={typeof value === 'string' ? value : null}
      {...(isSearchable
        ? {
            isSearchable: true,
            searchLabel: strings.search(attribute.name),
            ...(startText === undefined ? {} : { defaultSearch: startText }),
          }
        : {})}
      {...(onCreateOption === undefined ? {} : { onCreate: onCreateOption })}
      items={options.map((option) => ({
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
