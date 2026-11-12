// Find duplicates in any object: people (same email, or a name at the same company), companies (same website or name), deals (same name
// at the same company) and owner-made objects (same name, or the same value on a unique attribute). Merge picks each field's value side by
// side; the kept record takes the other's tasks, notes and links. Not a duplicate hides the pair. Both have Undo.
import { useState } from 'react';
import { ArrowLeft, GitMerge, Users } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { inr, isBuiltIn, type AnyRecord, type AppAction, type AppState, type Company, type Deal, type ObjectId, type Person } from './data.ts';
import { liveAttributes, recordsOf, schemaOf, wordsOf } from './model.tsx';

/** Ids of everything that points at a record, so a merge's Undo moves back only those. */
function linkedTo(state: AppState, object: ObjectId, id: string): ReadonlyArray<string> {
  const at = (r?: { readonly object: string; readonly id: string }) => r?.object === object && r.id === id;
  return [...state.tasks.filter((x) => at(x.record) || (x.also ?? []).some((r) => at(r))), ...state.notes.filter((x) => at(x.record)), ...state.comments.filter((x) => at(x.record)), ...state.activity.filter((x) => at(x.record)),
    ...state.inbox.filter((x) => at(x.record)), ...state.files.filter((x) => at(x.record)), ...(object === 'people' || object === 'companies' ? state.deals.filter((d) => (object === 'people' ? d.contactId : d.companyId) === id) : []),
    ...(object === 'companies' ? state.people.filter((p) => p.companyId === id) : []),
    ...state.lists.flatMap((l) => (l.object === object ? l.entries.filter((e) => e.recordId === id) : [])), ...(object === 'people' ? state.forms.flatMap((f) => f.responses.filter((r) => r.personId === id)) : [])].map((x) => x.id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Likely duplicate people: same email, or the same first name at one company. */
export function duplicatePairs(state: AppState, dismissed: ReadonlySet<string>): ReadonlyArray<readonly [Person, Person, string]> {
  const out: Array<readonly [Person, Person, string]> = [];
  state.people.forEach((a, i) => state.people.slice(i + 1).forEach((b) => {
    const key = [a.id, b.id].sort().join('|'); if (dismissed.has(key)) return;
    if (a.email && a.email.toLowerCase() === b.email.toLowerCase()) out.push([a, b, 'Same email']);
    else if (a.companyId && a.companyId === b.companyId && norm(a.name.split(' ')[0] ?? '') === norm(b.name.split(' ')[0] ?? '')) out.push([a, b, 'Same name at the same company']);
  }));
  return out;
}

/** Likely duplicate companies: the same website domain, or the same name once spaces and "Inc", "Ltd" are set aside. */
export function companyPairs(state: AppState, dismissed: ReadonlySet<string>): ReadonlyArray<readonly [Company, Company, string]> {
  const base = (n: string) => norm(n.replace(/\b(inc|ltd|llc|pvt|corp|co|limited|private)\b\.?/gi, ''));
  const out: Array<readonly [Company, Company, string]> = [];
  state.companies.forEach((a, i) => state.companies.slice(i + 1).forEach((b) => {
    const key = [a.id, b.id].sort().join('|'); if (dismissed.has(key)) return;
    if (a.domain && a.domain.toLowerCase() === b.domain.toLowerCase()) out.push([a, b, 'Same website']);
    else if (base(a.name) && base(a.name) === base(b.name)) out.push([a, b, 'Same name']);
  }));
  return out;
}

/** Likely duplicates in any object. */
export function duplicatesFor(state: AppState, object: ObjectId, dismissed: ReadonlySet<string>): ReadonlyArray<readonly [AnyRecord, AnyRecord, string]> {
  if (object === 'people') return duplicatePairs(state, dismissed);
  if (object === 'companies') return companyPairs(state, dismissed);
  const list = recordsOf(state, object);
  const unique = liveAttributes(schemaOf(state, object)).filter((a) => a.isUnique && a.id !== 'name');
  const out: Array<readonly [AnyRecord, AnyRecord, string]> = [];
  list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
    const key = [a.id, b.id].sort().join('|'); if (dismissed.has(key)) return;
    if (object === 'deals') { const x = a as Deal; const y = b as Deal; if (x.companyId === y.companyId && norm(x.name) === norm(y.name)) out.push([a, b, 'Same name at the same company']); return; }
    const same = unique.find((u) => a.extra?.[u.id] && a.extra[u.id]?.toLowerCase() === b.extra?.[u.id]?.toLowerCase());
    if (same) out.push([a, b, `Same ${same.name.toLowerCase()}`]);
    else if (norm(a.name) && norm(a.name) === norm(b.name)) out.push([a, b, 'Same name']);
  }));
  return out;
}

