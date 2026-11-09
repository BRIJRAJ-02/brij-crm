// Pages: booking pages as rows (picture, name, length · place, who hosts, On/Hidden, Share, ⋯), Mine / Team.
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, FileText, Link2, Plus } from 'lucide-react';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { PlaceIcon } from '../MeetingList/MeetingList.tsx';
import { cx } from '../../lib/cx.ts';
import { OnSwitch, PageMoreMenu, PagePicture, ShareMenu, TabToolbar, i14, type ShareHow } from './parts.tsx';
import { HOST, PLACES, noHostsFree, pageSub, placeOf, type BookingPage, type BookingsState } from './state.ts';

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
        action={<Button variant="primary" icon={<Plus {...i14} />} onPress={onCreate}>New page</Button>} />
      {pages.length === 0 ? <p className="tf-bkf__muted">No team pages yet. Make one from a page's Who section.</p> : (
        <ul className="tf-bkf__pages" aria-label="Booking pages">
          {pages.map((p) => {
            const stuck = noHostsFree(state, p, now);
            return (
              <li key={p.id} className={cx('tf-bkf__pagerow', p.id === fresh && 'is-new', leaving.has(p.id) && 'is-leaving', !p.isOn && 'is-hidden')}>
                <div className="tf-bkf__pagerow-clip">
                  <div className="tf-bkf__pagerow-inner">
                    <AriaButton className="tf-bkf__pagerow-open" onPress={() => onOpen(p.id)} aria-label={`Edit ${p.name}`}>
                      <PagePicture page={p} state={state} />
                      <span className="tf-bkf__pagerow-text">
                        <span className="tf-bkf__pagerow-name">{p.name}{p.whoCanBook === 'form' && <Tag size="sm" hue="gray" icon={<FileText size={12} strokeWidth={2} />}>Through a form</Tag>}{p.confirmFirst && <Tag size="sm" hue="gray">Confirm first</Tag>}</span>
                        <span className="tf-bkf__pagerow-sub tf-num"><PlaceIcon place={PLACES[placeOf(p)].meeting} />{pageSub(p)}</span>
                      </span>
                    </AriaButton>
                    <Tooltip label={p.hosts.join(', ')}>
                      <AriaButton className="tf-bkf__hosts" aria-label={`Hosts: ${p.hosts.join(', ')}`} onPress={() => onFix(p.id)}>
                        <AvatarGroup names={p.hosts} size={20} max={3} /><span>{hostWords(p)}</span>
                      </AriaButton>
                    </Tooltip>
                    <OnSwitch page={p} onChange={(on) => onToggle(p.id, on)} />
                    <ShareMenu page={p} onShare={onShare} />
                    <PageMoreMenu page={p} onAction={(k) => onMore(p, k)} />
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
