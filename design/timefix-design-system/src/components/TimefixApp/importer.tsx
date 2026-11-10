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
import { type ObjectSchema, newId, type AppAction, type AppState, type Person } from './data.ts';

const SAMPLE = `Full name,Email address,Company,Role,Owner,Tags
Leah Ortega,leah@acme.com,Acme Corp,Plant manager,Priya Raman,Champion
Noor Haddad,noor@globex.io,Globex,CTO,Sam Kim,Technical
Ken Adams,ken@newco.ai,NewCo,Founder,Jo M.,Decision maker
Rita Das,,Initech,Analyst,,
Omar Said,omar@zylo.in,Zylo,Ops lead,Ava Chen,`;

const TARGETS = [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'company', label: 'Company' }, { id: 'title', label: 'Job title' }, { id: 'owner', label: 'Owner' }, { id: 'tags', label: 'Tags' }, { id: 'lastContact', label: 'Last contact (a date)' }, { id: 'new', label: 'A new attribute' }, { id: 'skip', label: 'Don’t import' }];
const GUESS: Readonly<Record<string, string>> = { 'full name': 'name', name: 'name', email: 'email', 'email address': 'email', company: 'company', organisation: 'company', role: 'title', title: 'title', 'job title': 'title', owner: 'owner', tags: 'tags', 'last contact': 'lastContact', 'last contacted': 'lastContact' };
/** Reads a date cell: ISO, or day/month/year (or month/day/year when asked). */
const readDate = (v: string, order: 'dmy' | 'mdy'): Date | undefined => {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v); if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v.trim()); if (!m) return undefined;
  const [a, b] = order === 'dmy' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])]; const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? new Date(y, b - 1, a) : undefined;
};

/** Splits a CSV into rows: quoted cells may hold commas, line breaks and doubled quotes (""). */
function parse(text: string): ReadonlyArray<ReadonlyArray<string>> {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** What an import changed, so Undo takes back exactly that: new records go, updated fields get their old values. */
interface ImportUndo { /** People's attributes before the import, when it added attributes or tag options. */ readonly schemaBefore?: ObjectSchema; readonly made: number; readonly updated: number; readonly skipped: ReadonlyArray<string>; readonly created: ReadonlyArray<string>; readonly newCompanies: ReadonlyArray<string>; readonly before: ReadonlyArray<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> }
const undoImport = (dispatch: (a: AppAction) => void, object: 'people' | 'companies', u: ImportUndo, me: string) => {
  dispatch({ type: 'records/drop', object, ids: u.created, note: `${me} undid an import` });
  if (u.newCompanies.length) dispatch({ type: 'records/drop', object: 'companies', ids: u.newCompanies });
  if (u.before.length) dispatch({ type: 'records/fields', object, changes: u.before });
  if (u.schemaBefore) dispatch({ type: 'object/set', object: u.schemaBefore });
};
/** Reads a dropped file: CSV only (any case), with a plain message when it can't. */
const readCsv = (f: File | undefined, toast: (t: { readonly message: string; readonly tone?: 'danger' }) => void, then: (name: string, text: string) => void) => {
  if (!f) return;
  if (!/\.csv$/i.test(f.name)) { toast({ message: 'Save it as CSV first: in Excel, File › Save As › CSV.' }); return; }
  f.text().then((t) => (t.trim() ? then(f.name, t) : toast({ message: `${f.name} is empty.`, tone: 'danger' })), () => toast({ message: `Couldn’t read ${f.name}. Try saving it again.`, tone: 'danger' }));
};

/** Props for ImportScreen. */
export interface ImportScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void; /** People (matched by email) or Companies (matched by domain). */ readonly object?: 'people' | 'companies' }

