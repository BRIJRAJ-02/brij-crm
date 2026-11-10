import { useId, useState, type ReactNode } from 'react';
import { MoreHorizontal, Send, UserCog, Copy, UserMinus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { Tag, Count } from '../Tag/Tag.tsx';
import { Select, type SelectOption } from '../Select/Select.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { MenuTrigger, SubmenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { NoResults } from '../EmptyState/EmptyState.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import { ROLE_OPTIONS } from '../InviteRows/InviteRows.tsx';
import './TeamList.css';

/** One member of the workspace, or someone invited who has not joined yet. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly status: 'active' | 'invited';
  /** When they last used Timefix (active) or when the invite went out (invited). */
  readonly seen?: Date;
  /** The person looking: their own role and Remove are locked. */
  readonly isYou?: boolean;
}

/** "Just now", "12m ago", "3h ago", "Yesterday", "4d ago", then the date. */
export function relativeTime(d: Date, now: Date): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(d);
}

/** Props for TeamList. */
export interface TeamListProps {
  readonly members: ReadonlyArray<Member>;
  /** The clock "ago" reads against. */
  readonly now: Date;
  /** The workspace's name, used in the remove question. */
  readonly workspace: string;
  readonly roles?: ReadonlyArray<SelectOption>;
  readonly onRoleChange?: (id: string, role: string) => void;
  readonly onResend?: (id: string) => void;
  /** Runs after the person confirms and the row has collapsed. */
  readonly onRemove?: (id: string) => void;
  readonly onCopyEmail?: (email: string) => void;
  /** The header's action: an Invite people button. */
  readonly action?: ReactNode;
  /** Admins and owners manage; others see the list read only. */
  readonly canManage?: boolean;
  /** Asks about removing an active member itself (to hand their records to someone); the list's own question is skipped. Invites still ask here. */
  readonly onRemoveRequest?: (id: string) => void;
}