/** The fields a merge lets you pick between. Keys starting "extra." are owner-made attributes. */
function mergeFields(state: AppState, object: ObjectId): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const builtIn: Readonly<Record<string, ReadonlyArray<{ readonly id: string; readonly label: string }>>> = {
    people: [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'title', label: 'Job title' }, { id: 'companyId', label: 'Company' }, { id: 'owner', label: 'Owner' }],
    companies: [{ id: 'name', label: 'Name' }, { id: 'domain', label: 'Domain' }, { id: 'industry', label: 'Industry' }, { id: 'size', label: 'Employees' }, { id: 'city', label: 'City' }, { id: 'owner', label: 'Owner' }],
    deals: [{ id: 'name', label: 'Deal' }, { id: 'companyId', label: 'Company' }, { id: 'contactId', label: 'Contact' }, { id: 'stage', label: 'Stage' }, { id: 'amount', label: 'Amount' }, { id: 'owner', label: 'Owner' }],
  };
  const own = liveAttributes(schemaOf(state, object)).filter((a) => !a.computed && !a.isSystem && !(builtIn[object] ?? []).some((f) => f.id === a.id) && !['name', 'created', 'email', 'phone', 'title', 'company', 'tags', 'owner', 'lastContact', 'domain', 'industry', 'size', 'city', 'stage', 'amount', 'close'].includes(a.id));
  return [...(builtIn[object] ?? [{ id: 'name', label: 'Name' }, { id: 'owner', label: 'Owner' }]), ...own.map((a) => ({ id: `extra.${a.id}`, label: a.name }))];
}

