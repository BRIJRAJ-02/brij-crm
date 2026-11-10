// Import a CSV into People: choose a file (or the sample), match columns (they auto-match), fix values that don't fit, see what
// will happen, then import. The summary keeps Undo import. Records match on email, so a second import updates instead of duplicating.
import { useState } from 'react';
import { ArrowLeft, Check, FileSpreadsheet, Undo2 } from 'lucide-react';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { Steps } from '../Steps/Steps.tsx';
import { Select } from '../Select/Select.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { newId, type AppAction, type AppState, type Person } from './data.ts';

const SAMPLE = `Full name,Email address,Company,Role,Owner,Tags
Leah Ortega,leah@acme.com,Acme Corp,Plant manager,Priya Raman,Champion
Noor Haddad,noor@globex.io,Globex,CTO,Sam Kim,Technical
Ken Adams,ken@newco.ai,NewCo,Founder,Jo M.,Decision maker
Rita Das,,Initech,Analyst,,
Omar Said,omar@zylo.in,Zylo,Ops lead,Ava Chen,`;

const TARGETS = [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'company', label: 'Company' }, { id: 'title', label: 'Job title' }, { id: 'owner', label: 'Owner' }, { id: 'tags', label: 'Tags' }, { id: 'skip', label: 'Don’t import' }];
const GUESS: Readonly<Record<string, string>> = { 'full name': 'name', name: 'name', email: 'email', 'email address': 'email', company: 'company', organisation: 'company', role: 'title', title: 'title', 'job title': 'title', owner: 'owner', tags: 'tags' };

/** Splits a simple CSV (commas, optional quotes) into rows. */
function parse(text: string): ReadonlyArray<ReadonlyArray<string>> {
  return text.trim().split(/\r?\n/).map((line) => { const out: string[] = []; let cur = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; });
}

/** Props for ImportScreen. */
export interface ImportScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void }

