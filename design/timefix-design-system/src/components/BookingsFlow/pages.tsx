// Pages: booking pages as rows (picture, name, length · place, who hosts, On/Hidden, Share, ⋯), Mine / Team.
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, Building2, FileText, Link2, Lock, Plus, Users } from 'lucide-react';
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
import { HOST, PLACES, noHostsFree, openDaysAhead, pageSub, placeOf, type BookingPage, type BookingsState } from './state.ts';

/** Props for PagesTab. */
export interface PagesTabProps {
  readonly state: BookingsState;
  readonly fresh: string | undefined;
  readonly leaving: ReadonlySet<string>;
  readonly onOpen: (id: string) => void;
  readonly onFix: (id: string) => void;
  readonly onToggle: (id: string, on: boolean) => void;
  readonly onShare: (p: BookingPage, how: ShareHow) => void;
  readonly onMore: (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => void;
  readonly onCreate: () => void;
}

const hostWords = (p: BookingPage) => (p.hostMode === 'roundrobin' ? 'Round robin' : p.hostMode === 'collective' ? 'Everyone free' : p.hostMode === 'managed' ? 'A copy each' : p.hosts[0] === HOST ? 'You' : p.hosts[0] ?? '');

/** The Pages tab. */
export function PagesTab({ state, fresh, leaving, onOpen, onFix, onToggle, onShare, onMore, onCreate }: PagesTabProps) {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const { toast } = useToast();
  const slug = state.workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // One link for the whole workspace or a team: guests pick a page from those it lists.
  const teamLinks = [{ id: 'workspace', label: 'Whole workspace', url: `timefix.com/${slug}`, count: state.pages.filter((p) => p.isOn && p.visibility !== 'link').length },
    ...state.groups.map((g) => ({ id: g.id, label: g.name, url: `timefix.com/${slug}/${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, count: state.pages.filter((p) => p.isOn && p.groupId === g.id).length }))];
  const now = new Date();
  if (state.pages.length === 0) {
    return <EmptyState icon={<Link2 size={20} strokeWidth={1.75} />} title="No booking pages yet" description="A booking page lets people pick a time with you. It takes a minute."
      action={<Button variant="primary" icon={<Plus {...i14} />} onPress={onCreate}>Create booking page</Button>} />;
  }
  const pages = state.pages.filter((p) => (scope === 'mine' ? p.owner === HOST || p.hosts.includes(HOST) : p.owner !== HOST || p.hosts.length > 1));
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<SegmentedControl aria-label="Whose pages" selectedKey={scope} onSelectionChange={(k) => setScope(k === 'team' ? 'team' : 'mine')} items={[{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }]} />}
        count={`${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}
        action={<span className="tf-row">
          <MenuTrigger>
            <Button variant="secondary" icon={<Users {...i14} />}>Team links</Button>
            <Menu aria-label="Team links" placement="bottom end" onAction={(k: Key) => {
              const t = teamLinks.find((x) => x.id === k);
              if (t) { void navigator.clipboard?.writeText(`https://${t.url}`).catch(() => undefined); toast({ message: `${t.label} link copied`, tone: 'success' }); }
            }}>
              <MenuSection title="Copy one link for">
                {teamLinks.map((t) => <MenuItem key={t.id} id={t.id} icon={t.id === 'workspace' ? <Building2 {...i16} /> : <Users {...i16} />} description={`${t.url} · ${t.count} ${t.count === 1 ? 'page' : 'pages'}`}>{t.label}</MenuItem>)}
              </MenuSection>
            </Menu>
          </MenuTrigger>
          <Button variant="primary" icon={<Plus {...i14} />} onPress={onCreate}>New page</Button>
        </span>} />
      {pages.length === 0 ? <p className="tf-bkf__muted">No team pages yet. Make one from a page's Who section.</p> : (
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
                        <span className="tf-bkf__pagerow-name">{p.name}{p.whoCanBook === 'form' && <Tag size="sm" hue="gray" icon={<FileText size={12} strokeWidth={2} />}>Through a form</Tag>}{p.confirmFirst && <Tag size="sm" hue="gray">Confirm first</Tag>}{p.visibility === 'link' && <Tag size="sm" hue="gray" icon={<Lock size={12} strokeWidth={2} />}>Link only</Tag>}{edited && <Tag size="sm" hue="orange">Draft changes</Tag>}</span>
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
                    <PageMoreMenu page={p} onAction={(k) => onMore(p, k)} />
                    {noTimes && (
                      <p className="tf-bkf__pagerow-warn" role="status">
                        <AlertTriangle {...i14} aria-hidden="true" /><span>Guests can’t book: no open times in the next two months</span><span aria-hidden="true">·</span>
                        <AriaButton className="tf-bkf__textbtn" onPress={() => onOpen(p.id)} aria-label={`Check times for ${p.name}`}>Check</AriaButton>
                      </p>
                    )}
                    {stuck && (
                      <p className="tf-bkf__pagerow-warn" role="status">
                        <AlertTriangle {...i14} aria-hidden="true" /><span>Guests can't book: no hosts available</span><span aria-hidden="true">·</span>
                        <AriaButton className="tf-bkf__textbtn" onPress={() => onFix(p.id)} aria-label={`Fix hosts for ${p.name}`}>Fix</AriaButton>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
