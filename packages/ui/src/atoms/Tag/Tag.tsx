import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import type { Hue } from '../../hue.ts';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { strings } from './strings.ts';
import styles from './Tag.module.css';

/** Props for Tag. */
export interface TagProps {
  /** The option's label. */
  readonly children: string;
  /** The option's hue; gray when none. */
  readonly hue?: Hue;
  /** An archived option, still on old values: it shows muted, with "archived" for screen readers. */
  readonly isArchived?: boolean;
}

/** One select option as a coloured tag, the same in a cell, a panel, a card and a filter. */
export function Tag({ children, hue = 'gray', isArchived = false }: TagProps) {
  return (
    <span className={styles.root} data-hue={isArchived ? 'gray' : hue} data-archived={isArchived || undefined}>
      <span className={styles.label} data-truncated="">
        {children}
      </span>
      {isArchived && <VisuallyHidden> {strings.archived}</VisuallyHidden>}
    </span>
  );
}

/** One tag in a TagList. */
export interface TagItem {
  readonly id: string;
  readonly label: string;
  readonly hue: Hue;
  readonly isArchived?: boolean;
}

/** Props for TagList. */
export interface TagListProps {
  readonly tags: readonly TagItem[];
  /** How many show before a "+N" that opens the rest. Cards use 3; cells measure their width. Leave it out to show all. */
  readonly maxVisible?: number;
}

/** Several tags in a row. Past `maxVisible`, a "+N" chip opens the rest in a popover. */
export function TagList({ tags, maxVisible }: TagListProps) {
  const shown = maxVisible === undefined ? tags : tags.slice(0, maxVisible);
  const rest = tags.slice(shown.length);
  return (
    <span className={styles.list}>
      {shown.map((tag) => (
        <Tag key={tag.id} hue={tag.hue} isArchived={tag.isArchived ?? false}>
          {tag.label}
        </Tag>
      ))}
      {rest.length > 0 && (
        <DialogTrigger>
          <AriaButton className={styles.more} aria-label={strings.showMore(rest.length)}>
            {strings.more(rest.length)}
          </AriaButton>
          <Popover label={strings.allTags}>
            <span className={styles.stack}>
              {tags.map((tag) => (
                <Tag key={tag.id} hue={tag.hue} isArchived={tag.isArchived ?? false}>
                  {tag.label}
                </Tag>
              ))}
            </span>
          </Popover>
        </DialogTrigger>
      )}
    </span>
  );
}
