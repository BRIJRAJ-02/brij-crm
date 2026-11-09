import { Autocomplete, TextField, Input, Menu, MenuItem, MenuSection, Header, ModalOverlay, Modal, Dialog, Heading, Button as AriaButton, useFilter, type Key } from 'react-aria-components';
import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import './CommandPalette.css';

/** One result. `person` and `record` draw as a PersonLine (round or square avatar); `action` as an icon and a label. */
export interface CommandItem {
  readonly id: string;
  readonly label: string;
  /** The group heading it sits under ("Recent", "Records", "Actions"). */
  readonly group: string;
  readonly kind: 'person' | 'record' | 'action';
  /** The grey sub-line (a company, an email, "Company · 240 employees"). */
  readonly sub?: string;
  /** A 16px icon for actions. */
  readonly icon?: ReactNode;
  readonly shortcut?: string;
  /** Extra words the search matches ("new booking" finds "Create a meeting"). */
  readonly keywords?: string;
}

/** Props for CommandMenu. */
export interface CommandMenuProps {
  readonly items: ReadonlyArray<CommandItem>;
  readonly onAction: (id: string) => void;
  /** Typing "?" in an empty search calls this (open ShortcutHelp). */
  readonly onShowShortcuts?: () => void;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
}

/** The palette's contents: a search that filters grouped results, with a key hint strip. Draw it inside CommandPalette, or inline. */
export function CommandMenu({ items, onAction, onShowShortcuts, placeholder = 'Search or type a command…', autoFocus = false }: CommandMenuProps) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const [query, setQuery] = useState('');
  const groups = [...new Set(items.map((it) => it.group))];
  return (
    <div className="tf-cmd">
      <Autocomplete inputValue={query} onInputChange={setQuery} filter={(text, input) => contains(text, input)}>
        <TextField
          aria-label="Search Timefix"
          autoFocus={autoFocus}
          className="tf-cmd__field"
          onKeyDown={(e) => { if (e.key === '?' && query === '' && onShowShortcuts) { e.preventDefault(); onShowShortcuts(); } }}
        >
          <Search className="tf-cmd__glass" size={20} strokeWidth={1.75} aria-hidden="true" />
          <Input className="tf-cmd__input" placeholder={placeholder} />
          {query !== '' && <AriaButton className="tf-cmd__clear" aria-label="Clear search" onPress={() => setQuery('')}><X size={16} strokeWidth={1.75} /></AriaButton>}
        </TextField>
        <Menu
          aria-label="Results"
          className="tf-cmd__list"
          onAction={(k: Key) => onAction(String(k))}
          renderEmptyState={() => <div className="tf-cmd__empty">No results for “{query}”. Try a name, a company or an action.</div>}
        >
          {groups.map((g) => (
            <MenuSection key={g} id={g} className="tf-cmd__section">
              <Header className="tf-cmd__header">{g}</Header>
              {items.filter((it) => it.group === g).map((it) => (
                <MenuItem key={it.id} id={it.id} textValue={`${it.label} ${it.sub ?? ''} ${it.keywords ?? ''}`} className={cx('tf-cmd__item', it.kind === 'action' && 'tf-cmd__item--action')}>
                  {it.kind === 'action'
                    ? <><span className="tf-cmd__icon">{it.icon}</span><span className="tf-cmd__label">{it.label}</span></>
                    : <PersonLine name={it.label} sub={it.sub} shape={it.kind === 'record' ? 'square' : 'round'} />}
                  {it.shortcut !== undefined && <span className="tf-cmd__kbd"><Kbd>{it.shortcut}</Kbd></span>}
                </MenuItem>
              ))}
            </MenuSection>
          ))}
        </Menu>
      </Autocomplete>
      <div className="tf-cmd__foot" aria-hidden="true">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
        <span><Kbd>↵</Kbd> Open</span>
        <span><Kbd>Esc</Kbd> Close</span>
        {onShowShortcuts && <span className="tf-cmd__foot-end"><Kbd>?</Kbd> Shortcuts</span>}
      </div>
    </div>
  );
}

/** Props for CommandPalette. */
export interface CommandPaletteProps extends Omit<CommandMenuProps, 'autoFocus'> {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** ⌘K: jump to any record, person or action from anywhere. A centred dialog that closes after an action. */
export function CommandPalette({ isOpen, onOpenChange, onAction, ...rest }: CommandPaletteProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="tf-cmd-overlay tf-overlay">
      <Modal className="tf-cmd-modal">
        <Dialog aria-label="Command palette" className="tf-cmd-dialog">
          <CommandMenu {...rest} autoFocus onAction={(id) => { onAction(id); onOpenChange(false); }} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** Opens the palette on ⌘K (Ctrl+K off the Mac). Call once, where the palette lives. */
export function useCommandK(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/** A group of shortcuts: a title and rows of label plus keys (each key one Kbd). */
export interface ShortcutGroup {
  readonly title: string;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly keys: ReadonlyArray<string> }>;
}

/** Timefix's shortcuts, grouped. */
export const DEFAULT_SHORTCUTS: ReadonlyArray<ShortcutGroup> = [
  { title: 'General', rows: [{ label: 'Command palette', keys: ['⌘', 'K'] }, { label: 'Keyboard shortcuts', keys: ['?'] }, { label: 'Fold the sidebar', keys: ['['] }, { label: 'Settings', keys: ['⌘', ','] }] },
  { title: 'Go to', rows: [{ label: 'Home', keys: ['G', 'H'] }, { label: 'Inbox', keys: ['G', 'I'] }, { label: 'Bookings', keys: ['G', 'B'] }, { label: 'Favourite 1 to 9', keys: ['⌘', '1'] }] },
  { title: 'Records', rows: [{ label: 'New record', keys: ['C'] }, { label: 'Filter', keys: ['F'] }, { label: 'Open the selected row', keys: ['↵'] }, { label: 'Delete', keys: ['⌘', '⌫'] }] },
  { title: 'Bookings', rows: [{ label: 'New meeting', keys: ['N'] }, { label: 'Copy the booking link', keys: ['⌘', 'L'] }, { label: 'Today', keys: ['T'] }, { label: 'Next week', keys: ['→'] }] },
];

/** The shortcut list itself, in two columns; ShortcutHelp draws it in a sheet. */
export function ShortcutList({ groups = DEFAULT_SHORTCUTS }: { readonly groups?: ReadonlyArray<ShortcutGroup> }) {
  return (
    <div className="tf-keys">
      {groups.map((g) => (
        <section key={g.title} className="tf-keys__group">
          <h3 className="tf-keys__title">{g.title}</h3>
          <dl className="tf-keys__rows">
            {g.rows.map((r) => (
              <div key={r.label} className="tf-keys__row"><dt>{r.label}</dt><dd>{r.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** "?": a sheet listing every keyboard shortcut, grouped, with keycaps. */
export function ShortcutHelp({ isOpen, onOpenChange, groups }: { readonly isOpen: boolean; readonly onOpenChange: (isOpen: boolean) => void; readonly groups?: ReadonlyArray<ShortcutGroup> }) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="tf-cmd-overlay tf-overlay">
      <Modal className="tf-cmd-modal tf-cmd-modal--sheet">
        <Dialog className="tf-cmd-dialog tf-keys-dialog">
          <div className="tf-keys-dialog__head">
            <Heading slot="title" className="tf-keys-dialog__title">Keyboard shortcuts</Heading>
            <AriaButton slot="close" className="tf-cmd__clear" aria-label="Close"><X size={16} strokeWidth={1.75} /></AriaButton>
          </div>
          <ShortcutList groups={groups} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
