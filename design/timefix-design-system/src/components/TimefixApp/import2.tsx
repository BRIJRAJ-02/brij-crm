// Import a CSV into Companies, Deals or an owner-made object: a file (or a sample), match columns, then check what will happen: which field
// matches rows to records, what a match does (fill empty fields, overwrite, skip) and what a new row does (create, skip), each row's result
// with its error or likely duplicate, the error rows as a CSV. The import keeps its rows and Undo for 7 days in Settings › Imports and exports.
import { useState } from 'react';
import { ArrowLeft, Check, Download, FileSpreadsheet, Undo2 } from 'lucide-react';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { Steps } from '../Steps/Steps.tsx';
import { Select } from '../Select/Select.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { newId, type AnyRecord, type AppAction, type AppState, type ImportJob, type ObjectId } from './data.ts';
import { blankCustom, dayOf, liveAttributes, ownFields, patchFor, recordsOf, schemaOf, stagesOf, wordsOf, type FieldDef } from './model.tsx';
import { parse, readCsv, undoImport, type ImportUndo } from './importer.tsx';

/** One row of a file as the Check step and the import's details show it. */
export interface RowLine { readonly row: number; readonly name: string; readonly result: 'added' | 'updated' | 'skipped' | 'error'; readonly reason?: string; readonly twin?: boolean; readonly cells: ReadonlyArray<string> }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The error and skipped rows as a CSV: the file's own columns, then why. */
export function downloadErrors(name: string, head: ReadonlyArray<string>, lines: ReadonlyArray<RowLine>, toast: (t: { readonly message: string; readonly tone?: 'success' }) => void) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const bad = lines.filter((l) => l.result === 'error' || l.result === 'skipped');
  const csv = [[...head, 'Why not imported'].map(esc).join(','), ...bad.map((l) => [...l.cells, l.reason ?? ''].map((c) => esc(String(c))).join(','))].join('\n');
  void saveFile(`${name.replace(/\.csv$/i, '')}-errors.csv`, new Blob([csv], { type: 'text/csv' })).then((o) => { if (o === 'saved') toast({ message: `${plural(bad.length, 'row', 'rows')} with errors downloaded`, tone: 'success' }); });
}

/** Which field finds a record, and what a match or a new row does. */
export function ImportPolicies({ keys, matchBy, onMatchBy, onMatch, onMatchChange, onNew, onNewChange }: {
  readonly keys: ReadonlyArray<{ readonly id: string; readonly label: string }>; readonly matchBy: string; readonly onMatchBy: (v: string) => void;
  readonly onMatch: 'fill' | 'overwrite' | 'skip'; readonly onMatchChange: (v: 'fill' | 'overwrite' | 'skip') => void; readonly onNew: 'create' | 'skip'; readonly onNewChange: (v: 'create' | 'skip') => void;
}) {
  return (
    <div className="tf-imp__policies">
      <Select label="Match rows to records by" value={matchBy} onChange={(v) => v && onMatchBy(v)} items={keys} />
      <Select label="When a row matches" value={onMatch} onChange={(v) => onMatchChange(v === 'fill' ? 'fill' : v === 'skip' ? 'skip' : 'overwrite')} items={[{ id: 'fill', label: 'Fill empty fields only' }, { id: 'overwrite', label: 'Overwrite with the file' }, { id: 'skip', label: 'Skip the row' }]} />
      <Select label="When nothing matches" value={onNew} onChange={(v) => onNewChange(v === 'skip' ? 'skip' : 'create')} items={[{ id: 'create', label: 'Create a record' }, { id: 'skip', label: 'Skip the row' }]} />
    </div>
  );
}

