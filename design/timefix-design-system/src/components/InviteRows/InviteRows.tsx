import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Plus, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select, type SelectOption } from '../Select/Select.tsx';
import './InviteRows.css';

/** A workspace role. Owner can do everything, Admin runs the workspace, Member does the work. */
export type TeamRole = 'owner' | 'admin' | 'member';

/** The three roles as Select options, each with its one-line description (Vercel's described options). */
export const ROLE_OPTIONS: ReadonlyArray<SelectOption> = [
  { id: 'owner', label: 'Owner', description: 'Everything, including billing and deleting the workspace.' },
  { id: 'admin', label: 'Admin', description: 'Settings, members and every booking page.' },
  { id: 'member', label: 'Member', description: 'Their own calendar, pages and the shared records.' },
];

/** One person to invite. */
export interface Invite {
  readonly email: string;
  readonly role: string;
}

interface Row { readonly id: number; readonly email: string; readonly role: string; readonly order: number }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g;

/** The parts of a pasted list: with an `@`, the addresses alone ("Ava Chen <ava@globex.com>, sam@northwind.com"); else split on commas, spaces and lines. */
export function splitEmails(text: string): readonly string[] {
  if (text.includes('@')) return text.match(ADDRESS) ?? [];
  return text.split(/[\s,;]+/).filter((p) => p !== '');
}

/** Whether `text` looks like one email address. */
export function isEmail(text: string): boolean {
  return EMAIL.test(text.trim());
}

/** Props for InviteRows. */
export interface InviteRowsProps {
  /** The roles to pick from; `ROLE_OPTIONS` by default. Pass an empty list to hide the role column. */
  readonly roles?: ReadonlyArray<SelectOption>;
  /** The role a first row starts with; a new row takes the role of the row above it. */
  readonly defaultRole?: string;
  /** At most this many rows; 20 by default. */
  readonly max?: number;
  /** Sends the valid invites. Return a promise to spin the button; the rows reset after. Show the toast here. */
  readonly onSend?: (invites: ReadonlyArray<Invite>) => void | Promise<void>;
  /** Every change, with the rows that hold a valid address (a live preview, a step's Continue). */
  readonly onChange?: (valid: ReadonlyArray<Invite>) => void;
  /** Leave the Send button off when the page's own Continue sends (first run). */
  readonly showSend?: boolean;
  readonly autoFocus?: boolean;
  readonly isDisabled?: boolean;
}

/**
 * The one way to invite people: an email row each with its role, "Add another" to drop in the next row, and a pasted list
 * split into rows. Send checks every row; a bad address turns red and shakes, and focus goes to the first one.
 */
