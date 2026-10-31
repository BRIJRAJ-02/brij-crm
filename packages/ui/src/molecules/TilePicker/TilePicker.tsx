import { useId, type ReactNode } from 'react';
import { Header, ListBox, ListBoxItem, ListBoxSection, Text } from 'react-aria-components';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './TilePicker.module.css';

/** One choice: a tile with its icon and its name, and a few words about it. */
export interface TileItem {
  readonly id: string;
  /** Its name: the option's accessible name, alone (the hint is its description). */
  readonly label: string;
  readonly icon: IconName;
  /** Three or four words about it ("One from a list"): the option's description, and the line under the tiles. */
  readonly hint?: string;
  /** The heading it sits under. Items with no group come first, under no heading. */
  readonly group?: string;
}

/** Props for TilePicker. */
export interface TilePickerProps {
  /** The question ("Type"). */
  readonly label: string;
  readonly items: readonly TileItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly isDisabled?: boolean;
  /** Why the choice can't stand, under the tiles. */
  readonly error?: string;
}

/** The items by group, each group where its first item stood and its items in their order: one section each. */
function sectionsOf(
  items: readonly TileItem[],
): readonly { readonly title: string; readonly items: readonly TileItem[] }[] {
  const titles = [...new Set(items.map((item) => item.group ?? ''))];
  return titles.map((title) => ({ title, items: items.filter((item) => (item.group ?? '') === title) }));
}

/**
 * One of a set of kinds, all in sight as compact tiles under their headings (a new attribute's type), with the
 * chosen one's few words under them. A grid ListBox: the arrow keys move between tiles, Enter or Space picks one,
 * and each tile reads as an option by its name alone, its words as its description.
 */
export function TilePicker({ label, items, value, onChange, isDisabled = false, error }: TilePickerProps) {
  const labelId = useId();
  const errorId = useId();
  const chosen = items.find((item) => item.id === value);
  const tile = (item: TileItem): ReactNode => (
    <ListBoxItem key={item.id} id={item.id} textValue={item.label} className={styles.tile}>
      <span className={styles.icon}>
        <Icon name={item.icon} size="sm" />
      </span>
      <Text slot="label" className={styles.name}>
        {item.label}
      </Text>
      {item.hint !== undefined && (
        <VisuallyHidden>
          <Text slot="description">{item.hint}</Text>
        </VisuallyHidden>
      )}
    </ListBoxItem>
  );
  return (
    <div className={styles.root} data-invalid={error === undefined ? undefined : ''}>
      <FieldLabel as="text" id={labelId} label={label} tone="strong" isDisabled={isDisabled} />
      <ListBox
        aria-labelledby={labelId}
        {...(error === undefined ? {} : { 'aria-describedby': errorId })}
        className={styles.list}
        layout="grid"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        // Disabled, every tile is: ListBox takes disabled keys, not a disabled flag.
        {...(isDisabled ? { disabledKeys: items.map((item) => item.id) } : {})}
        onSelectionChange={(keys) => {
          const [key] = keys === 'all' ? [] : [...keys];
          if (key !== undefined) onChange(String(key));
        }}
      >
        {sectionsOf(items).map((section) =>
          section.title === '' ? (
            <ListBoxSection key="ungrouped" className={styles.section}>
              {section.items.map(tile)}
            </ListBoxSection>
          ) : (
            <ListBoxSection key={section.title} className={styles.section}>
              <Header className={styles.heading}>{section.title}</Header>
              {section.items.map(tile)}
            </ListBoxSection>
          ),
        )}
      </ListBox>
      {/* The chosen kind in a few words, for the eye: each option carries its own as its description. */}
      {chosen?.hint !== undefined && error === undefined && (
        <span className={styles.chosen} aria-hidden="true">
          <span className={styles.chosenName}>{chosen.label}</span>
          {chosen.hint}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className={styles.error}>
          <Icon name="circle-alert" size="xs" />
          {error}
        </span>
      )}
    </div>
  );
}