/** Each row's result, its error, and a likely duplicate; the first 50 rows, with the errors downloadable. */
export function PreviewRows({ lines, onDownload }: { readonly lines: ReadonlyArray<RowLine>; readonly onDownload: () => void }) {
  const bad = lines.filter((l) => l.result === 'error').length; const twins = lines.filter((l) => l.twin).length;
  return (
    <section className="tf-imp__preview" aria-label="Rows">
      <div className="tf-imp__previewhead">
        <span className="tf-rec__muted tf-num">{plural(lines.length, 'row', 'rows')}{bad ? ` · ${plural(bad, 'error', 'errors')}` : ''}{twins ? ` · ${plural(twins, 'likely duplicate', 'likely duplicates')}` : ''}</span>
        {lines.some((l) => l.result === 'error' || l.result === 'skipped') && <Button size="sm" variant="ghost" icon={<Download size={14} strokeWidth={1.75} />} onPress={onDownload}>Download rows with errors</Button>}
      </div>
      <ul className="tf-set__list tf-imp__lines">
        {lines.slice(0, 50).map((l) => (
          <li key={l.row}><span><span className="tf-rec__muted tf-num">Row {l.row}</span> <strong>{l.name || 'No name'}</strong>{l.reason ? <span className="tf-rec__muted"> · {l.reason}</span> : null}</span>
            <Tag size="sm" hue={l.result === 'error' ? 'red' : l.twin ? 'orange' : l.result === 'added' ? 'green' : l.result === 'updated' ? 'blue' : 'gray'}>{l.result === 'error' ? 'Error' : l.twin ? 'Likely duplicate' : l.result === 'added' ? 'New' : l.result === 'updated' ? 'Update' : 'Skip'}</Tag></li>
        ))}
      </ul>
      {lines.length > 50 && <p className="tf-rec__muted">And {lines.length - 50} more rows.</p>}
    </section>
  );
}

/** A small sample file for each object, with one row that needs fixing so the checks show. */
function sampleFor(state: AppState, object: ObjectId): string {
  if (object === 'companies') return `Company,Website,Industry,City,Owner\nAcme Corp,acme.com,Manufacturing,Pune,Priya Raman\nZylo,zylo.in,Software,Bengaluru,Sam Kim\nOrbit Labs,orbit.dev,Software,Hyderabad,\nBrightpath,brightpath.org,Education,Delhi,Ava Chen\n,nameless.io,Retail,Chennai,`;
  if (object === 'deals') return `Deal,Company,Stage,Amount,Close date,Owner\nAcme rollout 400 seats,Acme Corp,Proposal,1900000,2026-12-20,Priya Raman\nZylo starter,Globex,Lead,150000,2027-01-15,Sam Kim\nHooli renewal,Hooli,Closing,800000,2026-12-30,\nNew venture,Nowhere Ltd,Lead,90000,2027-02-01,Ava Chen`;
  const attrs = liveAttributes(schemaOf(state, object)).filter((a) => a.id !== 'name' && a.id !== 'created' && !a.computed && !a.relation).slice(0, 3);
  const cell = (t: string, n: number) => (t === 'number' || t === 'currency' ? String(1000 * (n + 1)) : t === 'date' ? `2026-12-${String(10 + n).padStart(2, '0')}` : t === 'checkbox' ? 'true' : `Value ${n + 1}`);
  const w = wordsOf(state, object);
  return [['Name', ...attrs.map((a) => a.name), 'Owner'].join(','), ...[0, 1, 2].map((n) => [`${w.One} ${['North', 'South', 'East'][n]}`, ...attrs.map((a) => (a.options?.[n % (a.options.length || 1)]?.label ?? cell(a.type, n))), ['Priya Raman', 'Sam Kim', ''][n]].join(','))].join('\n');
}

