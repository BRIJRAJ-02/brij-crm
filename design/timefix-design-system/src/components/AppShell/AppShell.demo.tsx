import { useCallback, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Building2, Table2, Columns3, ListFilter, ArrowUpDown, Plus, Share2, MoreHorizontal, X, Globe, Users, CalendarDays } from 'lucide-react';
import { AppShell, TopBar, Toolbar, AsideLayout, TOOLBAR_SEARCH } from './AppShell.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { TimefixSidebar } from '../Sidebar/Sidebar.demo.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Pagination } from '../Pagination/Pagination.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { CommandPalette, useCommandK } from '../CommandPalette/CommandPalette.tsx';
import { TIMEFIX_COMMANDS } from '../CommandPalette/CommandPalette.demo.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag, Count } from '../Tag/Tag.tsx';
import { Avatar, AvatarGroup, PersonLine } from '../Avatar/Avatar.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const s = { size: 14, strokeWidth: 1.75 } as const;
type Company = { readonly name: string; readonly domain: string; readonly stage: string; readonly status: StatusShape; readonly owner: string; readonly people: number };
const COMPANIES: ReadonlyArray<Company> = [
  { name: 'Acme Corp', domain: 'acme.com', stage: 'Qualified', status: 'review', owner: 'Priya Raman', people: 14 },
  { name: 'Northwind', domain: 'northwind.com', stage: 'Demo booked', status: 'progress', owner: 'Sam Kim', people: 6 },
  { name: 'Globex', domain: 'globex.io', stage: 'Won', status: 'done', owner: 'Jo Mendes', people: 22 },
  { name: 'Initech', domain: 'initech.co', stage: 'Lead', status: 'draft', owner: 'Ava Chen', people: 3 },
  { name: 'Umbrella Health', domain: 'umbrella.health', stage: 'Lost', status: 'failed', owner: 'Maria Bell', people: 9 },
  { name: 'Stark Studio', domain: 'stark.studio', stage: 'Waiting on legal', status: 'waiting', owner: 'Priya Raman', people: 5 },
  { name: 'Wayne Logistics', domain: 'waynelog.com', stage: 'Qualified', status: 'review', owner: 'Sam Kim', people: 31 },
];

export function AppShellDemo() {
  const [page, setPage] = useState('companies');
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [view, setView] = useState('table');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Company | undefined>(undefined);
  const [p, setP] = useState(1);
  useCommandK(useCallback(() => setPalette(true), []));
  const rows = COMPANIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="tf-demo tf-demo--canvas" style={{ height: 680, padding: 0 }}>
      <AppShell sidebar={<TimefixSidebar current={page} onNavigate={setPage} unread={2} isCollapsed={collapsed} onCollapsedChange={setCollapsed} onSearch={() => setPalette(true)} />}>
        <TopBar
          title={<Breadcrumbs size="title" items={open ? [{ id: 'companies', label: 'Companies', icon: <Building2 {...i} /> }, { id: 'rec', label: open.name }] : [{ id: 'companies', label: 'Companies', icon: <Building2 {...i} /> }]} onAction={() => setOpen(undefined)} />}
          actions={<>
            <AvatarGroup names={['Priya Raman', 'Sam Kim', 'Jo Mendes']} size={28} />
            <Button size="sm" variant="secondary" icon={<Share2 {...s} />}>Share</Button>
            <IconButton size="sm" label="More"><MoreHorizontal {...i} /></IconButton>
          </>}
        />
        <Toolbar
          start={<>
            <SegmentedControl aria-label="View" size="sm" selectedKey={view} onSelectionChange={setView} items={[{ id: 'table', label: 'Table', icon: <Table2 {...s} /> }, { id: 'board', label: 'Board', icon: <Columns3 {...s} /> }]} />
            <span className="tf-shell-demo__gap" />
            <Button size="sm" variant="ghost" icon={<ListFilter {...s} />}>Filter</Button>
            <Button size="sm" variant="ghost" icon={<ArrowUpDown {...s} />}>Sort</Button>
          </>}
          end={<>
            <SearchField size="sm" className={TOOLBAR_SEARCH} label="Search companies" value={q} onChange={setQ} placeholder="Search companies" />
            <Button size="sm" variant="primary" icon={<Plus {...s} />}>New company</Button>
          </>}
        />
        <AsideLayout isAsideOpen={open !== undefined} asideLabel={open ? `${open.name} preview` : 'Preview'} aside={open && (
          <div className="tf-shell-demo__preview">
            <div className="tf-row" style={{ justifyContent: 'space-between' }}>
              <PersonLine name={open.name} sub={open.domain} shape="square" size={44} />
              <IconButton size="sm" label="Close the preview" onPress={() => setOpen(undefined)}><X {...i} /></IconButton>
            </div>
            <Tabs aria-label={open.name} items={[{ id: 'about', label: 'About' }, { id: 'people', label: 'People', count: open.people }, { id: 'meetings', label: 'Meetings', count: 3 }]}>
              <TabPanel id="about">
                <dl className="tf-shell-demo__facts">
                  <dt><Globe {...s} />Domain</dt><dd>{open.domain}</dd>
                  <dt><Users {...s} />Owner</dt><dd><Avatar name={open.owner} size={20} /> {open.owner}</dd>
                  <dt><CalendarDays {...s} />Stage</dt><dd><Tag size="sm" status={open.status}>{open.stage}</Tag></dd>
                </dl>
              </TabPanel>
              <TabPanel id="people"><span className="tf-muted">{open.people} people at {open.name}.</span></TabPanel>
              <TabPanel id="meetings"><span className="tf-muted">Discovery call 30 min, Demo 45 min and a follow-up.</span></TabPanel>
            </Tabs>
          </div>
        )}>
          <div className="tf-shell-demo__table" role="list" aria-label="Companies">
            <div className="tf-shell-demo__row tf-shell-demo__row--head" aria-hidden="true"><span>Company</span><span>Stage</span><span>Owner</span><span>People</span></div>
            {rows.map((c) => (
              <AriaButton key={c.name} className="tf-shell-demo__row" data-current={open?.name === c.name || undefined} onPress={() => setOpen(c)} aria-label={`Open ${c.name}`}>
                <PersonLine name={c.name} sub={c.domain} shape="square" />
                <span><Tag size="sm" status={c.status}>{c.stage}</Tag></span>
                <span className="tf-row" style={{ gap: 'var(--space-8)' }}><Avatar name={c.owner} size={20} />{c.owner}</span>
                <span><Count>{c.people}</Count></span>
              </AriaButton>
            ))}
            {rows.length === 0 && <p className="tf-muted" style={{ padding: 'var(--space-24)', margin: 0 }}>No companies match “{q}”.</p>}
          </div>
          <div className="tf-shell-demo__foot"><Pagination page={p} pageSize={50} total={q ? rows.length : 1284} noun="companies" onPageChange={setP} /></div>
        </AsideLayout>
      </AppShell>
      <CommandPalette isOpen={palette} onOpenChange={setPalette} items={TIMEFIX_COMMANDS} onAction={() => undefined} />
    </div>
  );
}
