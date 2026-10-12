import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import type { EditorProps } from '../types.ts';
import { asList, isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** The key of the "Create" item, which no option id can be. */
const CREATE = '\u0000create';

/** Up to this many options, a single select is a Select; past it, a Menu with search. */
export const SELECT_MENU_THRESHOLD = 15;

/**
 * Select: a Select of tags for up to 15 options, a searchable Menu past that,
 * and a Menu with checks when the attribute holds several. Archived options
 * can't be chosen; "Clear" shows when the attribute isn't required. With
 * `onCreateOption`, typing a label no live option has offers "Create "<label>""
 * last in either (spec 0012, AC-238).
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

  if (!attribute.allowMultiple && options.length <= SELECT_MENU_THRESHOLD) {
    return (
      <Select
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        variant={surface === 'cell' ? 'cell' : 'default'}
        optionStyle="tag"
        placeholder={strings.choose(attribute.name)}
        isRequired={attribute.isRequired}
        isClearable={!attribute.isRequired}
        {...opening}
        value={chosen[0] ?? null}
        items={options.map((option) => ({
          id: option.id,
          label: option.label,
          hue: option.hue,
          isArchived: option.archived,
        }))}
        onChange={commit}
        {...(onCreateOption === undefined
          ? {}
          : { onCreate: onCreateOption, ...(startText === undefined ? {} : { defaultSearch: startText }) })}
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
  const menu = (
    <Menu
      label={attribute.name}
      // In a grid cell's popover, the search and the choices sit in the panel itself.
      isInline={surface === 'cell'}
      search={{
        label: strings.search(attribute.name),
        ...(startText === undefined ? {} : { defaultQuery: startText }),
        ...(onCreateOption === undefined ? {} : { onSearch: setQuery }),
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
  if (surface === 'cell') return menu;
  return (
    <MenuTrigger {...opening}>
      <Button variant="secondary" iconRight="chevron-down">
        {chosen.length === 0
          ? strings.choose(attribute.name)
          : options
              .filter((option) => chosen.includes(option.id))
              .map((option) => option.label)
              .join(strings.listJoin)}
      </Button>
      {menu}
    </MenuTrigger>
  );
}