/** Companies, Deals and owner-made objects: the same steps as People, matched by the field you pick. */
export function RecordImport({ state, dispatch, object, onDone, onJob }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly object: ObjectId; readonly onDone: () => void; readonly onJob?: (id: string) => void }) {
  const { toast } = useToast();
  const w = wordsOf(state, object);
  const fields = ownFields(state, object).filter((f) => (!f.readOnly || f.id === 'company') && f.id !== 'created' && !f.attribute?.computed && !f.attribute?.relation);
  const [file, setFile] = useState<{ readonly name: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> }>();
  const [map, setMap] = useState<ReadonlyArray<string>>([]);
  const [step, setStep] = useState(0);
  const keys = fields.filter((f) => f.id === 'name' || f.id === 'domain' || f.id === 'email' || f.attribute?.isUnique).map((f) => ({ id: f.id, label: f.name }));
  const [matchBy, setMatchBy] = useState(keys.find((k) => k.id === 'domain')?.id ?? keys.find((k) => k.id !== 'name')?.id ?? 'name');
  const [onMatch, setOnMatch] = useState<'fill' | 'overwrite' | 'skip'>('fill');
  const [onNew, setOnNew] = useState<'create' | 'skip'>('create');
  const [done, setDone] = useState<{ readonly undo: ImportUndo; readonly jobId: string }>();
  const head = file?.rows[0] ?? []; const body = file?.rows.slice(1) ?? [];
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
  const alias: Readonly<Record<string, string>> = { company: object === 'companies' ? 'name' : 'company', website: 'domain', deal: 'name', dealname: 'name', value: 'amount', closedate: 'close', closes: 'close' };
  const guess = (h: string) => fields.find((f) => norm(f.name) === norm(h) || f.id === norm(h) || norm(f.name).replace(/[^a-z]/g, '') === norm(h))?.id ?? (alias[norm(h)] && fields.some((f) => f.id === alias[norm(h)]) ? alias[norm(h)] : undefined) ?? 'skip';
  const take = (name: string, text: string) => { const rows = parse(text); setFile({ name, rows }); setMap((rows[0] ?? []).map(guess)); setStep(1); };
  const v = (r: ReadonlyArray<string>, id: string) => (map.indexOf(id) >= 0 ? (r[map.indexOf(id)] ?? '').trim() : '');
  const field = (id: string): FieldDef | undefined => fields.find((f) => f.id === id);
  const valueOfRec = (rec: AnyRecord, id: string) => { const r = rec as AnyRecord & Readonly<Record<string, unknown>>; return id === 'domain' || id === 'name' || id === 'email' ? String(r[id] ?? '') : rec.extra?.[id] ?? ''; };
  const findMatch = (r: ReadonlyArray<string>) => { const k = v(r, matchBy).toLowerCase(); return k ? recordsOf(state, object).find((x) => valueOfRec(x, matchBy).toLowerCase() === k) : undefined; };
  /** A cell's value as the field takes it, or why it can't. Choices match by their label. */
  const read = (id: string, raw: string): { readonly value?: string; readonly error?: string } => {
    const f = field(id); if (!f || !raw) return { value: raw };
    if (id === 'company') { const c = state.companies.find((x) => x.name.toLowerCase() === raw.toLowerCase()); return c ? { value: c.id } : { error: `No company called ${raw}` }; }
    if (id === 'owner') { const m = state.members.find((x) => x.name.toLowerCase() === raw.toLowerCase() || x.name.split(' ')[0]?.toLowerCase() === raw.toLowerCase()); return m ? { value: m.name } : { value: state.me }; }
    if (id === 'stage') { const st = stagesOf(state).find((x) => x.label.toLowerCase() === raw.toLowerCase()); return st ? { value: st.id } : { error: `“${raw}” isn’t a stage` }; }
    if (f.type === 'number' || f.type === 'currency' || f.type === 'percent' || f.type === 'rating') { const n = Number(raw.replace(/[^\d.-]/g, '')); return Number.isNaN(n) || raw.replace(/[^\d]/g, '') === '' ? { error: `${f.name} “${raw}” isn’t a number` } : { value: String(n) }; }
    if (f.type === 'date') { const d = dayOf(raw) ?? (() => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw); return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : undefined; })(); return d ? { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } : { error: `${f.name} “${raw}” isn’t a date` }; }
    if ((f.type === 'select' || f.type === 'status') && f.options) { const o = f.options.find((x) => x.label.toLowerCase() === raw.toLowerCase() || x.id === raw); return o ? { value: o.id } : object === 'companies' && id === 'industry' ? { value: raw } : { error: `“${raw}” isn’t one of ${f.name}’s options` }; }
    if (f.type === 'multiSelect' && f.options) return { value: raw.split(/[;,]\s*/).map((x) => f.options?.find((o) => o.label.toLowerCase() === x.toLowerCase())?.id ?? x).join(', ') };
    if (f.type === 'checkbox') return { value: /^(yes|true|1|y)$/i.test(raw) ? 'true' : '' };
    return { value: raw };
  };
  const plan = body.map((r, n) => {
    const name = v(r, 'name'); const match = findMatch(r);
    const vals = Object.fromEntries(map.map((id, i) => [id, i]).filter(([id]) => id !== 'skip').map(([id, i]) => [id as string, read(id as string, (r[i as number] ?? '').trim())]));
    const err = !name && !match ? 'No name' : object === 'deals' && !match && !vals.company?.value ? (vals.company?.error ?? 'No company') : Object.values(vals).find((x) => x.error)?.error;
    const twin = !match && name ? recordsOf(state, object).find((x) => norm(x.name) === norm(name)) : undefined;
    const line: RowLine = err ? { row: n + 2, name, result: 'error', reason: err, cells: r }
      : match ? { row: n + 2, name: name || match.name, result: onMatch === 'skip' ? 'skipped' : 'updated', reason: `Matches ${match.name}${onMatch === 'fill' ? ', fills empty fields' : ''}`, cells: r }
      : onNew === 'skip' ? { row: n + 2, name, result: 'skipped', reason: 'No match', cells: r }
      : { row: n + 2, name, result: 'added', reason: twin ? `Looks like ${twin.name}` : undefined, twin: Boolean(twin), cells: r };
    return { r, match, vals, line };
  });
  const lines = plan.map((x) => x.line);
  const go = plan.filter((x) => x.line.result === 'added' || x.line.result === 'updated');
  const run = () => {
    const created: string[] = []; const before: Array<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> = []; let updated = 0;
    go.forEach(({ match, vals, line }) => {
      const entries = Object.entries(vals).filter(([, x]) => x.value !== undefined && x.value !== '').map(([k, x]) => [k, x.value ?? ''] as const);
      if (match) {
        const keep = onMatch === 'fill' ? entries.filter(([k]) => { const cur = (match as AnyRecord & Readonly<Record<string, unknown>>)[k === 'company' ? 'companyId' : k]; const ex = match.extra?.[k]; return field(k)?.custom ? !ex : cur === undefined || cur === '' || cur === 0; }) : entries;
        const patch = keep.reduce<Record<string, unknown>>((p, [k, val]) => { const x = patchFor(state, object, match, k, val); return x ? { ...p, ...x, ...(x.extra ? { extra: { ...(p.extra as object | undefined), ...(x.extra as object) } } : {}) } : p; }, {});
        if (Object.keys(patch).length === 0) return;
        const was = Object.fromEntries(Object.keys(patch).map((k) => [k, k === 'extra' ? Object.fromEntries(Object.keys(patch.extra as object).map((e) => [e, match.extra?.[e] ?? ''])) : (match as AnyRecord & Readonly<Record<string, unknown>>)[k]]));
        updated++; before.push({ id: match.id, patch: was });
        dispatch({ type: 'records/fields', object, changes: [{ id: match.id, patch }] });
      } else {
        const id = newId(object.slice(0, 1)); const get = (k: string) => vals[k]?.value ?? '';
        const owner = get('owner') || state.me;
        const base = object === 'companies' ? { id, name: line.name, domain: get('domain'), industry: get('industry'), size: get('size'), city: get('city'), owner, created: new Date() }
          : object === 'deals' ? { id, name: line.name, companyId: get('company'), stage: get('stage') || (stagesOf(state)[0]?.id ?? 'Lead'), amount: Number(get('amount')) || 0, owner, close: dayOf(get('close')) ?? new Date(Date.now() + 30 * 86_400_000), created: new Date(), stageAt: new Date() }
          : blankCustom(id, line.name, owner);
        const rec = entries.filter(([k]) => !['name', 'owner', 'domain', 'industry', 'size', 'city', 'company', 'stage', 'amount', 'close'].includes(k)).reduce<Record<string, unknown>>((p, [k, val]) => { const x = patchFor(state, object, base as never, k, val); return x ? { ...p, ...x, ...(x.extra ? { extra: { ...(p.extra as object | undefined), ...(x.extra as object) } } : {}) } : p; }, { ...base });
        created.push(id);
        if (object === 'companies') dispatch({ type: 'company/set', company: rec as never }); else if (object === 'deals') dispatch({ type: 'deal/set', deal: rec as never });
        else dispatch({ type: 'custom/set', object, record: { ...(rec as never as ReturnType<typeof blankCustom>), extra: (rec.extra as Readonly<Record<string, string>> | undefined) ?? {} } });
      }
    });
    const jobId = newId('jb');
    const job: ImportJob = { id: jobId, kind: 'import', what: `${w.Many} from ${file?.name ?? 'a CSV'}`, rows: created.length + updated, by: state.me, at: new Date(), name: file?.name, object, made: created.length, updated, skipped: lines.length - go.length, lines: lines.map(({ row, name, result, reason }) => ({ row, name, result, reason })), undo: { created, before } };
    dispatch({ type: 'history/add', text: `${state.me} imported ${plural(created.length + updated, w.one, w.many)} from ${file?.name ?? 'a CSV'}` });
    dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: [job, ...(q.jobs ?? [])] }) });
    setDone({ jobId, undo: { made: created.length, updated, skipped: [], created, newCompanies: [], before } }); setStep(3);
  };
  const nameMissing = map.indexOf('name') < 0 && map.indexOf(matchBy) < 0;
  return (
    <div className="tf-imp">
      <div className="tf-rec__bar"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>{w.Many}</Button><span className="tf-rec__spacer" /><Steps steps={['File', 'Match columns', 'Check', 'Done'].map((label, n) => ({ id: String(n), label }))} current={step} /></div>
      <section className="tf-bkf-card tf-imp__card">
        {step === 0 && <>
          <h2 className="tf-imp__h">Import {w.many}</h2>
          <p className="tf-rec__muted">A CSV from a spreadsheet or another tool. You pick how rows find {w.many} already here, so nothing is doubled.</p>
          <FileDrop label="Drop a CSV here" description="Up to 10,000 rows" allowsMultiple={false} acceptedFileTypes={['text/csv']} onFiles={(f) => readCsv(f[0], toast, take)} />
          <span className="tf-set__row">
            <Button variant="ghost" icon={<FileSpreadsheet size={14} strokeWidth={1.75} />} onPress={() => take(`${w.many}-sample.csv`, sampleFor(state, object))}>Use a sample file</Button>
            <Button variant="ghost" icon={<Download size={14} strokeWidth={1.75} />} onPress={() => { void saveFile(`${w.many}-sample.csv`, new Blob([sampleFor(state, object)], { type: 'text/csv' })).then((o) => { if (o === 'saved') toast({ message: 'Sample CSV downloaded', tone: 'success' }); }); }}>Download a sample CSV</Button>
          </span>
        </>}
        {step === 1 && <>
          <h2 className="tf-imp__h">Match columns</h2>
          <p className="tf-rec__muted">{file?.name} · {plural(body.length, 'row', 'rows')}. We matched what we could; check the rest. Blank cells never clear what’s already there.</p>
          {nameMissing && <Callout tone="warning">Pick which column holds the name. {w.Many} need one.</Callout>}
          <ul className="tf-imp__map">
            {head.map((h, i) => (
              <li key={`${h}-${i}`}><span className="tf-imp__col"><strong>{h}</strong><span className="tf-rec__muted">{body.slice(0, 2).map((r) => r[i]).filter(Boolean).join(', ') || 'Empty'}</span></span>
                <span className="tf-imp__arrow" aria-hidden>→</span>
                <Select label={`${h} goes to`} isLabelHidden value={map[i] ?? 'skip'} onChange={(x) => setMap(map.map((m, j) => (j === i ? x ?? 'skip' : m === x && x !== 'skip' ? 'skip' : m)))} items={[...fields.map((f) => ({ id: f.id, label: f.name })), { id: 'skip', label: 'Don’t import' }]} />
                {map[i] !== 'skip' && guess(h) === map[i] ? <Tag size="sm" hue="green" icon={<Check size={12} strokeWidth={2} />}>Matched</Tag> : <span />}
              </li>
            ))}
          </ul>
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => { setFile(undefined); setStep(0); }}>Choose another file</Button><Button variant="primary" isDisabled={nameMissing} onPress={() => setStep(2)}>Continue</Button></div>
        </>}
        {step === 2 && <>
          <h2 className="tf-imp__h">Check, then import</h2>
          <ImportPolicies keys={keys.filter((k) => map.includes(k.id))} matchBy={matchBy} onMatchBy={setMatchBy} onMatch={onMatch} onMatchChange={setOnMatch} onNew={onNew} onNewChange={setOnNew} />
          <PreviewRows lines={lines} onDownload={() => downloadErrors(file?.name ?? `${w.many}.csv`, head, lines, toast)} />
          <div className="tf-imp__go"><Button variant="ghost" onPress={() => setStep(1)}>Back</Button><Button variant="primary" isDisabled={go.length === 0} onPress={run}>{go.length === 0 ? 'Nothing to import' : `Import ${plural(go.length, w.one, w.many)}`}</Button></div>
        </>}
        {step === 3 && done && <>
          <h2 className="tf-imp__h">Imported</h2>
          <ul className="tf-imp__sum"><li><strong className="tf-num">{done.undo.made}</strong> added</li><li><strong className="tf-num">{done.undo.updated}</strong> updated</li><li><strong className="tf-num">{lines.length - go.length}</strong> not imported</li></ul>
          <p className="tf-rec__muted">Undo takes it back: new {w.many} go, and updated fields get their old values. It stays open for 7 days in Settings › Imports and exports.</p>
          <div className="tf-imp__go">
            {onJob && <Button variant="ghost" onPress={() => onJob(done.jobId)}>See rows and errors</Button>}
            <Button variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onPress={() => { undoImport(dispatch, object, done.undo, state.me); dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: (q.jobs ?? []).map((j) => (j.id === done.jobId ? { ...j, undone: true } : j)) }) }); toast({ message: 'Import undone' }); onDone(); }}>Undo import</Button>
            <Button variant="primary" onPress={onDone}>See {w.many}</Button>
          </div>
        </>}
      </section>
    </div>
  );
}