/** The People import. */
export function ImportScreen({ state, dispatch, onDone, object = 'people' }: ImportScreenProps) {
  if (object === 'companies') return <CompanyImport state={state} dispatch={dispatch} onDone={onDone} />;
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<{ readonly name: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> }>();
  const [map, setMap] = useState<ReadonlyArray<string>>([]);
  const [owners, setOwners] = useState<Readonly<Record<string, string>>>({});
  const [newCompanies, setNewCompanies] = useState(true);
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [done, setDone] = useState<ImportUndo>();
  const head = file?.rows[0] ?? [];
  const body = file?.rows.slice(1) ?? [];
  const take = (name: string, text: string) => { const rows = parse(text); setFile({ name, rows }); setMap((rows[0] ?? []).map((h) => GUESS[h.toLowerCase()] ?? 'skip')); setStep(1); };
  const col = (id: string) => map.indexOf(id);
  const val = (r: ReadonlyArray<string>, id: string) => (col(id) >= 0 ? r[col(id)] ?? '' : '');
  // Values that need a decision: owners we don't know, companies not in the workspace, rows without an email.
  const unknownOwners = [...new Set(body.map((r) => val(r, 'owner')).filter((o) => o && !state.members.some((m) => m.name === o)))];
  const unknownCompanies = [...new Set(body.map((r) => val(r, 'company')).filter((c) => c && !state.companies.some((x) => x.name.toLowerCase() === c.toLowerCase())))];
  const noEmail = body.filter((r) => !val(r, 'email'));
  // Dates like 03/04/2026 read two ways: ask once. New tags become options of the Tags attribute. New attribute columns are named after their header.
  const ambiguous = body.map((r) => val(r, 'lastContact')).some((d) => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(d); return m !== null && Number(m[1]) <= 12 && Number(m[2]) <= 12 && m[1] !== m[2]; });
  const badDates = body.filter((r) => val(r, 'lastContact') && !readDate(val(r, 'lastContact'), dateOrder)).length;
  const tagOptions = (state.objects.find((o) => o.id === 'people')?.attributes.find((a) => a.id === 'tags')?.options ?? []).map((o) => o.label.toLowerCase());
  const newTags = [...new Set(body.flatMap((r) => (val(r, 'tags') ? val(r, 'tags').split(/;\s*/).filter(Boolean) : [])))].filter((t) => !tagOptions.includes(t.toLowerCase()));
  const newAttrs = head.map((h, i) => ({ h, i })).filter(({ i }) => map[i] === 'new');
  const plan = body.filter((r) => val(r, 'name')).map((r) => ({ r, match: state.people.find((p) => p.email && p.email.toLowerCase() === val(r, 'email').toLowerCase()) }));
  const nameMissing = col('name') < 0;
  const run = () => {
    // New attribute columns become text attributes on People; new tags join the Tags options.
    const people = state.objects.find((o) => o.id === 'people');
    const seen = new Map<string, string>();
    const attrIds = newAttrs.map(() => newId('attr'));
    if (people && (newAttrs.length || newTags.length)) dispatch({ type: 'object/set', object: { ...people, attributes: [...people.attributes.map((a) => (a.id === 'tags' ? { ...a, options: [...(a.options ?? []), ...newTags.map((t) => ({ id: t, label: t, hue: 'gray' as const }))] } : a)), ...newAttrs.map(({ h }, n) => ({ id: attrIds[n] ?? newId('attr'), name: h, type: 'text' as const }))] } });
    const created: string[] = []; const newCos: string[] = []; const before: Array<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> = [];
    let updated = 0;
    const companyIds = new Map(state.companies.map((c) => [c.name.toLowerCase(), c.id]));
    if (newCompanies) unknownCompanies.forEach((name) => { const id = newId('c'); newCos.push(id); companyIds.set(name.toLowerCase(), id); dispatch({ type: 'company/set', company: { id, name, domain: '', industry: '', size: '', city: '', owner: state.me, created: new Date() } }); });
    plan.forEach(({ r, match }) => {
      const given = val(r, 'owner');
      const owner = given ? (owners[given] ?? (state.members.some((m) => m.name === given) ? given : state.me)) : undefined;
      // Tags are added to what someone already has, written the way the workspace already writes them.
      const canon = (t: string) => (people?.attributes.find((a) => a.id === 'tags')?.options ?? []).find((o) => o.label.toLowerCase() === t.toLowerCase())?.label ?? newTags.find((n) => n.toLowerCase() === t.toLowerCase()) ?? t;
      const fileTags = val(r, 'tags') ? val(r, 'tags').split(/;\s*/).filter(Boolean).map(canon) : undefined;
      const sameEmail = val(r, 'email') ? seen.get(val(r, 'email').toLowerCase()) : undefined;
      const match0 = match ?? (sameEmail ? { id: sameEmail } as unknown as typeof match : undefined);
      const tags = fileTags ? [...new Set([...((match?.tags) ?? []), ...fileTags])] : undefined;
      const lastContact = val(r, 'lastContact') ? readDate(val(r, 'lastContact'), dateOrder) : undefined;
      const extraNew = Object.fromEntries(newAttrs.map(({ i }, n) => [attrIds[n] ?? '', r[i] ?? '']).filter(([, v]) => v !== ''));
      // Only what the file actually says: a blank cell never clears what's already there.
      const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries({ name: val(r, 'name'), email: val(r, 'email'), title: val(r, 'title'), companyId: companyIds.get(val(r, 'company').toLowerCase()), owner, tags, lastContact, extra: Object.keys(extraNew).length ? { ...(match?.extra ?? {}), ...extraNew } : undefined }).filter(([, v]) => v !== '' && v !== undefined));
      if (!match && match0) return; // the same new email twice in one file: one person
      if (match) { updated++; before.push({ id: match.id, patch: Object.fromEntries(Object.keys(fields).map((k) => [k, (match as unknown as Readonly<Record<string, unknown>>)[k]])) }); dispatch({ type: 'records/fields', object: 'people', changes: [{ id: match.id, patch: fields }] }); }
      else { const id = newId('p'); created.push(id); if (val(r, 'email')) seen.set(val(r, 'email').toLowerCase(), id); dispatch({ type: 'person/set', person: { id, created: new Date(), name: val(r, 'name'), email: val(r, 'email'), title: val(r, 'title'), companyId: companyIds.get(val(r, 'company').toLowerCase()), owner: owner ?? state.me, tags: tags ?? [], lastContact, extra: Object.keys(extraNew).length ? extraNew : undefined } }); }
    });
    dispatch({ type: 'history/add', text: `${state.me} imported ${plural(created.length + updated, 'person', 'people')} from ${file?.name ?? 'a CSV'}` });
    setDone({ schemaBefore: people && (newAttrs.length || newTags.length) ? people : undefined, made: created.length, updated, created, newCompanies: newCos, before, skipped: body.filter((r) => !val(r, 'name')).map((r) => r.join(', ')) }); setStep(4);
  };
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>People</Button><span className="tf-rec__spacer" /><Steps steps={['File', 'Match columns', 'Fix values', 'Check', 'Done'].map((label, n) => ({ id: String(n), label }))} current={step} /></div>
      <section className="tf-bkf-card tf-imp__card">
        {step === 0 && <>
          <h2 className="tf-imp__h">Import people</h2>
          <p className="tf-rec__muted">A CSV from your old CRM or a spreadsheet. People already here are matched by email and updated, not doubled.</p>
          <FileDrop label="Drop a CSV here" description="Up to 10,000 rows" allowsMultiple={false} acceptedFileTypes={['text/csv']} onFiles={(files) => readCsv(files[0], toast, take)} />
          <Button variant="ghost" icon={<FileSpreadsheet size={14} strokeWidth={1.75} />} onPress={() => take('contacts-sample.csv', SAMPLE)}>Use a sample file</Button>
        </>}
        {step === 1 && <>
          <h2 className="tf-imp__h">Match columns</h2>
          <p className="tf-rec__muted">{file?.name} · {plural(body.length, 'row', 'rows')}. We matched what we could; check the rest. Blank cells never clear what’s already there.</p>
          {nameMissing && <Callout tone="warning">Pick which column holds the name. People need one.</Callout>}
          <ul className="tf-imp__map">
            {head.map((h, i) => (
              <li key={`${h}-${i}`}><span className="tf-imp__col"><strong>{h}</strong><span className="tf-rec__muted">{body.slice(0, 2).map((r) => r[i]).filter(Boolean).join(', ') || 'Empty'}</span></span>
                <span className="tf-imp__arrow" aria-hidden>→</span>
                <Select label={`${h} goes to`} isLabelHidden value={map[i] ?? 'skip'} onChange={(v) => setMap(map.map((m, j) => (j === i ? v ?? 'skip' : m === v && v !== 'skip' && v !== 'new' ? 'skip' : m)))} items={TARGETS} />
                {map[i] !== 'skip' && GUESS[h.toLowerCase()] === map[i] && <Tag size="sm" hue="green" icon={<Check size={12} strokeWidth={2} />}>Matched</Tag>}
              </li>
            ))}
          </ul>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => { setFile(undefined); setStep(0); }}>Choose another file</Button><Button variant="primary" isDisabled={nameMissing} onPress={() => setStep(2)}>Continue</Button></div>
        </>}
        {step === 2 && <>
          <h2 className="tf-imp__h">Fix values</h2>
          {unknownOwners.length + unknownCompanies.length + noEmail.length + newTags.length + newAttrs.length + (ambiguous ? 1 : 0) === 0 ? <p className="tf-rec__muted">Everything fits. Nothing to fix.</p> : <p className="tf-rec__muted">A few values don’t fit yet. Decide once; it applies to every row.</p>}
          {unknownOwners.map((o) => <div key={o} className="tf-imp__fix"><span><strong>Owner “{o}”</strong><span className="tf-rec__muted">Not a member here</span></span>
            <Select label={`Owner for ${o}`} isLabelHidden value={owners[o] ?? state.me} onChange={(v) => setOwners({ ...owners, [o]: v ?? state.me })} items={state.members.map((m) => ({ id: m.name, label: m.name }))} /></div>)}
          {unknownCompanies.length > 0 && <div className="tf-imp__fix"><span><strong>{unknownCompanies.length} new {unknownCompanies.length === 1 ? 'company' : 'companies'}</strong><span className="tf-rec__muted">{unknownCompanies.join(', ')}</span></span>
            <Select label="New companies" isLabelHidden value={newCompanies ? 'make' : 'skip'} onChange={(v) => setNewCompanies(v !== 'skip')} items={[{ id: 'make', label: 'Add them to Companies' }, { id: 'skip', label: 'Leave the company empty' }]} /></div>}
          {ambiguous && <div className="tf-imp__fix"><span><strong>Dates like 03/04/2026</strong><span className="tf-rec__muted">They can be read two ways. How does your file write them?</span></span>
            <Select label="Date order" isLabelHidden value={dateOrder} onChange={(v) => setDateOrder(v === 'mdy' ? 'mdy' : 'dmy')} items={[{ id: 'dmy', label: 'Day first (3 April)' }, { id: 'mdy', label: 'Month first (March 4)' }]} /></div>}
          {badDates > 0 && <div className="tf-imp__fix"><span><strong>{badDates} {badDates === 1 ? 'date doesn’t' : 'dates don’t'} read as a date</strong><span className="tf-rec__muted">Those cells are left empty; everything else on the row comes in.</span></span></div>}
          {newTags.length > 0 && <div className="tf-imp__fix"><span><strong>{newTags.length} new {newTags.length === 1 ? 'tag' : 'tags'}</strong><span className="tf-rec__muted">{newTags.join(', ')}: added as options of Tags</span></span></div>}
          {newAttrs.length > 0 && <div className="tf-imp__fix"><span><strong>{newAttrs.length} new {newAttrs.length === 1 ? 'attribute' : 'attributes'} on People</strong><span className="tf-rec__muted">{newAttrs.map(({ h }) => h).join(', ')}: text, named after the column. Change them in Settings › Objects.</span></span></div>}
          {noEmail.length > 0 && <div className="tf-imp__fix"><span><strong>{noEmail.length} {noEmail.length === 1 ? 'row has' : 'rows have'} no email</strong><span className="tf-rec__muted">They’re added as new people and can’t be matched later</span></span></div>}
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(1)}>Back</Button><Button variant="primary" onPress={() => setStep(3)}>Continue</Button></div>
        </>}
        {step === 3 && <>
          <h2 className="tf-imp__h">Check, then import</h2>
          <ul className="tf-imp__sum">
            <li><strong className="tf-num">{plan.filter((x) => !x.match).length}</strong> new {plan.filter((x) => !x.match).length === 1 ? 'person' : 'people'}</li>
            <li><strong className="tf-num">{plan.filter((x) => x.match).length}</strong> {plan.filter((x) => x.match).length === 1 ? 'person' : 'people'} updated, matched by email</li>
            {newCompanies && unknownCompanies.length > 0 && <li><strong className="tf-num">{unknownCompanies.length}</strong> new companies</li>}
            {body.length - plan.length > 0 && <li><strong className="tf-num">{body.length - plan.length}</strong> rows skipped: no name</li>}
          </ul>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(2)}>Back</Button><Button variant="primary" isDisabled={plan.length === 0} onPress={run}>{plan.length === 0 ? 'Nothing to import' : `Import ${plural(plan.length, 'person', 'people')}`}</Button></div>
        </>}
        {step === 4 && done && <>
          <h2 className="tf-imp__h">Imported</h2>
          <ul className="tf-imp__sum"><li><strong className="tf-num">{done.made}</strong> added</li><li><strong className="tf-num">{done.updated}</strong> updated</li>{done.skipped.length > 0 && <li><strong className="tf-num">{done.skipped.length}</strong> not imported (no name)</li>}</ul>
          <p className="tf-rec__muted">Undo takes it back now: new people go, and updated fields get their old values. Later it shows in Settings › History.</p>
          <div className="tf-imp__go">
            <Button variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onPress={() => { undoImport(dispatch, 'people', done, state.me); toast({ message: 'Import undone' }); onDone(); }}>Undo import</Button>
            <Button variant="primary" onPress={onDone}>See people</Button>
          </div>
        </>}
      </section>
    </div>
  );
}

