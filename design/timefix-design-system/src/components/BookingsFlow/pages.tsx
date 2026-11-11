// Pages: booking pages as rows (picture, name, length · place, who hosts, On/Hidden, Share, ⋯), Mine / Team.
import { copyText } from '../../lib/copy.ts';
import { Link } from '../Link/Link.tsx';
import { useState } from 'react';
import type { EditorSection } from './editor.tsx';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, Building2, Copy, FileText, Link2, ListFilter, Lock, Mail, Pencil, Plus, Users } from 'lucide-react';
import { SearchField } from '../SearchField/SearchField.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import type { Key } from 'react-aria-components';
import { MenuTrigger, Menu, MenuItem, MenuSection } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { PlaceIcon } from '../MeetingList/MeetingList.tsx';
import { cx } from '../../lib/cx.ts';
import { OnSwitch, PageMoreMenu, PagePicture, ShareMenu, TabToolbar, i14, i16, type ShareHow } from './parts.tsx';
import { HOST, PLACES, noHostsFree, openDaysAhead, pageSub, placeOf, type BookingPage, type BookingsAction, type BookingsState } from './state.ts';
import { BusinessPages } from './pages-business.tsx';

/** Props for PagesTab. */
export interface PagesTabProps {
  readonly state: BookingsState;
  readonly fresh: string | undefined;
  readonly leaving: ReadonlySet<string>;
  readonly onOpen: (id: string) => void;
  readonly onFix: (id: string, section?: EditorSection) => void;
  readonly onToggle: (id: string, on: boolean) => void;
  readonly onShare: (p: BookingPage, how: ShareHow) => void;
  readonly onMore: (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => void;
  /** New page: a service for a business, otherwise a meeting page. */
  readonly onCreate: (kind?: 'service' | 'meeting') => void;
  /** A business: saves its page, and opens it as a guest. */
  readonly dispatch?: (a: BookingsAction) => void;
  readonly onSeePage?: () => void;
  /** A restaurant's menu link: see it as a guest, or edit it. */
  readonly onSeeMenu?: () => void;
  readonly onEditMenu?: () => void;
  /** Opens the workspace link's editor, or makes a team link for a round robin group and opens it (made the first time). */
  readonly onTeamLink?: (which: { readonly kind: 'workspace' } | { readonly kind: 'team'; readonly groupId: string }) => void;
}

const hostWords = (p: BookingPage) => (p.linkKind === 'workspace' ? 'Workspace link' : p.linkKind === 'team' ? 'Team link' : p.hostMode === 'roundrobin' ? 'Round robin' : p.hostMode === 'collective' ? 'Everyone free' : p.hostMode === 'managed' ? 'A copy each' : p.hosts[0] === HOST ? 'You' : p.hosts[0] ?? '');

/** The Pages tab. */
export function PagesTab({ state, fresh, leaving, onOpen, onFix, onToggle, onShare, onMore, onCreate, dispatch, onSeePage, onSeeMenu, onEditMenu, onTeamLink }: PagesTabProps) {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [find, setFind] = useState('');
  const [newTeamLink, setNewTeamLink] = useState<string>();
  const { toast } = useToast();
  const slug = state.workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // One link for the whole workspace or a team: guests pick a page from those it lists.
  const workspaceUrl = `timefix.com/${slug}`;
  const hasWorkspaceLink = state.pages.some((p) => p.linkKind === 'workspace');
  const freeGroups = state.groups.filter((g) => !state.pages.some((p) => p.linkKind === 'team' && p.groupId === g.id));
  const now = new Date();
  // A business sees its own page first, then its services as a menu.
  if (state.business && dispatch && onSeePage) return <BusinessPages state={state} dispatch={dispatch} fresh={fresh} onOpen={onOpen} onToggle={onToggle} onShare={onShare} onMore={onMore} onCreate={onCreate} onSeePage={onSeePage} onSeeMenu={onSeeMenu} onEditMenu={onEditMenu} />;
  if (state.pages.length === 0) {
    return <EmptyState icon={<Link2 size={20} strokeWidth={1.75} />} title="No booking pages yet" description="A booking page lets people pick a time with you. It takes a minute."
      action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => onCreate()}>Create booking page</Button>} />;
  }
  const q = find.trim().toLowerCase();
  // Workspace and team links sit with the team's pages; search reads names and links.
  const pages = state.pages.filter((p) => (scope === 'mine' ? !p.linkKind && (p.owner === HOST || p.hosts.includes(HOST)) : p.linkKind !== undefined || p.owner !== HOST || p.hosts.length > 1))
    .filter((p) => !q || `${p.name} ${p.slug}`.toLowerCase().includes(q));
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<><SegmentedControl aria-label="Whose pages" selectedKey={scope} onSelectionChange={(k) => setScope(k === 'team' ? 'team' : 'mine')} items={[{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }]} />
          <SearchField label="Search booking pages" placeholder="Search booking pages" size="sm" value={find} onChange={setFind} className="tf-bkf-pagesearch" /></>}
        count={`${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}
        action={<span className="tf-row">
          <MenuTrigger>
            <Button variant="secondary" icon={<Users {...i14} />}>Team links</Button>
            <Menu aria-label="Team links" placement="bottom end" onAction={(k: Key) => {
              if (k === 'copy') { void copyText(`https://${workspaceUrl}`).then((ok) => toast(ok ? { message: 'Workspace link copied.', tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: https://${workspaceUrl}`, tone: 'danger' })); }
              else if (k === 'edit') onTeamLink?.({ kind: 'workspace' });
              else if (k === 'new-team') setNewTeamLink(freeGroups[0]?.id ?? '');
              else { const p = state.pages.find((x) => x.id === k); if (p) onOpen(p.id); }
            }}>
              <MenuSection title="Workspace link">
                <MenuItem id="copy" icon={<Copy {...i16} />} description="Books whoever in the workspace is free.">Copy workspace link</MenuItem>
                <MenuItem id="edit" icon={hasWorkspaceLink ? <Pencil {...i16} /> : <Building2 {...i16} />} description="Its hours, hosts and limits.">{hasWorkspaceLink ? 'Edit workspace link' : 'New workspace link'}</MenuItem>
              </MenuSection>
              <MenuSection title="Team link">
                {state.pages.filter((p) => p.linkKind === 'team').map((p) => <MenuItem key={p.id} id={p.id} icon={<Users {...i16} />} description={`timefix.com/${slug}/${p.slug}`}>{p.name}</MenuItem>)}
                <MenuItem id="new-team" icon={<Plus {...i16} />} isDisabled={freeGroups.length === 0} description={freeGroups.length ? 'One link for a round robin group: whoever in it is free takes it.' : 'Every group has its link.'}>New team link</MenuItem>
              </MenuSection>
            </Menu>
          </MenuTrigger>
          <Button variant="primary" icon={<Plus {...i14} />} onPress={() => onCreate()}>New page</Button>
        </span>} />
      {pages.length === 0 ? (q ? <EmptyState size="sm" icon={<ListFilter size={20} strokeWidth={1.75} />} title={`No page matches “${find.trim()}”`} action={<Button size="sm" onPress={() => setFind('')}>Clear search</Button>} /> : <p className="tf-bkf__muted">No team pages yet. Make one from a page's Who section.</p>) : (
        <ul className="tf-bkf__pages" aria-label="Booking pages">
          {pages.map((p) => {
            const stuck = noHostsFree(state, p, now);
            const noTimes = p.isOn && !stuck && openDaysAhead(p, state, now) === 0;
            const edited = state.drafts?.[p.id] !== undefined;
            return (
              <li key={p.id} className={cx('tf-bkf__pagerow', p.id === fresh && 'is-new', leaving.has(p.id) && 'is-leaving', !p.isOn && 'is-hidden')}>
                <div className="tf-bkf__pagerow-clip">
                  <div className="tf-bkf__pagerow-inner">
                    <AriaButton className="tf-bkf__pagerow-open" onPress={() => onOpen(p.id)} aria-label={`Edit ${p.name}`}>
                      <PagePicture page={p} state={state} />
                      <span className="tf-bkf__pagerow-text">
                        <span className="tf-bkf__pagerow-name">{p.name}{p.whoCanBook === 'form' && <Tag size="sm" hue="gray" icon={<FileText size={12} strokeWidth={2} />}>Through a form</Tag>}{p.confirmFirst && <Tag size="sm" hue="gray">Confirm first</Tag>}{p.visibility === 'link' && <Tag size="sm" hue="gray" icon={<Lock size={12} strokeWidth={2} />}>Link only</Tag>}{p.inviteOnly && <Tag size="sm" hue="gray" icon={<Mail size={12} strokeWidth={2} />}>By invitation</Tag>}{p.linkKind && <Tag size="sm" hue="blue">{p.linkKind === 'workspace' ? 'Workspace link' : 'Team link'}</Tag>}{edited && <Tag size="sm" hue="orange">Unpublished changes</Tag>}</span>
                        <span className="tf-bkf__pagerow-sub tf-num"><PlaceIcon place={PLACES[placeOf(p)].meeting} />{pageSub(p)}</span>
                      </span>
                    </AriaButton>
                    {/* Hosts only when someone else is involved: "You" on every row of Mine said nothing. */}
                    {p.hosts.length > 1 || p.hosts[0] !== HOST ? (
                      <Tooltip label={p.hosts.join(', ')}>
                        <AriaButton className="tf-bkf__hosts" aria-label={`Hosts: ${p.hosts.join(', ')}`} onPress={() => onFix(p.id)}>
                          <AvatarGroup names={p.hosts} size={20} max={3} /><span>{hostWords(p)}</span>
                        </AriaButton>
                      </Tooltip>
                    ) : <span aria-hidden="true" />}
                    <OnSwitch page={p} onChange={(on) => onToggle(p.id, on)} />
                    <ShareMenu page={p} onShare={onShare} />
                    <PageMoreMenu page={p} onAction={(k) => { if (k !== 'versions') onMore(p, k); }} />
                    {noTimes && (
                      <p className="tf-bkf__pagerow-warn" role="status">
                        <AlertTriangle {...i14} aria-hidden="true" /><span>Guests can’t book: no open times in the next two months</span><span aria-hidden="true">·</span>
                        <Link onPress={() => onFix(p.id, 'when')} weight="strong" label={`Check times for ${p.name}`}>Check</Link>
                      </p>
                    )}
                    {stuck && (
                      <p className="tf-bkf__pagerow-warn" role="status">
                        <AlertTriangle {...i14} aria-hidden="true" /><span>Guests can't book: no hosts available</span><span aria-hidden="true">·</span>
                        <Link onPress={() => onFix(p.id)} weight="strong" label={`Fix hosts for ${p.name}`}>Fix</Link>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog isOpen={newTeamLink !== undefined} onOpenChange={(o) => { if (!o) setNewTeamLink(undefined); }} size="md" title="New team link" description="One link for a round robin group. Whoever in it is free, next by the group’s rules, takes the booking."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!newTeamLink} onPress={() => { const g = newTeamLink; setNewTeamLink(undefined); if (g) onTeamLink?.({ kind: 'team', groupId: g }); }}>Make team link</Button></>}>
        <RadioGroup label="For" value={newTeamLink ?? ''} onChange={setNewTeamLink}>
          {freeGroups.map((g) => <Radio key={g.id} value={g.id}>{g.name}<span className="tf-bkf__muted"> · {g.members.length} people · timefix.com/{slug}/{g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</span></Radio>)}
        </RadioGroup>
      </Dialog>
    </div>
  );
}