/** Merge two records: pick each field's value; the older one is kept and takes everything linked to the other, which goes to Trash. */
export function MergeDialog({ state, dispatch, object, pair, onClose, onMerged }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly object: ObjectId; readonly pair: readonly [AnyRecord, AnyRecord]; readonly onClose: () => void; readonly onMerged?: (keptId: string) => void }) {
  const { toast } = useToast();
  const [pick, setPick] = useState<Readonly<Record<string, 0 | 1>>>({});
  const [a, b] = pair;
  const FIELDS = mergeFields(state, object);
  const keep = a.created <= b.created ? a : b; const drop = keep === a ? b : a;
  const co = (id?: unknown) => state.companies.find((c) => c.id === id)?.name ?? '';
  const raw = (f: string, side: 0 | 1) => { const r = (side === 0 ? a : b) as AnyRecord & Readonly<Record<string, unknown>>; return f.startsWith('extra.') ? String(r.extra?.[f.slice(6)] ?? '') : String(r[f] ?? ''); };
  const valueOf = (f: string, side: 0 | 1) => (f === 'companyId' ? co(raw(f, side)) : f === 'contactId' ? state.people.find((p) => p.id === raw(f, side))?.name ?? '' : f === 'amount' && raw(f, side) ? inr(Number(raw(f, side))) : raw(f, side));
  const chosen = (f: string): 0 | 1 => pick[f] ?? (valueOf(f, 0) ? 0 : 1);
  const people = object === 'people';
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title={`Merge into ${keep.name}`}
      description={`Pick what to keep. Everything linked to ${drop.name} (tasks, notes, comments, files${object === 'companies' ? ', its people and deals' : people ? ', deals and form answers' : ''}) moves over, and the other record goes to Trash.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => {
        const own = FIELDS.filter((f) => !f.id.startsWith('extra.'));
        const extraPick = Object.fromEntries(FIELDS.filter((f) => f.id.startsWith('extra.')).map((f) => [f.id.slice(6), raw(f.id, chosen(f.id))]).filter(([, v]) => v));
        const patch: Readonly<Record<string, unknown>> = { ...Object.fromEntries(own.map((f) => [f.id, f.id === 'amount' ? Number(raw(f.id, chosen(f.id))) || 0 : raw(f.id, chosen(f.id)) || undefined])),
          ...(people ? { tags: [...new Set([...((a as Person).tags ?? []), ...((b as Person).tags ?? [])])] } : {}),
          // Every other owner-made value comes along (the kept record's wins), and the latest contact date is kept.
          extra: { ...(drop.extra ?? {}), ...Object.fromEntries(Object.entries(keep.extra ?? {}).filter(([, v]) => v)), ...extraPick },
          ...(people && ((a as Person).lastContact || (b as Person).lastContact) ? { lastContact: [(a as Person).lastContact, (b as Person).lastContact].filter((d): d is Date => d instanceof Date).sort((x, y) => y.getTime() - x.getTime())[0] } : {}) };
        const was = Object.fromEntries(Object.keys(patch).map((k) => [k, k === 'extra' ? Object.fromEntries(Object.keys(patch.extra as Record<string, string>).map((x) => [x, keep.extra?.[x] ?? ''])) : (keep as AnyRecord & Readonly<Record<string, unknown>>)[k]]));
        const moved = linkedTo(state, object, drop.id);
        dispatch({ type: 'records/fields', object, changes: [{ id: keep.id, patch }] });
        dispatch({ type: 'records/relink', from: { object, id: drop.id }, to: { object, id: keep.id } });
        dispatch({ type: 'records/remove', object, ids: [drop.id] });
        dispatch({ type: 'trash/merged', id: drop.id, into: keep.id });
        dispatch({ type: 'history/add', text: `${state.me} merged ${drop.name} into ${keep.name}` });
        onClose(); onMerged?.(keep.id);
        toast({ message: `Merged into ${String(patch.name ?? keep.name)}`, action: { label: 'Undo', onAction: () => {
          dispatch({ type: 'records/untrash', ids: [drop.id] });
          dispatch({ type: 'records/relink', from: { object, id: keep.id }, to: { object, id: drop.id }, only: moved });
          dispatch({ type: 'records/fields', object, changes: [{ id: keep.id, patch: was }] });
        } } });
      }}>Merge</Button></>}>
      <div className="tf-dup__grid">
        {FIELDS.map((f) => (
          <div key={f.id} role="group" aria-label={f.label} className="tf-dup__row">
            <span className="tf-rec__muted" aria-hidden>{f.label}</span>
            {([0, 1] as const).map((side) => (
              <button key={side} type="button" className="tf-dup__opt" aria-pressed={chosen(f.id) === side} aria-label={`${f.label}: ${valueOf(f.id, side) || 'empty'}`} disabled={!valueOf(f.id, side)} onClick={() => setPick({ ...pick, [f.id]: side })}>{valueOf(f.id, side) || '—'}</button>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Props for DuplicatesScreen. */
export interface DuplicatesScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void; /** Any object; People by default. */ readonly object?: ObjectId }

/** The duplicates list and merge, for any object. */
export function DuplicatesScreen({ state, dispatch, onDone, object = 'people' }: DuplicatesScreenProps) {
  const { toast } = useToast();
  const [merging, setMerging] = useState<readonly [AnyRecord, AnyRecord]>();
  const pairs = duplicatesFor(state, object, new Set(state.notDupes));
  const co = (id?: unknown) => state.companies.find((c) => c.id === id)?.name ?? '';
  const line = (r: AnyRecord) => {
    if (object === 'people') { const p = r as Person; return `${p.email || 'No email'} · ${co(p.companyId)}`; }
    if (object === 'companies') { const c = r as Company; return [c.domain, c.city].filter(Boolean).join(' · ') || 'No website'; }
    if (object === 'deals') { const d = r as Deal; return [co(d.companyId), inr(d.amount), d.stage].filter(Boolean).join(' · '); }
    return [r.owner, ...Object.values(r.extra ?? {}).filter(Boolean).slice(0, 2)].join(' · ');
  };
  const w = wordsOf(state, object);
  const why = object === 'people' ? 'We check for the same email, and the same name at one company.' : object === 'companies' ? 'We check for the same website, and the same name.' : object === 'deals' ? 'We check for the same deal name at one company.' : 'We check for the same name, and the same value on a unique attribute.';
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>{w.Many}</Button><span className="tf-rec__muted">{pairs.length ? `${pairs.length} likely ${pairs.length === 1 ? 'duplicate' : 'duplicates'}` : ''}</span></div>
      {pairs.length === 0 ? <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title="No duplicates" description={why} action={<Button size="sm" variant="secondary" onPress={onDone}>Back to {w.Many}</Button>} /> : (
        <ul className="tf-dup">
          {pairs.map(([a, b, reason]) => (
            <li key={`${a.id}|${b.id}`} className="tf-bkf-card tf-dup__pair">
              {[a, b].map((p) => <span key={p.id} className="tf-dup__who"><Avatar name={p.name} size={36} shape={object === 'people' ? 'round' : 'square'} /><span className="tf-dup__text"><strong>{p.name}</strong><span className="tf-rec__muted">{line(p)}</span></span></span>)}
              <span className="tf-dup__why tf-rec__muted">{reason}</span>
              <span className="tf-dup__acts">
                <Button size="sm" variant="ghost" onPress={() => { const key = [a.id, b.id].sort().join('|'); dispatch({ type: 'dupes/dismiss', key, on: true }); toast({ message: 'Marked as not a duplicate. We won’t suggest them again.', action: { label: 'Undo', onAction: () => dispatch({ type: 'dupes/dismiss', key, on: false }) } }); }}>Not a duplicate</Button>
                <Button size="sm" variant="primary" icon={<GitMerge size={14} strokeWidth={1.75} />} onPress={() => setMerging([a, b])}>Merge</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Back to the list straight away after a merge: the merged record is there, and Undo rides on the toast. */}
      {merging && <MergeDialog state={state} dispatch={dispatch} object={object} pair={merging} onClose={() => setMerging(undefined)} onMerged={() => onDone()} />}
    </div>
  );
}

/** Is this record half of a likely duplicate pair? The other one and why. */
export function twinOf(state: AppState, object: ObjectId, id: string): { readonly other: AnyRecord; readonly self: AnyRecord; readonly why: string } | undefined {
  if (!isBuiltIn(object) && recordsOf(state, object).length < 2) return undefined;
  const p = duplicatesFor(state, object, new Set(state.notDupes)).find(([a, b]) => a.id === id || b.id === id);
  if (!p) return undefined;
  const [a, b, why] = p;
  return a.id === id ? { self: a, other: b, why } : { self: b, other: a, why };
}
