// The keyboard first picker (spec 0003, the app shell): Quick actions (⌘K) and
// "Choose record". A search field over a list of 28px rows, each a name, a
// quiet identifier and its kind, with the keys it answers named at the foot.
import type { ReactNode } from 'react';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import type { ListSource } from '../../lib/list-source.ts';
import { Menu } from '../../molecules/Menu/Menu.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import styles from './CommandPalette.module.css';
import { strings } from './strings.ts';

/** One row: an action or a record. */
export interface PaletteItem {
  readonly id: string;
  readonly name: string;
  /** The quiet identifier after the name: a domain, an email. */
  readonly description?: string;
  /** Its kind, at the end: Company, Person, Action. */
  readonly kind?: string;
  readonly icon?: IconName;
  /** In place of the icon: an Avatar or a record's tile. */
  readonly leading?: ReactNode;
  /** An action's shortcut, written with Mac symbols. */
  readonly kbd?: string;
}

/** Props for CommandPalette. */
export interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** What it picks: "Quick actions" (the default), "Choose record". */
  readonly title?: string;
  /** The search field's name. */
  readonly searchLabel?: string;
  /** The rows for the current search, from outside; rows still loading draw skeletons. */
  readonly items: ListSource<PaletteItem>;
  /** The search as it is typed; send back the rows that match through `items`. */
  readonly onSearch: (query: string) => void;
  /** Where the search stands while no rows show: still `searching`, or it `failed`. Otherwise no rows means nothing matches. */
  readonly searchStatus?: 'ready' | 'searching' | 'failed';
  /** The row chosen, by Enter or a click; the palette then closes. */
  readonly onAction: (item: PaletteItem) => void;
}

/**
 * A palette over the page, opened from the keyboard many times a day, so it
 * never animates. Typing searches (through `onSearch`), the arrows move the
 * highlight, Enter chooses and Esc closes. Long and async lists are
 * virtualised.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
  title = strings.title,
  searchLabel = strings.search,
  items,
  onSearch,
  onAction,
  searchStatus = 'ready',
}: CommandPaletteProps) {
  const choose = (key: string | number) => {
    for (let index = 0; index < items.count; index += 1) {
      const item = items.getItem(index);
      if (item !== undefined && items.getKey(item) === String(key)) {
        onAction(item);
        onOpenChange(false);
        return;
      }
    }
  };
  return (
    <Modal
      title={title}
      variant="palette"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={
        <span className={styles.hint}>
          <Kbd>{strings.keys.move}</Kbd> {strings.move}
          <Kbd>{strings.keys.choose}</Kbd> {strings.choose}
          <Kbd>{strings.keys.close}</Kbd> {strings.close}
        </span>
      }
    >
      <div className={styles.list}>
        <Menu<PaletteItem>
          label={title}
          isInline
          search={{ label: searchLabel, onSearch }}
          emptyLabel={
            searchStatus === 'searching'
              ? strings.searching
              : searchStatus === 'failed'
                ? strings.failed
                : strings.noResults
          }
          source={items}
          renderItem={(item) => ({
            children: item.name,
            ...(item.icon === undefined ? {} : { icon: item.icon }),
            ...(item.leading === undefined ? {} : { leading: item.leading }),
            ...(item.description === undefined ? {} : { description: item.description }),
            ...(item.kind === undefined ? {} : { meta: item.kind }),
            ...(item.kbd === undefined ? {} : { kbd: item.kbd }),
          })}
          onAction={choose}
        />
      </div>
    </Modal>
  );
}
