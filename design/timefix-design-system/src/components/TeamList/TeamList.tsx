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
import { Checkbox } from '../Checkbox/Checkbox.tsx';
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
  /** The grey line under the name, in place of the email ("Invited by Sam Kim · expires in 6 days", "Works in Sales"). */
  readonly sub?: string;
  /** A few small tags beside the role (two factor, calendar); they leave first when the list is narrow. */
  readonly details?: ReactNode;
  /** The status tag's words and look, in place of Active or Invited ("Invitation expired"). */
  readonly statusTag?: { readonly label: string; readonly status: 'done' | 'waiting' | 'failed' | 'progress' };
  /** This row's role can't be changed by the person looking (an owner, someone still on their way in). */
  readonly isRoleLocked?: boolean;
}

/** An extra row-menu entry ("What Sam can do", "Details"). */
export interface MemberAction { readonly id: string; readonly label: string; readonly icon?: ReactNode }

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
  /** Ticking rows for a bulk change: which can be ticked, what is ticked, and changes to it. A search that hides a ticked row unticks it. */
  readonly canSelect?: (m: Member) => boolean;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** More row-menu entries, before Copy email. */
  readonly actionsFor?: (m: Member) => ReadonlyArray<MemberAction>;
  readonly onAction?: (actionId: string, m: Member) => void;
  /** A line under the list ("4 of 6 members"). */
  readonly footnote?: ReactNode;
}

/** The workspace's people: who they are, their role, whether they joined, when they were last in, and a row menu to resend, change role or remove (which asks first). */
export function TeamList({ members, now, workspace, roles = ROLE_OPTIONS, onRoleChange, onResend, onRemove, onCopyEmail, action, canManage = true, onRemoveRequest, canSelect, selectedIds, onSelectionChange, actionsFor, onAction, footnote }: TeamListProps) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Member | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [washed, setWashed] = useState<ReadonlySet<string>>(new Set());

  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => q === '' || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  const selecting = canSelect !== undefined && onSelectionChange !== undefined && canManage && (members.filter(canSelect).length >= 2 || q !== '' || (selectedIds?.size ?? 0) > 0);
  const search = (v: string) => {
    setQuery(v);
    const k = v.trim().toLowerCase();
    if (selectedIds && selectedIds.size > 0 && onSelectionChange) {
      const still = new Set([...selectedIds].filter((id) => { const m = members.find((x) => x.id === id); return m && (k === '' || m.name.toLowerCase().includes(k) || m.email.toLowerCase().includes(k)); }));
      if (still.size !== selectedIds.size) onSelectionChange(still);
    }
  };
  const tick = (id: string, on: boolean) => { const n = new Set(selectedIds ?? []); if (on) n.add(id); else n.delete(id); onSelectionChange?.(n); };
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
        <SearchField size="sm" label="Search members" placeholder="Search by name or email" value={query} onChange={search} className="tf-team__search" />
        {action}
      </header>
      {shown.length === 0 ? (
        <NoResults query={query} noun="members" size="sm" onClearFilters={() => setQuery('')} />
      ) : (
        <ul className="tf-team__list">
          {shown.map((m) => {
            const locked = !canManage || m.isYou === true || m.role === 'owner' || m.isRoleLocked === true;
            const ticks = selecting && canSelect?.(m) === true;
            const seen = m.seen ? relativeTime(m.seen, now) : '—';
            const when = sent.has(m.id) ? 'Invite sent' : m.status === 'invited' ? `Invited ${seen.toLowerCase()}` : seen;
            return (
              <li key={m.id} className={cx('tf-team__row', leaving.has(m.id) && 'tf-team__row--leaving', washed.has(m.id) && 'tf-team__row--washed')}>
                <div className="tf-team__clip">
                  <div className="tf-team__line">
                    {selecting && <span className="tf-team__check">{ticks && <Checkbox aria-label={`Select ${m.name}`} isSelected={selectedIds?.has(m.id) ?? false} onChange={(on) => tick(m.id, on)} />}</span>}
                    <span className="tf-team__person"><PersonLine name={m.name} sub={m.sub ?? (m.isYou ? `${m.email} · You` : m.name === m.email ? undefined : m.email)} /></span>
                    <span className="tf-team__role">
                      <Select label={`Role for ${m.name}`} isLabelHidden items={roles} value={m.role} isDisabled={locked} onChange={(v) => { if (v) changeRole(m, v); }} />
                    </span>
                    {members.some((x) => x.details !== undefined) && <span className="tf-team__details">{m.details}</span>}
                    <span className="tf-team__status">
                      {m.statusTag ? <Tag status={m.statusTag.status} size="sm">{m.statusTag.label}</Tag> : m.status === 'active' ? <Tag status="done" size="sm">Active</Tag> : <Tag status="waiting" size="sm">Invited</Tag>}
                    </span>
                    <span className="tf-team__seen tf-num"><TextSwap swapKey={when}>{when}</TextSwap></span>
                    <span className="tf-team__menu">
                      {canManage && !m.isYou && (
                        <MenuTrigger>
                          <IconButton label={`Actions for ${m.name}`} size="sm"><MoreHorizontal size={16} strokeWidth={1.75} /></IconButton>
                          <Menu aria-label={`Actions for ${m.name}`} placement="bottom end" onAction={(k) => {
                            if (k === 'resend') resend(m);
                            else if (k === 'copy') onCopyEmail?.(m.email);
                            else if (k !== 'role' && k !== 'remove') onAction?.(String(k), m);
                            else if (k === 'remove') { if (onRemoveRequest && m.status === 'active') onRemoveRequest(m.id); else { setConfirm(m); setAsking(true); } }
                          }}>
                            {m.status === 'invited' && <MenuItem id="resend" icon={<Send size={16} strokeWidth={1.75} />}>Resend invite</MenuItem>}
                            {m.role !== 'owner' && !m.isRoleLocked && (
                              <SubmenuTrigger>
                                <MenuItem id="role" icon={<UserCog size={16} strokeWidth={1.75} />} description={roleName(m.role)}>Change role</MenuItem>
                                <Menu aria-label={`Role for ${m.name}`} selectionMode="single" selectedKeys={new Set([m.role])}
                                  onSelectionChange={(s) => { const v = s === 'all' ? undefined : [...s][0]; if (v !== undefined) changeRole(m, String(v)); }}>
                                  {roles.filter((r) => r.id !== 'owner').map((r) => <MenuItem key={r.id} id={r.id} description={r.description}>{r.label}</MenuItem>)}
                                </Menu>
                              </SubmenuTrigger>
                            )}
                            {(actionsFor?.(m) ?? []).map((x) => <MenuItem key={x.id} id={x.id} icon={x.icon}>{x.label}</MenuItem>)}
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
      {footnote !== undefined && <p className="tf-team__foot tf-num">{footnote}</p>}
      <ConfirmDialog isOpen={asking} onOpenChange={setAsking}
        title={confirm?.status === 'invited' ? `Cancel ${confirm.name}'s invite?` : `Remove ${confirm?.name ?? ''} from ${workspace}?`}
        consequence={confirm?.status === 'invited' ? 'The link in their email stops working. You can invite them again later.' : 'They lose access straight away. Their meetings, pages and notes stay with the workspace.'}
        confirmLabel={confirm?.status === 'invited' ? 'Cancel invite' : 'Remove member'} cancelLabel={confirm?.status === 'invited' ? 'Keep invite' : 'Cancel'}
        onConfirm={() => { if (confirm) remove(confirm); }} />
    </section>
  );
}
