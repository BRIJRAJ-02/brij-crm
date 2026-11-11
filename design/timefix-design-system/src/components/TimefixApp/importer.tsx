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
import { type ObjectSchema, newId, type AppAction, type AppState, type ImportJob, type ObjectId, type Person } from './data.ts';
import { RecordImport, ImportPolicies, PreviewRows, downloadErrors, type RowLine } from './import2.tsx';

const SAMPLE = `Full name,Email address,Company,Role,Owner,Tags
Leah Ortega,leah@acme.com,Acme Corp,Plant manager,Priya Raman,Champion
Noor Haddad,noor@globex.io,Globex,CTO,Sam Kim,Technical
Ken Adams,ken@newco.ai,NewCo,Founder,Jo M.,Decision maker
Rita Das,,Initech,Analyst,,
Omar Said,omar@zylo.in,Zylo,Ops lead,Ava Chen,`;

const TARGETS = [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'company', label: 'Company' }, { id: 'title', label: 'Job title' }, { id: 'owner', label: 'Owner' }, { id: 'tags', label: 'Tags' }, { id: 'lastContact', label: 'Last contact (a date)' }, { id: 'new', label: 'A new attribute' }, { id: 'skip', label: 'Don’t import' }];
const GUESS: Readonly<Record<string, string>> = { 'full name': 'name', name: 'name', email: 'email', 'email address': 'email', phone: 'phone', mobile: 'phone', company: 'company', organisation: 'company', role: 'title', title: 'title', 'job title': 'title', owner: 'owner', tags: 'tags', 'last contact': 'lastContact', 'last contacted': 'lastContact' };
/** Reads a date cell: ISO, or day/month/year (or month/day/year when asked). */
const readDate = (v: string, order: 'dmy' | 'mdy'): Date | undefined => {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v); if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v.trim()); if (!m) return undefined;
  const [a, b] = order === 'dmy' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])]; const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? new Date(y, b - 1, a) : undefined;
};

/** Splits a CSV into rows: quoted cells may hold commas, line breaks and doubled quotes (""). */
export function parse(text: string): ReadonlyArray<ReadonlyArray<string>> {
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
export interface ImportUndo { /** People's attributes before the import, when it added attributes or tag options. */ readonly schemaBefore?: ObjectSchema; readonly made: number; readonly updated: number; readonly skipped: ReadonlyArray<string>; readonly created: ReadonlyArray<string>; readonly newCompanies: ReadonlyArray<string>; readonly before: ReadonlyArray<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> }
/** Takes an import back: new records go, updated fields get their old values, added attributes come off. */
export const undoImport = (dispatch: (a: AppAction) => void, object: ObjectId, u: ImportUndo, me: string) => {
  dispatch({ type: 'records/drop', object, ids: u.created, note: `${me} undid an import` });
  if (u.newCompanies.length) dispatch({ type: 'records/drop', object: 'companies', ids: u.newCompanies });
  if (u.before.length) dispatch({ type: 'records/fields', object, changes: u.before });
  if (u.schemaBefore) dispatch({ type: 'object/set', object: u.schemaBefore });
};
/** Reads a dropped file: CSV only (any case), with a plain message when it can't. */
export const readCsv = (f: File | undefined, toast: (t: { readonly message: string; readonly tone?: 'danger' }) => void, then: (name: string, text: string) => void) => {
  if (!f) return;
  if (!/\.csv$/i.test(f.name)) { toast({ message: 'Save it as CSV first: in Excel, File › Save As › CSV.' }); return; }
  f.text().then((t) => (t.trim() ? then(f.name, t) : toast({ message: `${f.name} is empty.`, tone: 'danger' })), () => toast({ message: `Couldn’t read ${f.name}. Try saving it again.`, tone: 'danger' }));
};

/** Props for ImportScreen. */
export interface ImportScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onDone: () => void; /** Any object; People has its own steps (owners, new companies, tags, dates). */ readonly object?: ObjectId; /** Opens this import's details in Settings › Imports and exports. */ readonly onJob?: (id: string) => void }

