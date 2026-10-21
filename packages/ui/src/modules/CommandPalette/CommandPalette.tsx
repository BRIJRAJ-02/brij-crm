// The keyboard first picker (spec 0003, the app shell; spec 0039, the command
// menu): Quick actions (⌘K), global search and "Choose record". A search field
// over rows, each a name, a quiet identifier and its kind, with the keys it
// answers named at the foot. Rows come as one flat list (`items`, long and
// async, virtualised) or in sections under headings (`sections`, the command
// menu's Recent, Records, Views, Pages, Settings and Actions).
import { useEffect, useState, type ReactNode } from 'react';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ListSource } from '../../lib/list-source.ts';
import { Menu, MenuItem, MenuSection } from '../../molecules/Menu/Menu.tsx';
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
  /** What is in effect now (the current theme): a check at the end, read as "Current". */
  readonly isChecked?: boolean;
}

/** One group of rows under a heading. */
export interface PaletteSection {
  readonly id: string;
  /** The heading, which also names the group for screen readers ("Records"). */
  readonly label: string;
  readonly items: readonly PaletteItem[];
  /**
   * Where the section's own search stands, as a row at its end: still
   * `searching`, or it `failed` (that row asks again when chosen). A section
   * with a status shows even with no rows.
   */
  readonly status?: 'searching' | 'failed';
}

interface PaletteLook {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** What it is, naming the dialog: "Quick actions" (the default), "Command menu", "Search", "Choose record". */
  readonly title?: string;
  /** The search field's name. */
  readonly searchLabel?: string;
  /** Hint text in the search field; defaults to the field's name with an ellipsis. */
  readonly placeholder?: string;
  /** The search as it is typed; send back the rows that match. */
  readonly onSearch: (query: string) => void;
  /** The row chosen, by Enter or a click; the palette then closes. */
  readonly onAction: (item: PaletteItem) => void;
}

/** Props for CommandPalette: a flat list from a ListSource, or rows in sections. */
export type CommandPaletteProps = PaletteLook &
  (
    | {
        /** The rows for the current search, from outside; rows still loading draw skeletons. */
        readonly items: ListSource<PaletteItem>;
        /** Where the search stands while no rows show: still `searching`, or it `failed`. Otherwise no rows means nothing matches. */
        readonly searchStatus?: 'ready' | 'searching' | 'failed';
        readonly sections?: never;
        readonly onRetry?: never;
      }
    | {
        /** The rows in order, each group under its heading; empty groups without a status are left out. */
        readonly sections: readonly PaletteSection[];
        /** A section's failed row chosen: ask again. The palette stays open. */
        readonly onRetry?: () => void;
        readonly items?: never;
        readonly searchStatus?: never;
      }
  );

/** The key of a section's status row: never an item's. */
const STATUS_KEY = 'palette:status';

/** How long a search runs before the live region says "Searching…", so typing quickly never chatters (AC-1098). */
const SEARCHING_SAID_AFTER_MS = 500;

/**
 * A palette over the page, opened from the keyboard many times a day, so it
 * appears at once from the keyboard. Typing searches (through `onSearch`),
 * the arrows move the highlight across sections, Enter chooses and Esc
 * closes. Long and async flat lists are virtualised; sections say how many
 * results show through a polite live region.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const { isOpen, onOpenChange, title = strings.title, searchLabel = strings.search, placeholder } = props;
  const { onSearch, onAction } = props;
  const [query, setQuery] = useState('');
  const search = (next: string) => {
    setQuery(next);
    onSearch(next);
  };
  const searchProps = { label: searchLabel, onSearch: search, ...(placeholder === undefined ? {} : { placeholder }) };
  const close = (item: PaletteItem) => {
    onAction(item);
    onOpenChange(false);
  };

  let list: ReactNode;
  let announcer: ReactNode = null;
  if (props.sections !== undefined) {
    const { sections, onRetry } = props;
    const shown = sections.filter((section) => section.items.length > 0 || section.status !== undefined);
    const choose = (key: string | number) => {
      if (key === STATUS_KEY) {
        onRetry?.();
        return;
      }
      for (const section of shown) {
        const item = section.items.find((each) => each.id === String(key));
        if (item !== undefined) {
          close(item);
          return;
        }
      }
    };
    list = (
      <Menu
        label={title}
        isInline
        search={searchProps}
        emptyLabel={query.trim() === '' ? strings.noResults : strings.nothingMatches(query.trim())}
        onAction={choose}
      >
        {shown.map((section) => (
          <MenuSection key={section.id} label={section.label}>
            {section.items.map((item) => (
              <MenuItem key={item.id} id={item.id} {...rowLook(item)}>
                {item.name}
              </MenuItem>
            ))}
            {section.status === 'searching' && (
              <MenuItem key={STATUS_KEY} id={STATUS_KEY} isDisabled>
                {strings.searching}
              </MenuItem>
            )}
            {section.status === 'failed' && (
              <MenuItem key={STATUS_KEY} id={STATUS_KEY} icon="refresh-cw">
                {strings.failed}
              </MenuItem>
            )}
          </MenuSection>
        ))}
      </Menu>
    );
    announcer = (
      <ResultCount
        count={shown.reduce((total, section) => total + section.items.length, 0)}
        isSearching={shown.some((section) => section.status === 'searching')}
      />
    );
  } else {
    const { items, searchStatus = 'ready' } = props;
    const choose = (key: string | number) => {
      for (let index = 0; index < items.count; index += 1) {
        const item = items.getItem(index);
        if (item !== undefined && items.getKey(item) === String(key)) {
          close(item);
          return;
        }
      }
    };
    list = (
      <Menu<PaletteItem>
        label={title}
        isInline
        search={searchProps}
        emptyLabel={
          searchStatus === 'searching'
            ? strings.searching
            : searchStatus === 'failed'
              ? strings.failed
              : strings.noResults
        }
        source={items}
        renderItem={(item) => ({ children: item.name, ...rowLook(item) })}
        onAction={choose}
      />
    );
  }

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
        {list}
        {announcer}
      </div>
    </Modal>
  );
}

/** A row's look as a MenuItem takes it: its leading piece, second line, kind, shortcut and check. */
function rowLook(item: PaletteItem) {
  return {
    ...(item.icon === undefined ? {} : { icon: item.icon }),
    ...(item.leading === undefined ? {} : { leading: item.leading }),
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.kind === undefined ? {} : { meta: item.kind }),
    ...(item.kbd === undefined ? {} : { kbd: item.kbd }),
    ...(item.isChecked === true ? { isChecked: true } : {}),
  };
}

/**
 * The polite live region (AC-1098): how many results show once no section
 * is searching, and "Searching…" only once a search has run past half a second.
 */
function ResultCount({ count, isSearching }: { readonly count: number; readonly isSearching: boolean }) {
  return (
    <VisuallyHidden>
      <span role="status" aria-live="polite">
        {/* Mounted afresh for each search, so its wait starts with the search. */}
        {isSearching ? <SaidWhenSlow /> : strings.results(count)}
      </span>
    </VisuallyHidden>
  );
}

/** "Searching…", once the search it was mounted for has run past half a second. */
function SaidWhenSlow() {
  const [isSlow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSlow(true);
    }, SEARCHING_SAID_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return isSlow ? strings.searching : null;
}