const CO_SAMPLE = `Company,Website,Industry,City,Owner
Acme Corp,acme.com,Manufacturing,Pune,Priya Raman
Zylo,zylo.in,Software,Bengaluru,Sam Kim
Orbit Labs,orbit.dev,Software,Hyderabad,
Brightpath,brightpath.org,Education,Delhi,Ava Chen`;
const CO_GUESS: Readonly<Record<string, string>> = { company: 'name', name: 'name', website: 'domain', domain: 'domain', industry: 'industry', city: 'city', owner: 'owner' };
const CO_TARGETS = [{ id: 'name', label: 'Name' }, { id: 'domain', label: 'Domain' }, { id: 'industry', label: 'Industry' }, { id: 'city', label: 'City' }, { id: 'owner', label: 'Owner' }, { id: 'skip', label: 'Don’t import' }];

/** Companies import: the same steps, matched by domain. */
function CompanyImport({ state, dispatch, onDone }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReadonlyArray<ReadonlyArray<string>>>();
  const [map, setMap] = useState<ReadonlyArray<string>>([]);
  const [done, setDone] = useState<ImportUndo>();
  const head = rows?.[0] ?? []; const body = rows?.slice(1) ?? [];
  const v = (r: ReadonlyArray<string>, id: string) => (map.indexOf(id) >= 0 ? r[map.indexOf(id)] ?? '' : '');
  const plan = body.filter((r) => v(r, 'name')).map((r) => ({ r, match: state.companies.find((c) => (v(r, 'domain') && c.domain === v(r, 'domain')) || c.name.toLowerCase() === v(r, 'name').toLowerCase()) }));
  const take = (_name: string, text: string) => { const p = parse(text); setRows(p); setMap((p[0] ?? []).map((h) => CO_GUESS[h.toLowerCase()] ?? 'skip')); };
  const step = done ? 4 : rows ? 1 : 0;
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>Companies</Button><span className="tf-rec__spacer" /><Steps steps={['File', 'Match and check', 'Done'].map((label, n) => ({ id: String(n), label }))} current={step === 4 ? 2 : step} /></div>
      <section className="tf-bkf-card tf-imp__card">
        {step === 0 && <><h2 className="tf-imp__h">Import companies</h2><p className="tf-rec__muted">Matched by website domain, so companies already here are updated, not doubled.</p>
          <FileDrop label="Drop a CSV here" allowsMultiple={false} acceptedFileTypes={['text/csv']} onFiles={(f) => readCsv(f[0], toast, take)} />
          <Button variant="ghost" icon={<FileSpreadsheet size={14} strokeWidth={1.75} />} onPress={() => take('companies-sample.csv', CO_SAMPLE)}>Use a sample file</Button></>}
        {step === 1 && <><h2 className="tf-imp__h">Match columns</h2>
          <ul className="tf-imp__map">{head.map((h, i) => <li key={`${h}-${i}`}><span className="tf-imp__col"><strong>{h}</strong><span className="tf-rec__muted">{body.slice(0, 2).map((r) => r[i]).filter(Boolean).join(', ') || 'Empty'}</span></span><span className="tf-imp__arrow" aria-hidden>→</span>
            <Select label={`${h} goes to`} isLabelHidden value={map[i] ?? 'skip'} onChange={(x) => setMap(map.map((m, j) => (j === i ? x ?? 'skip' : m)))} items={CO_TARGETS} /><span /></li>)}</ul>
          <p className="tf-rec__muted tf-num">{plan.filter((x) => !x.match).length} new · {plan.filter((x) => x.match).length} updated · {body.length - plan.length} skipped (no name)</p>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setRows(undefined)}>Back</Button><Button variant="primary" isDisabled={map.indexOf('name') < 0 || plan.length === 0} onPress={() => {
            const created: string[] = []; const before: Array<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> = []; let updated = 0;
            plan.forEach(({ r, match }) => {
              const owner = state.members.some((m) => m.name === v(r, 'owner')) ? v(r, 'owner') : state.me;
              if (match) {
                const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries({ domain: v(r, 'domain'), industry: v(r, 'industry'), city: v(r, 'city') }).filter(([, x]) => x !== ''));
                updated++; before.push({ id: match.id, patch: Object.fromEntries(Object.keys(fields).map((k) => [k, (match as unknown as Readonly<Record<string, unknown>>)[k]])) }); dispatch({ type: 'records/fields', object: 'companies', changes: [{ id: match.id, patch: fields }] });
              } else { const id = newId('c'); created.push(id); dispatch({ type: 'company/set', company: { id, name: v(r, 'name'), domain: v(r, 'domain'), industry: v(r, 'industry'), size: '', city: v(r, 'city'), owner, created: new Date() } }); }
            });
            dispatch({ type: 'history/add', text: `${state.me} imported ${plural(created.length + updated, 'company', 'companies')}` }); setDone({ made: created.length, updated, created, newCompanies: [], before, skipped: [] });
          }}>{plan.length === 0 ? 'Nothing to import' : `Import ${plural(plan.length, 'company', 'companies')}`}</Button></div></>}
        {step === 4 && done && <><h2 className="tf-imp__h">Imported</h2><p className="tf-num">{done.made} added · {done.updated} updated</p><p className="tf-rec__muted">Undo takes it back now. Later it shows in Settings › History.</p>
          <div className="tf-imp__go"><Button variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onPress={() => { undoImport(dispatch, 'companies', done, state.me); toast({ message: 'Import undone' }); onDone(); }}>Undo import</Button><Button variant="primary" onPress={onDone}>See companies</Button></div></>}
      </section>
    </div>
  );
}
