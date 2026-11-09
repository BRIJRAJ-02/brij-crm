import { useState } from 'react';
import { CalendarPlus, UserPlus, Link2, FileText, Settings, Moon } from 'lucide-react';
import { CommandMenu, CommandPalette, ShortcutHelp, type CommandItem } from './CommandPalette.tsx';
import { Button } from '../Button/Button.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;

/** Timefix's palette results, shared with the AppShell demo. */
export const TIMEFIX_COMMANDS: ReadonlyArray<CommandItem> = [
  { id: 'p-priya', group: 'Recent', kind: 'person', label: 'Priya Raman', sub: 'Head of Ops · Acme Corp' },
  { id: 'c-acme', group: 'Recent', kind: 'record', label: 'Acme Corp', sub: 'Company · 240 employees' },
  { id: 'p-sam', group: 'Records', kind: 'person', label: 'Sam Kim', sub: 'sam@northwind.com' },
  { id: 'c-northwind', group: 'Records', kind: 'record', label: 'Northwind', sub: 'Company · Qualified' },
  { id: 'p-jo', group: 'Records', kind: 'person', label: 'Jo Mendes', sub: 'Founder · Globex' },
  { id: 'a-meeting', group: 'Actions', kind: 'action', label: 'New meeting', icon: <CalendarPlus {...i} />, shortcut: 'N', keywords: 'booking schedule' },
  { id: 'a-person', group: 'Actions', kind: 'action', label: 'Add a person', icon: <UserPlus {...i} />, shortcut: 'C', keywords: 'contact create' },
  { id: 'a-link', group: 'Actions', kind: 'action', label: 'Copy my booking link', icon: <Link2 {...i} />, shortcut: '⌘L' },
  { id: 'a-form', group: 'Actions', kind: 'action', label: 'New form', icon: <FileText {...i} /> },
  { id: 'a-theme', group: 'Actions', kind: 'action', label: 'Switch to dark theme', icon: <Moon {...i} /> },
  { id: 'a-settings', group: 'Actions', kind: 'action', label: 'Open settings', icon: <Settings {...i} />, shortcut: '⌘,' },
];

export function CommandPaletteDemo() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [last, setLast] = useState('—');
  const showHelp = () => { setOpen(false); setHelp(true); };
  const label = (id: string) => TIMEFIX_COMMANDS.find((c) => c.id === id)?.label ?? id;
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 560px) minmax(0, 1fr)', gap: 'var(--space-24)', alignItems: 'start' }}>
      <div style={{ height: 460, display: 'flex', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)' }}>
        <CommandMenu items={TIMEFIX_COMMANDS} onAction={(id) => setLast(label(id))} onShowShortcuts={() => setHelp(true)} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Inline above; as a dialog</p>
        <div className="tf-row">
          <Button variant="secondary" onPress={() => setOpen(true)} iconEnd={<Kbd>⌘K</Kbd>}>Open the palette</Button>
          <Button variant="ghost" onPress={() => setHelp(true)} iconEnd={<Kbd>?</Kbd>}>Shortcuts</Button>
        </div>
        <p className="tf-muted" style={{ margin: 0, fontSize: 13 }}>Type to filter (try “book” or “acme”), arrows move the highlight, Enter opens. Type ? in an empty search for the shortcut sheet.</p>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>Last opened: <span className="tf-muted">{last}</span></p>
      </div>
      <CommandPalette isOpen={open} onOpenChange={setOpen} items={TIMEFIX_COMMANDS} onAction={(id) => setLast(label(id))} onShowShortcuts={showHelp} />
      <ShortcutHelp isOpen={help} onOpenChange={setHelp} />
    </div>
  );
}