/** The People import. */
export function ImportScreen({ state, dispatch, onDone, object = 'people', onJob }: ImportScreenProps) {
  if (object !== 'people') return <RecordImport state={state} dispatch={dispatch} object={object} onDone={onDone} onJob={onJob} />;
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<{ readonly name: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> }>();
  const [map, setMap] = useState<ReadonlyArray<string>>([]);
  const [owners, setOwners] = useState<Readonly<Record<string, string>>>({});
  const [newCompanies, setNewCompanies] = useState(true);
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [done, setDone] = useState<ImportUndo>();
  const [jobId, setJobId] = useState<string>();
  const [matchBy, setMatchBy] = useState<'email' | 'phone' | 'name'>('email');
  const [onMatch, setOnMatch] = useState<'fill' | 'overwrite' | 'skip'>('overwrite');
  const [onNew, setOnNew] = useState<'create' | 'skip'>('create');
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
  const keyOf = (r: ReadonlyArray<string>) => (matchBy === 'email' ? val(r, 'email') : matchBy === 'name' ? val(r, 'name') : val(r, 'phone' as string)).trim().toLowerCase();
  const findMatch = (r: ReadonlyArray<string>) => { const k = keyOf(r); if (!k) return undefined; return state.people.find((p) => (matchBy === 'email' ? p.email : matchBy === 'name' ? p.name : p.phone ?? '').toLowerCase() === k); };
  const badMail = (r: ReadonlyArray<string>) => val(r, 'email') !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val(r, 'email'));
  const plan = body.filter((r) => val(r, 'name') && !badMail(r)).map((r) => ({ r, match: findMatch(r) })).filter((x) => (x.match ? onMatch !== 'skip' : onNew === 'create'));
  // Each row as the Check step shows it: what happens, why not, and who it looks like.
  const lines: ReadonlyArray<RowLine> = body.map((r, n) => {
    const name = val(r, 'name'); const m = findMatch(r);
    const twin = !m ? state.people.find((p) => p.name.toLowerCase() === name.toLowerCase() || (val(r, 'email') && p.email.toLowerCase() === val(r, 'email').toLowerCase())) : undefined;
    if (!name) return { row: n + 2, name: '', result: 'error', reason: 'No name', cells: r };
    if (badMail(r)) return { row: n + 2, name, result: 'error', reason: `“${val(r, 'email')}” isn’t an email address`, cells: r };
    if (m) return { row: n + 2, name, result: onMatch === 'skip' ? 'skipped' : 'updated', reason: onMatch === 'skip' ? `Matches ${m.name}` : `Matches ${m.name}${onMatch === 'fill' ? ', fills empty fields' : ''}`, cells: r };
    if (onNew === 'skip') return { row: n + 2, name, result: 'skipped', reason: 'No match', cells: r };
    return { row: n + 2, name, result: 'added', reason: twin ? `Looks like ${twin.name}` : undefined, twin: Boolean(twin), cells: r };
  });
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
      const fields: Record<string, unknown> = Object.fromEntries(Object.entries({ name: val(r, 'name'), email: val(r, 'email'), phone: val(r, 'phone') || undefined, title: val(r, 'title'), companyId: companyIds.get(val(r, 'company').toLowerCase()), owner, tags, lastContact, extra: Object.keys(extraNew).length ? { ...(match?.extra ?? {}), ...extraNew } : undefined }).filter(([, v]) => v !== '' && v !== undefined));
      if (!match && match0) return; // the same new email twice in one file: one person
      // "Fill empty fields" keeps what's there and only fills the gaps.
      if (match && onMatch === 'fill') { const cur = match as unknown as Readonly<Record<string, unknown>>; const kept = Object.fromEntries(Object.entries(fields).filter(([k, v]) => k === 'tags' || k === 'extra' || cur[k] === undefined || cur[k] === '' || (Array.isArray(cur[k]) && (cur[k] as ReadonlyArray<unknown>).length === 0 && v !== undefined))); Object.keys(fields).forEach((k) => { if (!(k in kept)) delete (fields as Record<string, unknown>)[k]; }); }
      if (match) { updated++; before.push({ id: match.id, patch: Object.fromEntries(Object.keys(fields).map((k) => [k, (match as unknown as Readonly<Record<string, unknown>>)[k]])) }); dispatch({ type: 'records/fields', object: 'people', changes: [{ id: match.id, patch: fields }] }); }
      else { const id = newId('p'); created.push(id); if (val(r, 'email')) seen.set(val(r, 'email').toLowerCase(), id); dispatch({ type: 'person/set', person: { id, created: new Date(), name: val(r, 'name'), email: val(r, 'email'), phone: val(r, 'phone') || undefined, title: val(r, 'title'), companyId: companyIds.get(val(r, 'company').toLowerCase()), owner: owner ?? state.me, tags: tags ?? [], lastContact, extra: Object.keys(extraNew).length ? extraNew : undefined } }); }
    });
    dispatch({ type: 'history/add', text: `${state.me} imported ${plural(created.length + updated, 'person', 'people')} from ${file?.name ?? 'a CSV'}` });
    const jid = newId('jb'); setJobId(jid);
    const job: ImportJob = { id: jid, kind: 'import', what: `People from ${file?.name ?? 'a CSV'}`, rows: created.length + updated, by: state.me, at: new Date(), name: file?.name, object: 'people', made: created.length, updated, skipped: lines.filter((l) => l.result !== 'added' && l.result !== 'updated').length,
      lines: lines.map(({ row, name, result, reason }) => ({ row, name, result, reason })), undo: { created, before, newCompanies: newCos } };
    dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: [job, ...(q.jobs ?? [])] }) });
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
          <ImportPolicies keys={[{ id: 'email', label: 'Email' }, ...(col('phone' as string) >= 0 ? [{ id: 'phone', label: 'Phone' }] : []), { id: 'name', label: 'Name' }]} matchBy={matchBy} onMatchBy={(v) => setMatchBy(v === 'name' ? 'name' : v === 'phone' ? 'phone' : 'email')} onMatch={onMatch} onMatchChange={setOnMatch} onNew={onNew} onNewChange={setOnNew} />
          <PreviewRows lines={lines} onDownload={() => downloadErrors(file?.name ?? 'people.csv', head, lines, toast)} />
          <ul className="tf-imp__sum">
            <li><strong className="tf-num">{plan.filter((x) => !x.match).length}</strong> new {plan.filter((x) => !x.match).length === 1 ? 'person' : 'people'}</li>
            <li><strong className="tf-num">{plan.filter((x) => x.match).length}</strong> {plan.filter((x) => x.match).length === 1 ? 'person' : 'people'} updated, matched by {matchBy}</li>
            {newCompanies && unknownCompanies.length > 0 && <li><strong className="tf-num">{unknownCompanies.length}</strong> new companies</li>}
            {body.length - plan.length > 0 && <li><strong className="tf-num">{body.length - plan.length}</strong> rows not imported</li>}
          </ul>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(2)}>Back</Button><Button variant="primary" isDisabled={plan.length === 0} onPress={run}>{plan.length === 0 ? 'Nothing to import' : `Import ${plural(plan.length, 'person', 'people')}`}</Button></div>
        </>}
        {step === 4 && done && <>
          <h2 className="tf-imp__h">Imported</h2>
          <ul className="tf-imp__sum"><li><strong className="tf-num">{done.made}</strong> added</li><li><strong className="tf-num">{done.updated}</strong> updated</li>{done.skipped.length > 0 && <li><strong className="tf-num">{done.skipped.length}</strong> not imported (no name)</li>}</ul>
          <p className="tf-rec__muted">Undo takes it back: new people go, and updated fields get their old values. It stays open for 7 days in Settings › Imports and exports.</p>
          <div className="tf-imp__go">
            {jobId && onJob && <Button variant="ghost" onPress={() => onJob(jobId)}>See rows and errors</Button>}
            <Button variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onPress={() => { undoImport(dispatch, 'people', done, state.me); if (jobId) dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: (q.jobs ?? []).map((j) => (j.id === jobId ? { ...j, undone: true } : j)) }) }); toast({ message: 'Import undone' }); onDone(); }}>Undo import</Button>
            <Button variant="primary" onPress={onDone}>See people</Button>
          </div>
        </>}
      </section>
    </div>
  );
}

