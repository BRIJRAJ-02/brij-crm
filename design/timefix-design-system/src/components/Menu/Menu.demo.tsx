import { useState } from 'react';
import type { Key, Selection } from 'react-aria-components';
import { MoreHorizontal, Pencil, Copy, Link2, FolderInput, Route, Trash2, ChevronDown, ArrowUp, ArrowDown, Layers, EyeOff, Mail, UserPlus } from 'lucide-react';
import { MenuTrigger, SubmenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator, ContextMenu } from './Menu.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const projects = ['Sales', 'Onboarding', 'Hiring', 'Partners', 'Renewals'];
const teams = ['Growth', 'Support'];
const people = [
  { name: 'Priya Raman', sub: 'Acme Corp · Discovery call' },
  { name: 'Sam Kim', sub: 'Northwind · Demo 45 min' },
  { name: 'Jo Mendes', sub: 'Globex · Discovery call' },
];

export function MenuDemo() {
  const [last, setLast] = useState('Nothing yet');
  const [sort, setSort] = useState<Selection>(new Set(['newest']));
  const [show, setShow] = useState<Selection>(new Set(['upcoming']));
  const [folder, setFolder] = useState<Selection>(new Set(['Sales']));
  const act = (k: Key) => setLast(String(k));
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-32)' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Row actions, column header</p>
        <div className="tf-row">
          <MenuTrigger>
            <IconButton label="Actions for Discovery call" variant="secondary"><MoreHorizontal {...i} /></IconButton>
            <Menu aria-label="Actions for Discovery call" onAction={act}>
              <MenuItem id="edit" icon={<Pencil {...i} />} kbd="E">Edit</MenuItem>
              <MenuItem id="duplicate" icon={<Copy {...i} />} kbd="⌘D">Duplicate</MenuItem>
              <MenuItem id="copy" icon={<Link2 {...i} />} kbd="⌘C">Copy link</MenuItem>
              <SubmenuTrigger>
                <MenuItem icon={<FolderInput {...i} />}>Move to</MenuItem>
                <Menu aria-label="Move to" filterPlaceholder="Move to…" selectionMode="single" selectedKeys={folder} onSelectionChange={(s) => { setFolder(s); setLast(`moved to ${[...s].join('')}`); }}>
                  <MenuSection title="Projects">{projects.map((p) => <MenuItem key={p} id={p}>{p}</MenuItem>)}</MenuSection>
                  <MenuSection title="Teams">{teams.map((p) => <MenuItem key={p} id={p}>{p}</MenuItem>)}</MenuSection>
                </Menu>
              </SubmenuTrigger>
              <MenuSeparator />
              <MenuSection title="Sort by" selectionMode="single" selectedKeys={sort} onSelectionChange={setSort}>
                <MenuItem id="newest">Newest first</MenuItem>
                <MenuItem id="oldest">Oldest first</MenuItem>
                <MenuItem id="name">Guest name</MenuItem>
              </MenuSection>
              <MenuSection title="Show" selectionMode="multiple" selectedKeys={show} onSelectionChange={setShow}>
                <MenuItem id="upcoming">Upcoming</MenuItem>
                <MenuItem id="cancelled">Cancelled</MenuItem>
              </MenuSection>
              <MenuSeparator />
              <MenuItem id="routing" icon={<Route {...i} />} badge={<Tag size="sm" hue="purple">Pro</Tag>} description="Send guests to the right host">Add routing</MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon={<Trash2 {...i} />} kbd="⌘⌫" isDanger>Delete</MenuItem>
            </Menu>
          </MenuTrigger>
          <MenuTrigger>
            <Button size="sm" variant="ghost" iconEnd={<ChevronDown size={14} strokeWidth={1.75} />}>Stage</Button>
            <Menu aria-label="Stage column" onAction={act}>
              <MenuItem id="edit-field" icon={<Pencil {...i} />}>Edit field</MenuItem>
              <MenuSeparator />
              <MenuItem id="asc" icon={<ArrowUp {...i} />}>Sort ascending</MenuItem>
              <MenuItem id="desc" icon={<ArrowDown {...i} />}>Sort descending</MenuItem>
              <MenuItem id="group" icon={<Layers {...i} />}>Group by Stage</MenuItem>
              <MenuItem id="hide" icon={<EyeOff {...i} />}>Hide column</MenuItem>
              <MenuSeparator />
              <MenuItem id="dup-field" icon={<Copy {...i} />}>Duplicate</MenuItem>
              <MenuItem id="delete-field" icon={<Trash2 {...i} />} isDanger>Delete field</MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
        <span className="tf-faint" style={{ fontSize: 13 }}>Last: <span className="tf-muted">{last}</span></span>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-2)' }}>
        <p className="tf-demo-label">Context menu: right-click a row (or Shift+F10)</p>
        {people.map((p) => (
          <ContextMenu key={p.name} label={`Actions for ${p.name}`} onAction={(k) => setLast(`${String(k)} · ${p.name}`)} items={<>
            <MenuItem id="email" icon={<Mail {...i} />} kbd="M">Send email</MenuItem>
            <MenuItem id="assign" icon={<UserPlus {...i} />} kbd="A">Assign owner</MenuItem>
            <MenuItem id="copy" icon={<Link2 {...i} />}>Copy link</MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i} />} isDanger>Delete record</MenuItem>
          </>}>
            <div tabIndex={0} style={{ padding: 'var(--space-8)', borderRadius: 'var(--radius-md)', outlineOffset: -2 }}>
              <PersonLine name={p.name} sub={p.sub} />
            </div>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}
