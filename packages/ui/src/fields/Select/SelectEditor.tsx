import type { Key } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** Up to this many options, a single select is a Select; past it, a Menu with search. */
export const SELECT_MENU_THRESHOLD = 15;

/**
 * Select: a Select of tags for up to 15 options, a searchable Menu past that,
 * and a Menu with checks when the attribute holds several. Archived options
 * can't be chosen; "Clear" shows when the attribute isn't required.
 */
export function SelectEditor({ attribute, value, surface, onCommit }: EditorProps<'select'>) {
  const options = attribute.options ?? [];
  const chosen = asList<string>(value);
  const isCompact = surface === 'cell' || surface === 'filter';
  const commit = (candidate: unknown) => {
    const result = toCommittable<'select'>(attribute, candidate);
    if (result.ok) onCommit(result.value);
  };

  if (!attribute.allowMultiple && options.length <= SELECT_MENU_THRESHOLD) {
    return (
      <Select
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        optionStyle="tag"
        placeholder={strings.choose(attribute.name)}
        isRequired={attribute.isRequired}
        isClearable={!attribute.isRequired}
        value={chosen[0] ?? null}
        items={options.map((option) => ({
          id: option.id,
          label: option.label,
          hue: option.hue,
          isArchived: option.archived,
        }))}
        onChange={commit}
      />
    );
  }

  const disabledKeys = options
    .filter((option) => option.archived && !chosen.includes(option.id))
    .map((option) => option.id);
  return (
    <MenuTrigger>
      <Button variant="secondary" iconRight="chevron-down">
        {chosen.length === 0 ? strings.choose(attribute.name) : attribute.name}
      </Button>
      <Menu
        label={attribute.name}
        search={{ label: strings.search(attribute.name) }}
        selectionMode={attribute.allowMultiple ? 'multiple' : 'single'}
        selectedKeys={chosen}
        disabledKeys={disabledKeys}
        onSelectionChange={(keys: ReadonlySet<Key>) => {
          const ids = options.filter((option) => keys.has(option.id)).map((option) => option.id);
          commit(attribute.allowMultiple ? ids : (ids[0] ?? null));
        }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.id}
            id={option.id}
            leading={
              <Tag hue={option.hue} isArchived={option.archived}>
                {option.label}
              </Tag>
            }
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
