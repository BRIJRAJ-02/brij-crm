import { OBJECT_ICONS, type ObjectIcon } from '@crm/contracts/values';
import { Autocomplete, Input, ListBox, ListBoxItem, SearchField, useFilter } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { Hue } from '../../hue.ts';
import styles from './IconPicker.module.css';
import { strings } from './strings.ts';

/** Props for IconPicker. */
export interface IconPickerProps {
  /** What the icon is for ("Object icon"). */
  readonly label: string;
  readonly value?: ObjectIcon;
  readonly onChange?: (icon: ObjectIcon) => void;
  /** Draws each icon on this hue's tile, as the object will show. */
  readonly hue?: Hue;
}

/** "building-complex" as words: "Building complex". */
function nameOf(icon: string): string {
  const words = icon.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pick an object's icon from the curated set (about 150 Lucide icons), with a
 * search. Lucide's full set and its dynamic loader are never offered.
 */
export function IconPicker({ label, value, onChange, hue }: IconPickerProps) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const items = OBJECT_ICONS.map((icon) => ({ id: icon, name: nameOf(icon) }));
  return (
    <div className={styles.root}>
      <Autocomplete filter={contains}>
        <SearchField className={styles.search} aria-label={strings.search}>
          <Icon name="search" size="sm" tone="muted" />
          <Input className={styles.input} placeholder={strings.searchPlaceholder} />
        </SearchField>
        {/* The search keeps focus (the grid's focus is virtual), so the scroll box takes Tab itself. */}
        {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex */}
        <div className={styles.scroller} role="region" aria-label={label} tabIndex={0}>
          <ListBox
            className={styles.grid}
            aria-label={label}
            layout="grid"
            items={items}
            selectionMode="single"
            renderEmptyState={() => <span className={styles.empty}>{strings.noResults}</span>}
            {...(value === undefined ? {} : { selectedKeys: [value] })}
            onSelectionChange={(keys) => {
              const [key] = keys === 'all' ? [] : [...keys];
              if (key !== undefined) onChange?.(String(key) as ObjectIcon);
            }}
          >
            {(item) => (
              <ListBoxItem id={item.id} textValue={item.name} aria-label={item.name} className={styles.item}>
                {hue === undefined ? <Icon name={item.id} size="md" /> : <Icon name={item.id} tile={hue} />}
              </ListBoxItem>
            )}
          </ListBox>
        </div>
      </Autocomplete>
    </div>
  );
}