export function InviteRows({ roles = ROLE_OPTIONS, defaultRole = 'member', max = 20, onSend, onChange, showSend = true, autoFocus = false, isDisabled = false }: InviteRowsProps) {
  const [rows, setRows] = useState<readonly Row[]>([{ id: 1, email: '', role: defaultRole, order: 0 }]);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const [flagged, setFlagged] = useState<ReadonlySet<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [overflow, setOverflow] = useState(0);
  const nextId = useRef(2);
  const boxes = useRef(new Map<number, HTMLDivElement>());
  const report = useRef(onChange);
  report.current = onChange;

  const valid = rows.filter((r) => !leaving.has(r.id) && isEmail(r.email)).map((r) => ({ email: r.email.trim(), role: r.role }));
  const validKey = valid.map((v) => `${v.email}:${v.role}`).join('|');
  useEffect(() => { report.current?.(valid); }, [validKey]);

  const focusRow = (id: number) => window.requestAnimationFrame(() => boxes.current.get(id)?.querySelector('input')?.focus());
  const make = (email: string, role: string): Row => ({ id: nextId.current++, email, role, order: 0 });

  const add = (after?: number) => {
    if (rows.length >= max) return;
    const at = after === undefined ? rows.length - 1 : rows.findIndex((r) => r.id === after);
    const row = make('', rows[at]?.role ?? defaultRole);
    setRows([...rows.slice(0, at + 1), row, ...rows.slice(at + 1)]);
    setFresh(new Set([row.id]));
    focusRow(row.id);
  };

  const remove = (id: number) => {
    const at = rows.findIndex((r) => r.id === id);
    setLeaving((s) => new Set(s).add(id));
    const neighbour = rows[at - 1] ?? rows[at + 1];
    if (neighbour) focusRow(neighbour.id);
    window.setTimeout(() => {
      setRows((list) => list.filter((r) => r.id !== id));
      setLeaving((s) => { const n = new Set(s); n.delete(id); return n; });
    }, 250);
  };

  const edit = (id: number, value: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setFlagged((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    const grew = value.length - row.email.length > 1;
    const parts = grew ? splitEmails(value) : [];
    if (parts.length < 2) { setRows((list) => list.map((r) => (r.id === id ? { ...r, email: value } : r))); return; }
    // A pasted list: the first address fills this row, the rest drop in after it with the same role, up to `max`.
    const at = rows.findIndex((r) => r.id === id);
    const room = Math.max(0, max - rows.length);
    const added = parts.slice(1, room + 1).map((email, n) => ({ ...make(email, row.role), order: n }));
    setOverflow(parts.length - 1 - added.length);
    setRows([...rows.slice(0, at), { ...row, email: parts[0] ?? '' }, ...added, ...rows.slice(at + 1)]);
    setFresh(new Set(added.map((r) => r.id)));
  };

  const send = async () => {
    const bad = rows.filter((r) => r.email.trim() !== '' && !isEmail(r.email)).map((r) => r.id);
    if (bad.length > 0) {
      // Rows already red go clear for a frame, so each Send shakes them again (transitions.dev 12).
      setFlagged(new Set(bad.filter((id) => !flagged.has(id))));
      window.requestAnimationFrame(() => setFlagged(new Set(bad)));
      focusRow(bad[0] ?? 0);
      return;
    }
    if (valid.length === 0) { focusRow(rows[0]?.id ?? 0); return; }
    const result = onSend?.(valid);
    if (result instanceof Promise) { setSending(true); await result.finally(() => setSending(false)); }
    const first = make('', defaultRole);
    setRows([first]);
    setFresh(new Set());
    setOverflow(0);
  };

  const onKey = (e: { readonly key: string; readonly preventDefault: () => void }, row: Row, i: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = rows[i + 1];
    if (next) focusRow(next.id);
    else if (row.email.trim() === '' && showSend) void send();
    else if (row.email.trim() !== '') add(row.id);
  };

  const showRoles = roles.length > 0;
  const live = rows.filter((r) => !leaving.has(r.id));
  const label = valid.length > 1 ? `Send ${valid.length} invites` : 'Send invite';

  return (
    <div className={cx('tf-invites', !showRoles && 'tf-invites--plain')}>
      <div className="tf-invites__head" aria-hidden="true">
        <span>Email</span>{showRoles && <span>Role</span>}
      </div>
      <div className="tf-invites__rows">
        {rows.map((r, i) => {
          const name = r.email.trim() || `row ${i + 1}`;
          const bad = flagged.has(r.id);
          return (
            <div key={r.id} className={cx('tf-invites__row', fresh.has(r.id) && 'tf-invites__row--new', leaving.has(r.id) && 'tf-invites__row--leaving')} style={{ '--tf-i': r.order } as CSSProperties}>
              <div className="tf-invites__clip">
                <div className="tf-invites__line" ref={(el) => { if (el) boxes.current.set(r.id, el); else boxes.current.delete(r.id); }}>
                  <TextField className="tf-invites__email" placeholder="name@company.com" value={r.email}
                    aria-label={i === 0 ? 'Email' : `Email ${i + 1}`} autoFocus={autoFocus && i === 0} isDisabled={isDisabled || sending}
                    isInvalid={bad} errorMessage={bad ? 'Check this address.' : undefined}
                    onChange={(v) => edit(r.id, v)} onKeyDown={(e) => onKey(e, r, i)} />
                  {showRoles && (
                    <Select label={`Role for ${name}`} isLabelHidden items={roles} value={r.role} className="tf-invites__role" isDisabled={isDisabled || sending}
                      onChange={(v) => { if (v) setRows((list) => list.map((x) => (x.id === r.id ? { ...x, role: v } : x))); }} />
                  )}
                  <span className="tf-invites__remove">
                    {live.length > 1 && <IconButton label={`Remove ${name}`} size="sm" isDisabled={sending} onPress={() => remove(r.id)}><X size={14} strokeWidth={1.75} /></IconButton>}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="tf-invites__foot">
        {live.length < max ? (
          <Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => add()} isDisabled={isDisabled || sending} aria-label="Add another person">Add another</Button>
        ) : (
          <span className="tf-invites__note">Up to {max} at a time.</span>
        )}
        {overflow > 0 && <span className="tf-invites__note" role="status">{overflow} more didn't fit. Send these first.</span>}
        {showSend && <Button variant="primary" className="tf-invites__send" isPending={sending} isDisabled={isDisabled || rows.every((r) => r.email.trim() === '')} onPress={() => { void send(); }}>{label}</Button>}
      </div>
      <p className="tf-sr-only" aria-live="polite">{flagged.size > 0 ? `${flagged.size} address${flagged.size === 1 ? '' : 'es'} to check.` : ''}</p>
    </div>
  );
}
