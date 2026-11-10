// Find duplicates in People: pairs that share an email, or a name at the same company. Merge picks each field's value side by side;
// the kept record takes the other's tasks, notes and deals. Not a duplicate hides the pair. Both have Undo.
import { useState } from 'react';
import { ArrowLeft, GitMerge, Users } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { AppAction, AppState, Person } from './data.ts';

const FIELDS: ReadonlyArray<{ readonly id: keyof Person; readonly label: string }> = [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'title', label: 'Job title' }, { id: 'owner', label: 'Owner' }];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Likely duplicate pairs: same email, or the same first name and company. */
export function duplicatePairs(state: AppState, dismissed: ReadonlySet<string>): ReadonlyArray<readonly [Person, Person, string]> {
  const out: Array<readonly [Person, Person, string]> = [];
  state.people.forEach((a, i) => state.people.slice(i + 1).forEach((b) => {
    const key = `${a.id}|${b.id}`; if (dismissed.has(key)) return;
    if (a.email && a.email.toLowerCase() === b.email.toLowerCase()) out.push([a, b, 'Same email']);
    else if (a.companyId && a.companyId === b.companyId && norm(a.name.split(' ')[0] ?? '') === norm(b.name.split(' ')[0] ?? '')) out.push([a, b, 'Same name at the same company']);
  }));
  return out;
}

/** Props for DuplicatesScreen. */
export interface DuplicatesScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void }

/** The duplicates list and merge. */
export function DuplicatesScreen({ state, dispatch, onDone }: DuplicatesScreenProps) {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState<readonly [Person, Person]>();
  const [pick, setPick] = useState<Readonly<Record<string, 0 | 1>>>({});
  const pairs = duplicatePairs(state, dismissed);
  const co = (id?: string) => state.companies.find((c) => c.id === id)?.name ?? '';
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>People</Button><span className="tf-rec__muted">{pairs.length ? `${pairs.length} likely ${pairs.length === 1 ? 'duplicate' : 'duplicates'}` : ''}</span></div>
      {pairs.length === 0 ? <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title="No duplicates" description="We check for the same email, and the same name at one company." action={<Button size="sm" variant="secondary" onPress={onDone}>Back to People</Button>} /> : (
        <ul className="tf-dup">
          {pairs.map(([a, b, why]) => (
            <li key={`${a.id}|${b.id}`} className="tf-bkf-card tf-dup__pair">
              {[a, b].map((p) => <span key={p.id} className="tf-dup__who"><Avatar name={p.name} size={36} /><span><strong>{p.name}</strong><span className="tf-rec__muted">{p.email || 'No email'} · {co(p.companyId)}</span></span></span>)}
              <span className="tf-dup__why tf-rec__muted">{why}</span>
              <span className="tf-dup__acts">
                <Button size="sm" variant="ghost" onPress={() => { const key = `${a.id}|${b.id}`; setDismissed(new Set(dismissed).add(key)); toast({ message: 'Marked as not a duplicate', action: { label: 'Undo', onAction: () => setDismissed((d) => { const n = new Set(d); n.delete(key); return n; }) } }); }}>Not a duplicate</Button>
                <Button size="sm" variant="primary" icon={<GitMerge size={14} strokeWidth={1.75} />} onPress={() => { setPick({}); setMerging([a, b]); }}>Merge</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {merging && (() => {
        const [a, b] = merging;
        const keep = a.created <= b.created ? a : b; const drop = keep === a ? b : a;
        const valueOf = (f: keyof Person, side: 0 | 1) => String((side === 0 ? a : b)[f] ?? '');
        const chosen = (f: keyof Person): 0 | 1 => pick[f] ?? (valueOf(f, 0) ? 0 : 1);
        return (
          <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setMerging(undefined); }} title={`Merge into ${keep.name}`} description={`Pick what to keep. ${drop.name}'s tasks, notes and deals move over, and the other record is removed.`}
            actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => {
              const before = state;
              const merged: Person = { ...keep, ...Object.fromEntries(FIELDS.map((f) => [f.id, valueOf(f.id, chosen(f.id)) || undefined])), tags: [...new Set([...a.tags, ...b.tags])] } as Person;
              dispatch({ type: 'person/set', person: merged });
              state.tasks.filter((t) => t.record?.id === drop.id).forEach((t) => dispatch({ type: 'task/set', task: { ...t, record: { object: 'people', id: keep.id } } }));
              state.notes.filter((n) => n.record.id === drop.id).forEach((n) => dispatch({ type: 'note/set', note: { ...n, record: { object: 'people', id: keep.id } } }));
              state.deals.filter((d) => d.contactId === drop.id).forEach((d) => dispatch({ type: 'deal/set', deal: { ...d, contactId: keep.id } }));
              dispatch({ type: 'records/remove', object: 'people', ids: [drop.id] });
              setMerging(undefined); toast({ message: `Merged into ${merged.name}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/restore', state: before }) } });
            }}>Merge</Button></>}>
            <div className="tf-dup__grid" role="table" aria-label="Pick values">
              {FIELDS.map((f) => (
                <div key={f.id} role="row" className="tf-dup__row">
                  <span role="rowheader" className="tf-rec__muted">{f.label}</span>
                  {([0, 1] as const).map((side) => (
                    <button key={side} type="button" role="cell" className="tf-dup__opt" aria-pressed={chosen(f.id) === side} disabled={!valueOf(f.id, side)} onClick={() => setPick({ ...pick, [f.id]: side })}>{valueOf(f.id, side) || '—'}</button>
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
