import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import type { EditorProps } from '../types.ts';
import { asList, isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** The key of the "Create" item, which no option id can be. */
const CREATE = '\u0000create';

/** Up to this many options, a single select is a Select in a grid cell; past it, a Menu with search. */
export const SELECT_MENU_THRESHOLD = 15;

/** From this many options, a list searches as it opens: typing filters it rather than jumping (Attio's 2d5eaf6b). */
export const SELECT_SEARCH_THRESHOLD = 8;

/** How many chosen options a multiple select's closed field shows before "+N", as its display shows. */
export const SELECT_MAX_VISIBLE = 3;

/**
 * Select: outside a grid cell, a Select whose closed field shows the chosen
 * options as their tags (one, or several when the attribute holds several, as
 * the display does); in a cell, a Select of tags for up to 15 options and a
 * searchable Menu past that or when it holds several. From 8 options typing
 * filters the list. Archived options can't be chosen; "Clear" shows when the
 * attribute isn't required. With `onCreateOption`, typing a label no live
 * option has offers "Create "<label>"" last (spec 0012, AC-238).
 */
export function SelectEditor({
  attribute,
  value,
  surface,
  onCommit,
  onCancel,
  autoOpen = false,
  startText,
  onCreateOption,
  isDisabled = false,
}: EditorProps<'select'>) {
  const options = attribute.options ?? [];
  // With Create (spec 0012, AC-238), the menu's search is held here: what is typed names the new option.
  const [query, setQuery] = useState(startText ?? '');
  const chosen = asList<string>(value);
  const isCompact = isCompactSurface(surface);
  const commit = (candidate: unknown) => {
    const result = toCommittable<'select'>(attribute, candidate);
    if (result.ok) onCommit(result.value);
  };
  // Opened by the grid: closing the list ends the edit.
  const opening = autoOpen
    ? {
        defaultOpen: true,
        onOpenChange: (isOpen: boolean) => {
          if (!isOpen) onCancel?.();
        },
      }
    : {};

  const isCell = surface === 'cell';
  if (!isCell || (!attribute.allowMultiple && options.length <= SELECT_MENU_THRESHOLD)) {
    const isSearchable = onCreateOption !== undefined || options.length >= SELECT_SEARCH_THRESHOLD;
    const items = options.map((option) => ({
      id: option.id,
      label: option.label,
      isArchived: option.archived,
      face: (
        <Tag hue={option.hue} isArchived={option.archived}>
          {option.label}
        </Tag>
      ),
    }));
    return (
      <Select
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        variant={isCell ? 'cell' : 'default'}
        optionStyle="tag"
        placeholder={strings.choose(attribute.name)}
        isRequired={attribute.isRequired}
        isClearable={!attribute.isRequired}
        isDisabled={isDisabled}
        {...opening}
        items={items}
        {...(attribute.allowMultiple
          ? {
              selectionMode: 'multiple' as const,
              values: chosen,
              onValuesChange: commit,
              maxVisible: SELECT_MAX_VISIBLE,
            }
          : { value: chosen[0] ?? null, onChange: commit })}
        {...(isSearchable
          ? {
              isSearchable: true,
              searchLabel: strings.search(attribute.name),
              ...(startText === undefined ? {} : { defaultSearch: startText }),
            }
          : {})}
        {...(onCreateOption === undefined ? {} : { onCreate: onCreateOption })}
      />
    );
  }

  const disabledKeys = options
    .filter((option) => option.archived && !chosen.includes(option.id))
    .map((option) => option.id);
  const typed = query.trim();
  // Searched here when Create is on (the menu hands the query over), else by the menu itself.
  const shown =
    onCreateOption === undefined || typed === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(typed.toLowerCase()));
  const canCreate =
    onCreateOption !== undefined &&
    typed !== '' &&
    !options.some((option) => !option.archived && option.label.trim().toLowerCase() === typed.toLowerCase());
  return (
    <Menu
      label={attribute.name}
      // In a grid cell's popover, the search and the choices sit in the panel itself.
      isInline
      search={{
        label: strings.search(attribute.name),
        ...(startText === undefined ? {} : { defaultQuery: startText }),
        ...(onCreateOption === undefined ? {} : { onSearch: setQuery }),
        // Create alone in the list waits for an arrow: one Enter on a typo never makes an option.
        ...(canCreate && shown.length === 0 ? { isFirstUnfocused: true } : {}),
      }}
      selectionMode={attribute.allowMultiple ? 'multiple' : 'single'}
      selectedKeys={chosen}
      disabledKeys={disabledKeys}
      onSelectionChange={(keys: ReadonlySet<Key>) => {
        if (keys.has(CREATE)) {
          if (canCreate) onCreateOption(typed);
          return;
        }
        const ids = options.filter((option) => keys.has(option.id)).map((option) => option.id);
        commit(attribute.allowMultiple ? ids : (ids[0] ?? null));
      }}
    >
      {shown.map((option) => (
        <MenuItem
          key={option.id}
          id={option.id}
          isLabelInLeading
          leading={
            <Tag hue={option.hue} isArchived={option.archived}>
              {option.label}
            </Tag>
          }
        >
          {option.label}
        </MenuItem>
      ))}
      {canCreate && (
        <MenuItem key={CREATE} id={CREATE} icon="plus">
          {strings.create(typed)}
        </MenuItem>
      )}
    </Menu>
  );
}