/** The People import. */
export function ImportScreen({ state, dispatch, onDone }: ImportScreenProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<{ readonly name: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> }>();
  const [map, setMap] = useState<ReadonlyArray<string>>([]);
  const [owners, setOwners] = useState<Readonly<Record<string, string>>>({});
  const [newCompanies, setNewCompanies] = useState(true);
  const [done, setDone] = useState<{ readonly made: number; readonly updated: number; readonly skipped: ReadonlyArray<string>; readonly before: AppState }>();
  const head = file?.rows[0] ?? [];
  const body = file?.rows.slice(1) ?? [];
  const take = (name: string, text: string) => { const rows = parse(text); setFile({ name, rows }); setMap((rows[0] ?? []).map((h) => GUESS[h.toLowerCase()] ?? 'skip')); setStep(1); };
  const col = (id: string) => map.indexOf(id);
  const val = (r: ReadonlyArray<string>, id: string) => (col(id) >= 0 ? r[col(id)] ?? '' : '');
  // Values that need a decision: owners we don't know, companies not in the workspace, rows without an email.
  const unknownOwners = [...new Set(body.map((r) => val(r, 'owner')).filter((o) => o && !state.members.some((m) => m.name === o)))];
  const unknownCompanies = [...new Set(body.map((r) => val(r, 'company')).filter((c) => c && !state.companies.some((x) => x.name.toLowerCase() === c.toLowerCase())))];
  const noEmail = body.filter((r) => !val(r, 'email'));
  const plan = body.filter((r) => val(r, 'name')).map((r) => ({ r, match: state.people.find((p) => p.email && p.email.toLowerCase() === val(r, 'email').toLowerCase()) }));
  const nameMissing = col('name') < 0;
  const run = () => {
    const before = state;
    let made = 0; let updated = 0;
    const companyIds = new Map(state.companies.map((c) => [c.name.toLowerCase(), c.id]));
    if (newCompanies) unknownCompanies.forEach((name) => { const id = newId('c'); companyIds.set(name.toLowerCase(), id); dispatch({ type: 'company/set', company: { id, name, domain: '', industry: 'Software', size: '', city: '', owner: state.me, created: new Date() } }); });
    plan.forEach(({ r, match }) => {
      const owner = owners[val(r, 'owner')] ?? (state.members.some((m) => m.name === val(r, 'owner')) ? val(r, 'owner') : state.me);
      const fields = { name: val(r, 'name'), email: val(r, 'email'), title: val(r, 'title'), companyId: companyIds.get(val(r, 'company').toLowerCase()), owner, tags: val(r, 'tags') ? val(r, 'tags').split(/;\s*/) : [] };
      if (match) { updated++; dispatch({ type: 'person/set', person: { ...match, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v !== undefined)) } as Person }); }
      else { made++; dispatch({ type: 'person/set', person: { id: newId('p'), created: new Date(), ...fields } }); }
    });
    setDone({ made, updated, skipped: body.filter((r) => !val(r, 'name')).map((r) => r.join(', ')), before }); setStep(4);
  };
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>People</Button><span className="tf-rec__spacer" /><Steps steps={['File', 'Match columns', 'Fix values', 'Check', 'Done'].map((label, n) => ({ id: String(n), label }))} current={step} /></div>
      <section className="tf-bkf-card tf-imp__card">
        {step === 0 && <>
          <h2 className="tf-imp__h">Import people</h2>
          <p className="tf-rec__muted">A CSV from your old CRM or a spreadsheet. People already here are matched by email and updated, not doubled.</p>
          <FileDrop label="Drop a CSV here" description="Up to 10,000 rows" allowsMultiple={false} acceptedFileTypes={['text/csv']} onFiles={(files) => { const f = files[0]; if (!f) return; if (!f.name.endsWith('.csv')) { toast({ message: 'Save it as CSV first: in Excel, File › Save As › CSV.' }); return; } void f.text().then((t) => take(f.name, t)); }} />
          <Button variant="ghost" icon={<FileSpreadsheet size={14} strokeWidth={1.75} />} onPress={() => take('contacts-sample.csv', SAMPLE)}>Use a sample file</Button>
        </>}
        {step === 1 && <>
          <h2 className="tf-imp__h">Match columns</h2>
          <p className="tf-rec__muted">{file?.name} · {body.length} rows. We matched what we could; check the rest.</p>
          {nameMissing && <Callout tone="warning">Pick which column holds the name. People need one.</Callout>}
          <ul className="tf-imp__map">
            {head.map((h, i) => (
              <li key={`${h}-${i}`}><span className="tf-imp__col"><strong>{h}</strong><span className="tf-rec__muted">{body.slice(0, 2).map((r) => r[i]).filter(Boolean).join(', ') || 'Empty'}</span></span>
                <span className="tf-imp__arrow" aria-hidden>→</span>
                <Select label={`${h} goes to`} isLabelHidden value={map[i] ?? 'skip'} onChange={(v) => setMap(map.map((m, j) => (j === i ? v ?? 'skip' : m === v && v !== 'skip' ? 'skip' : m)))} items={TARGETS} />
                {map[i] !== 'skip' && GUESS[h.toLowerCase()] === map[i] && <Tag size="sm" hue="green" icon={<Check size={12} strokeWidth={2} />}>Matched</Tag>}
              </li>
            ))}
          </ul>
          <div className="tf-imp__go"><Button variant="primary" isDisabled={nameMissing} onPress={() => setStep(2)}>Continue</Button></div>
        </>}
        {step === 2 && <>
          <h2 className="tf-imp__h">Fix values</h2>
          {unknownOwners.length + unknownCompanies.length + noEmail.length === 0 ? <p className="tf-rec__muted">Everything fits. Nothing to fix.</p> : <p className="tf-rec__muted">A few values don’t fit yet. Decide once; it applies to every row.</p>}
          {unknownOwners.map((o) => <div key={o} className="tf-imp__fix"><span><strong>Owner “{o}”</strong><span className="tf-rec__muted">Not a member here</span></span>
            <Select label={`Owner for ${o}`} isLabelHidden value={owners[o] ?? state.me} onChange={(v) => setOwners({ ...owners, [o]: v ?? state.me })} items={state.members.map((m) => ({ id: m.name, label: m.name }))} /></div>)}
          {unknownCompanies.length > 0 && <div className="tf-imp__fix"><span><strong>{unknownCompanies.length} new {unknownCompanies.length === 1 ? 'company' : 'companies'}</strong><span className="tf-rec__muted">{unknownCompanies.join(', ')}</span></span>
            <Select label="New companies" isLabelHidden value={newCompanies ? 'make' : 'skip'} onChange={(v) => setNewCompanies(v !== 'skip')} items={[{ id: 'make', label: 'Add them to Companies' }, { id: 'skip', label: 'Leave the company empty' }]} /></div>}
          {noEmail.length > 0 && <div className="tf-imp__fix"><span><strong>{noEmail.length} {noEmail.length === 1 ? 'row has' : 'rows have'} no email</strong><span className="tf-rec__muted">They’re added as new people and can’t be matched later</span></span></div>}
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(1)}>Back</Button><Button variant="primary" onPress={() => setStep(3)}>Continue</Button></div>
        </>}
        {step === 3 && <>
          <h2 className="tf-imp__h">Check, then import</h2>
          <ul className="tf-imp__sum">
            <li><strong className="tf-num">{plan.filter((x) => !x.match).length}</strong> new people</li>
            <li><strong className="tf-num">{plan.filter((x) => x.match).length}</strong> people updated, matched by email</li>
            {newCompanies && unknownCompanies.length > 0 && <li><strong className="tf-num">{unknownCompanies.length}</strong> new companies</li>}
            {body.length - plan.length > 0 && <li><strong className="tf-num">{body.length - plan.length}</strong> rows skipped: no name</li>}
          </ul>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(2)}>Back</Button><Button variant="primary" onPress={run}>Import {plan.length} people</Button></div>
        </>}
        {step === 4 && done && <>
          <h2 className="tf-imp__h">Imported</h2>
          <ul className="tf-imp__sum"><li><strong className="tf-num">{done.made}</strong> added</li><li><strong className="tf-num">{done.updated}</strong> updated</li>{done.skipped.length > 0 && <li><strong className="tf-num">{done.skipped.length}</strong> not imported (no name)</li>}</ul>
          <p className="tf-rec__muted">You can undo this import for 7 days.</p>
          <div className="tf-imp__go">
            <Button variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onPress={() => { dispatch({ type: 'records/restore', state: done.before }); toast({ message: 'Import undone' }); onDone(); }}>Undo import</Button>
            <Button variant="primary" onPress={onDone}>See people</Button>
          </div>
        </>}
      </section>
    </div>
  );
}
