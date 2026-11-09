import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { DisclosureGroup, DisclosureItem } from '../Disclosure/Disclosure.tsx';
import { Dialog, ConfirmDialog, DialogField } from '../Dialog/Dialog.tsx';
import { Select } from '../Select/Select.tsx';
import { Count } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import './RolePowers.css';

/** One thing a role may do ("Delete records"). */
export interface Power { readonly id: string; readonly label: string; readonly description?: string }
/** A group of powers shown as one fold ("Records", "Scheduling"). */
export interface PowerArea { readonly id: string; readonly title: string; readonly description?: string; readonly powers: ReadonlyArray<Power> }
/** A role as a column. `isLocked` (Owner) holds every power and cannot change; `isCustom` roles can be deleted. */
export interface RoleColumn { readonly id: string; readonly name: string; readonly isLocked?: boolean; readonly isCustom?: boolean }
/** Which powers each role holds, by role id. */
export type Grants = Readonly<Record<string, ReadonlyArray<string>>>;

/** Props for RolePowers. */
export interface RolePowersProps {
  readonly areas: ReadonlyArray<PowerArea>;
  readonly roles: ReadonlyArray<RoleColumn>;
  readonly grants: Grants;
  /** A cell was ticked or cleared. */
  readonly onChange?: (roleId: string, powerId: string, isHeld: boolean) => void;
  /** Shows "Custom role": the new role's name and the role whose powers it starts from. */
  readonly onAddRole?: (name: string, fromRoleId: string) => void;
  /** Deletes a custom role, after asking. */
  readonly onDeleteRole?: (roleId: string) => void;
  /** Areas open at first; the first one by default. */
  readonly defaultExpanded?: ReadonlyArray<string>;
  /** Read only for people who cannot manage roles. */
  readonly isReadOnly?: boolean;
}

/** What each role may do: roles as columns, powers grouped into folds as rows, a checkbox per cell. Owner's column is locked on; custom roles add a column. */
export function RolePowers({ areas, roles, grants, onChange, onAddRole, onDeleteRole, defaultExpanded, isReadOnly = false }: RolePowersProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<string>(roles.find((r) => !r.isLocked)?.id ?? '');
  const [deleting, setDeleting] = useState<RoleColumn | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const known = useRef(new Set(roles.map((r) => r.id)));
  const fresh = new Set(roles.filter((r) => !known.current.has(r.id)).map((r) => r.id));
  const roleKey = roles.map((r) => r.id).join();
  // A new column fades in once; after that it is known.
  useEffect(() => {
    const t = window.setTimeout(() => { known.current = new Set(roleKey.split(',')); }, 600);
    return () => window.clearTimeout(t);
  }, [roleKey]);

  const holds = (role: RoleColumn, power: string) => role.isLocked === true || (grants[role.id] ?? []).includes(power);
  const close = (o: boolean) => { setAdding(o); if (!o) setName(''); };
  const create = () => {
    if (name.trim() === '') return;
    onAddRole?.(name.trim(), from);
    close(false);
  };
  const cols = { '--tf-powers-n': roles.length } as CSSProperties;

  return (
    <section className="tf-powers" aria-label="Roles and what they can do">
      <div className="tf-powers__scroll">
        <div className="tf-powers__table" style={cols}>
          <div className="tf-powers__head">
            <span className="tf-powers__corner">
              {onAddRole && !isReadOnly && <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setAdding(true)}>Custom role</Button>}
            </span>
            {roles.map((r) => (
              <span key={r.id} className={cx('tf-powers__role', fresh.has(r.id) && 'tf-powers__col--new')}>
                <span className="tf-powers__role-name">{r.name}</span>
                {r.isLocked && <span className="tf-powers__lock"><Lock size={12} strokeWidth={1.75} aria-hidden="true" /><span className="tf-sr-only">, locked</span></span>}
                {r.isCustom && onDeleteRole && !isReadOnly && (
                  <Tooltip label="Delete role"><IconButton label={`Delete the ${r.name} role`} size="sm" className="tf-powers__del" onPress={() => { setDeleting(r); setAsking(true); }}><Trash2 size={14} strokeWidth={1.75} /></IconButton></Tooltip>
                )}
              </span>
            ))}
          </div>
          <DisclosureGroup allowsMultipleExpanded defaultExpandedKeys={defaultExpanded ?? areas.slice(0, 1).map((a) => a.id)}>
            {areas.map((a) => (
              <DisclosureItem key={a.id} id={a.id} title={a.title} description={a.description} end={<Count>{a.powers.length}</Count>}>
                <div className="tf-powers__rows">
                  {a.powers.map((p) => (
                    <div key={p.id} className="tf-powers__row">
                      <span className="tf-powers__power">
                        <span className="tf-powers__label">{p.label}</span>
                        {p.description !== undefined && <span className="tf-powers__desc">{p.description}</span>}
                      </span>
                      {roles.map((r) => (
                        <span key={r.id} className={cx('tf-powers__cell', r.isLocked && 'tf-powers__cell--locked', fresh.has(r.id) && 'tf-powers__col--new')}>
                          <Checkbox aria-label={`${r.name}: ${p.label}${r.isLocked ? ' (always on)' : ''}`} isSelected={holds(r, p.id)}
                            isReadOnly={r.isLocked === true || isReadOnly} onChange={(v) => onChange?.(r.id, p.id, v)} />
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </DisclosureItem>
            ))}
          </DisclosureGroup>
        </div>
      </div>
      <p className="tf-powers__note"><Lock size={12} strokeWidth={1.75} aria-hidden="true" /> Owners can always do everything, so their column can't change.</p>

      <Dialog isOpen={adding} onOpenChange={close} title="New custom role" description="It starts with the powers of the role you pick; change any of them after."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={name.trim() === ''} onPress={create}>Create role</Button></>}>
        <form className="tf-powers__form" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <DialogField label="Role name" placeholder="Sales lead" value={name} onChange={setName} autoFocus />
          <Select label="Start from" items={roles.filter((r) => !r.isLocked).map((r) => ({ id: r.id, label: r.name }))} value={from} onChange={(v) => { if (v) setFrom(v); }} />
        </form>
      </Dialog>
      <ConfirmDialog isOpen={asking} onOpenChange={setAsking}
        title={`Delete the ${deleting?.name ?? ''} role?`} consequence="People with this role become Members. Their meetings and records stay."
        confirmLabel="Delete role" onConfirm={() => { if (deleting) onDeleteRole?.(deleting.id); }} />
    </section>
  );
}
