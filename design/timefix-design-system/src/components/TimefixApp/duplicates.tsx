// Find duplicates in People: pairs that share an email, or a name at the same company. Merge picks each field's value side by side;
// the kept record takes the other's tasks, notes and deals. Not a duplicate hides the pair. Both have Undo.
import { useState } from 'react';
import { ArrowLeft, GitMerge, Users } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { AppAction, AppState, Company, Person } from './data.ts';

/** Ids of everything that points at a record, so a merge's Undo moves back only those. */
function linkedTo(state: AppState, object: 'people' | 'companies', id: string): ReadonlyArray<string> {
  const at = (r?: { readonly object: string; readonly id: string }) => r?.object === object && r.id === id;
  return [...state.tasks.filter((x) => at(x.record)), ...state.notes.filter((x) => at(x.record)), ...state.comments.filter((x) => at(x.record)), ...state.activity.filter((x) => at(x.record)),
    ...state.inbox.filter((x) => at(x.record)), ...state.files.filter((x) => at(x.record)), ...state.deals.filter((d) => (object === 'people' ? d.contactId : d.companyId) === id),
    ...(object === 'companies' ? state.people.filter((p) => p.companyId === id) : []),
    ...state.lists.flatMap((l) => (l.object === object ? l.entries.filter((e) => e.recordId === id) : [])), ...(object === 'people' ? state.forms.flatMap((f) => f.responses.filter((r) => r.personId === id)) : [])].map((x) => x.id);
}

const PEOPLE_FIELDS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'title', label: 'Job title' }, { id: 'companyId', label: 'Company' }, { id: 'owner', label: 'Owner' }];
const COMPANY_FIELDS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [{ id: 'name', label: 'Name' }, { id: 'domain', label: 'Domain' }, { id: 'industry', label: 'Industry' }, { id: 'size', label: 'Employees' }, { id: 'city', label: 'City' }, { id: 'owner', label: 'Owner' }];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Likely duplicate people: same email, or the same first name at one company. */
export function duplicatePairs(state: AppState, dismissed: ReadonlySet<string>): ReadonlyArray<readonly [Person, Person, string]> {
  const out: Array<readonly [Person, Person, string]> = [];
  state.people.forEach((a, i) => state.people.slice(i + 1).forEach((b) => {
    const key = `${a.id}|${b.id}`; if (dismissed.has(key)) return;
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
    const key = `${a.id}|${b.id}`; if (dismissed.has(key)) return;
    if (a.domain && a.domain.toLowerCase() === b.domain.toLowerCase()) out.push([a, b, 'Same website']);
    else if (base(a.name) && base(a.name) === base(b.name)) out.push([a, b, 'Same name']);
  }));
  return out;
}

/** Props for DuplicatesScreen. */
export interface DuplicatesScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void; /** People (default) or Companies. */ readonly object?: 'people' | 'companies' }

type Row = Readonly<Record<string, unknown>> & { readonly id: string; readonly name: string; readonly created: Date };

/** The duplicates list and merge, for People or Companies. */
export function DuplicatesScreen({ state, dispatch, onDone, object = 'people' }: DuplicatesScreenProps) {
  const { toast } = useToast();
  const [merging, setMerging] = useState<readonly [Row, Row]>();
  const [pick, setPick] = useState<Readonly<Record<string, 0 | 1>>>({});
  const people = object === 'people';
  const pairs: ReadonlyArray<readonly [Row, Row, string]> = people ? duplicatePairs(state, new Set(state.notDupes)) as unknown as ReadonlyArray<readonly [Row, Row, string]> : companyPairs(state, new Set(state.notDupes)) as unknown as ReadonlyArray<readonly [Row, Row, string]>;
  const FIELDS = people ? PEOPLE_FIELDS : COMPANY_FIELDS;
  const co = (id?: unknown) => state.companies.find((c) => c.id === id)?.name ?? '';
  const line = (r: Row) => (people ? `${String(r.email || 'No email')} · ${co(r.companyId)}` : [r.domain, r.city].filter(Boolean).join(' · ') || 'No website');
  const word = people ? 'People' : 'Companies';
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>{word}</Button><span className="tf-rec__muted">{pairs.length ? `${pairs.length} likely ${pairs.length === 1 ? 'duplicate' : 'duplicates'}` : ''}</span></div>
      {pairs.length === 0 ? <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title="No duplicates" description={people ? 'We check for the same email, and the same name at one company.' : 'We check for the same website, and the same name.'} action={<Button size="sm" variant="secondary" onPress={onDone}>Back to {word}</Button>} /> : (
        <ul className="tf-dup">
          {pairs.map(([a, b, why]) => (
            <li key={`${a.id}|${b.id}`} className="tf-bkf-card tf-dup__pair">
              {[a, b].map((p) => <span key={p.id} className="tf-dup__who"><Avatar name={p.name} size={36} shape={people ? 'round' : 'square'} /><span><strong>{p.name}</strong><span className="tf-rec__muted">{line(p)}</span></span></span>)}
              <span className="tf-dup__why tf-rec__muted">{why}</span>
              <span className="tf-dup__acts">
                <Button size="sm" variant="ghost" onPress={() => { const key = `${a.id}|${b.id}`; dispatch({ type: 'dupes/dismiss', key, on: true }); toast({ message: 'Marked as not a duplicate. We won’t suggest them again.', action: { label: 'Undo', onAction: () => dispatch({ type: 'dupes/dismiss', key, on: false }) } }); }}>Not a duplicate</Button>
                <Button size="sm" variant="primary" icon={<GitMerge size={14} strokeWidth={1.75} />} onPress={() => { setPick({}); setMerging([a, b]); }}>Merge</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {merging && (() => {
        const [a, b] = merging;
        const keep = a.created <= b.created ? a : b; const drop = keep === a ? b : a;
        const raw = (f: string, side: 0 | 1) => String((side === 0 ? a : b)[f] ?? '');
        const valueOf = (f: string, side: 0 | 1) => (f === 'companyId' ? co(raw(f, side)) : raw(f, side));
        const chosen = (f: string): 0 | 1 => pick[f] ?? (valueOf(f, 0) ? 0 : 1);
        return (
          <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setMerging(undefined); }} title={`Merge into ${keep.name}`}
            description={`Pick what to keep. Everything linked to ${drop.name} (${people ? 'tasks, notes, comments, files, deals, lists and form answers' : 'its people, deals, tasks, notes, comments, files and lists'}) moves over, and the other record goes to Trash.`}
            actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => {
              const patch: Readonly<Record<string, unknown>> = { ...Object.fromEntries(FIELDS.map((f) => [f.id, raw(f.id, chosen(f.id)) || undefined])), ...(people ? { tags: [...new Set([...((a.tags as ReadonlyArray<string> | undefined) ?? []), ...((b.tags as ReadonlyArray<string> | undefined) ?? [])])] } : {}) };
              const was = Object.fromEntries(Object.keys(patch).map((k) => [k, keep[k]]));
              const moved = linkedTo(state, object, drop.id);
              dispatch({ type: 'records/fields', object, changes: [{ id: keep.id, patch }] });
              dispatch({ type: 'records/relink', from: { object, id: drop.id }, to: { object, id: keep.id } });
              dispatch({ type: 'records/remove', object, ids: [drop.id] });
              dispatch({ type: 'trash/merged', id: drop.id, into: keep.id });
              dispatch({ type: 'history/add', text: `${state.me} merged ${drop.name} into ${keep.name}` });
              setMerging(undefined);
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
      })()}
    </div>
  );
}