/** The workspace's people: who they are, their role, whether they joined, when they were last in, and a row menu to resend, change role or remove (which asks first). */
export function TeamList({ members, now, workspace, roles = ROLE_OPTIONS, onRoleChange, onResend, onRemove, onCopyEmail, action, canManage = true, onRemoveRequest }: TeamListProps) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Member | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [washed, setWashed] = useState<ReadonlySet<string>>(new Set());

  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => q === '' || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  const roleName = (id: string) => roles.find((r) => r.id === id)?.label ?? id;
  const wash = (id: string) => {
    setWashed((s) => new Set(s).add(id));
    window.setTimeout(() => setWashed((s) => { const n = new Set(s); n.delete(id); return n; }), 1000);
  };
  const changeRole = (m: Member, role: string) => {
    if (role === m.role) return;
    onRoleChange?.(m.id, role);
    wash(m.id);
  };
  const resend = (m: Member) => {
    onResend?.(m.id);
    wash(m.id);
    setSent((s) => new Set(s).add(m.id));
    window.setTimeout(() => setSent((s) => { const n = new Set(s); n.delete(m.id); return n; }), 2500);
  };
  const remove = (m: Member) => {
    setLeaving((s) => new Set(s).add(m.id));
    window.setTimeout(() => {
      onRemove?.(m.id);
      setLeaving((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }, 250);
  };

  return (
    <section className="tf-team" aria-labelledby={titleId}>
      <header className="tf-team__head">
        <h3 id={titleId} className="tf-team__title">Members <Count>{members.length}</Count></h3>
        <SearchField size="sm" label="Search members" placeholder="Search by name or email" value={query} onChange={setQuery} className="tf-team__search" />
        {action}
      </header>
      {shown.length === 0 ? (
        <NoResults query={query} noun="members" size="sm" onClearFilters={() => setQuery('')} />
      ) : (
        <ul className="tf-team__list">
          {shown.map((m) => {
            const locked = !canManage || m.isYou === true || m.role === 'owner';
            const seen = m.seen ? relativeTime(m.seen, now) : '—';
            const when = sent.has(m.id) ? 'Invite sent' : m.status === 'invited' ? `Invited ${seen.toLowerCase()}` : seen;
            return (
              <li key={m.id} className={cx('tf-team__row', leaving.has(m.id) && 'tf-team__row--leaving', washed.has(m.id) && 'tf-team__row--washed')}>
                <div className="tf-team__clip">
                  <div className="tf-team__line">
                    <span className="tf-team__person"><PersonLine name={m.name} sub={m.isYou ? `${m.email} · You` : m.name === m.email ? undefined : m.email} /></span>
                    <span className="tf-team__role">
                      <Select label={`Role for ${m.name}`} isLabelHidden items={roles} value={m.role} isDisabled={locked} onChange={(v) => { if (v) changeRole(m, v); }} />
                    </span>
                    <span className="tf-team__status">
                      {m.status === 'active' ? <Tag status="done" size="sm">Active</Tag> : <Tag status="waiting" size="sm">Invited</Tag>}
                    </span>
                    <span className="tf-team__seen tf-num"><TextSwap swapKey={when}>{when}</TextSwap></span>
                    <span className="tf-team__menu">
                      {canManage && !m.isYou && (
                        <MenuTrigger>
                          <IconButton label={`Actions for ${m.name}`} size="sm"><MoreHorizontal size={16} strokeWidth={1.75} /></IconButton>
                          <Menu aria-label={`Actions for ${m.name}`} placement="bottom end" onAction={(k) => {
                            if (k === 'resend') resend(m);
                            else if (k === 'copy') onCopyEmail?.(m.email);
                            else if (k === 'remove') { if (onRemoveRequest && m.status === 'active') onRemoveRequest(m.id); else { setConfirm(m); setAsking(true); } }
                          }}>
                            {m.status === 'invited' && <MenuItem id="resend" icon={<Send size={16} strokeWidth={1.75} />}>Resend invite</MenuItem>}
                            {m.role !== 'owner' && (
                              <SubmenuTrigger>
                                <MenuItem id="role" icon={<UserCog size={16} strokeWidth={1.75} />} description={roleName(m.role)}>Change role</MenuItem>
                                <Menu aria-label={`Role for ${m.name}`} selectionMode="single" selectedKeys={new Set([m.role])}
                                  onSelectionChange={(s) => { const v = s === 'all' ? undefined : [...s][0]; if (v !== undefined) changeRole(m, String(v)); }}>
                                  {roles.filter((r) => r.id !== 'owner').map((r) => <MenuItem key={r.id} id={r.id} description={r.description}>{r.label}</MenuItem>)}
                                </Menu>
                              </SubmenuTrigger>
                            )}
                            <MenuItem id="copy" icon={<Copy size={16} strokeWidth={1.75} />}>Copy email</MenuItem>
                            {m.role !== 'owner' && <MenuSeparator />}
                            {m.role !== 'owner' && <MenuItem id="remove" icon={<UserMinus size={16} strokeWidth={1.75} />} isDanger>{m.status === 'invited' ? 'Cancel invite' : 'Remove'}</MenuItem>}
                          </Menu>
                        </MenuTrigger>
                      )}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog isOpen={asking} onOpenChange={setAsking}
        title={confirm?.status === 'invited' ? `Cancel ${confirm.name}'s invite?` : `Remove ${confirm?.name ?? ''} from ${workspace}?`}
        consequence={confirm?.status === 'invited' ? 'The link in their email stops working. You can invite them again later.' : 'They lose access straight away. Their meetings, pages and notes stay with the workspace.'}
        confirmLabel={confirm?.status === 'invited' ? 'Cancel invite' : 'Remove member'} cancelLabel={confirm?.status === 'invited' ? 'Keep invite' : 'Cancel'}
        onConfirm={() => { if (confirm) remove(confirm); }} />
    </section>
  );
}
