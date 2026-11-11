// Forms, Wave D1: the parts the editor draws beside its tabs. The Live dialog after a first publish, Sync earlier submissions,
// embed options and For developers on Share, the submissions table with its drawer, Analytics, After they send (endings, routes,
// the score) under the questions, and the full page preview. All local state; nothing here talks to a server.
import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, Download, ExternalLink, Eye, EyeOff, Globe, Link2, Mail, Megaphone, MessageCircle, Plus, RefreshCw, Send, Share2, ShieldAlert, Tag as TagIcon, Trash2, UserPlus, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { Selection } from 'react-aria-components';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog, FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { StatCard } from '../Card/Card.tsx';
import { BarChart, BarList, ChartCard } from '../Chart/Chart.tsx';
import { DataGrid, type GridColumn, type GridRecord } from '../DataGrid/DataGrid.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { DescriptionList } from '../DescriptionList/DescriptionList.tsx';
import { EmbedPreview } from '../EmbedPreview/EmbedPreview.tsx';
import { FormPicture, HostedFormPreview, type PreviewDevice } from '../FormPicture/FormPicture.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { AccentPicker } from '../ColorPicker/ColorPicker.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { answerText, type FormQuestion, type HostedFormProps } from '../HostedForm/HostedForm.tsx';
import { FileText } from 'lucide-react';
import { newId, type AppForm, type AppState, type FormEnding, type FormResponse, type FormRoute } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const answerable = (qs: ReadonlyArray<FormQuestion>) => qs.filter((q) => q.kind !== 'statement');
/** The answers a question can be routed on: its choices, Yes and No. */
export const routable = (q: FormQuestion | undefined): ReadonlyArray<string> => (q?.kind === 'yesno' ? ['Yes', 'No'] : q?.kind === 'choice' || q?.kind === 'dropdown' || q?.kind === 'multi' ? q.options ?? [] : []);

/* ---------- Sync earlier submissions ---------- */

/** What syncing would do to some submissions: new records, updates, already matching, and those with nothing to file under. */
export interface SyncPreview { readonly creates: number; readonly updates: number; readonly unchanged: number; readonly failures: number }
/** Asks before saving earlier submissions the way the form saves now: which ones, what it would do, then Sync. */
export function SyncDialog({ total, unfiled, preview, targetName, onClose, onSync }: { readonly total: number; readonly unfiled: number; readonly preview: (all: boolean) => SyncPreview; readonly targetName: string; readonly onClose: () => void; readonly onSync: (all: boolean) => void }) {
  const [all, setAll] = useState(unfiled === 0);
  const pv = preview(all);
  const n = pv.creates + pv.updates;
  const parts = [pv.creates ? count(pv.creates, 'new record', 'new records') : '', pv.updates ? count(pv.updates, 'record updated', 'records updated') : '', pv.unchanged ? count(pv.unchanged, 'already matches', 'already match') : '', pv.failures ? `${pv.failures} can’t be synced` : ''].filter(Boolean);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Sync earlier submissions?" description={`Save earlier submissions to ${targetName} the way the form saves now.`}
      actions={<><Button variant="ghost" slot="close">Not now</Button><Button variant="primary" isDisabled={n === 0} onPress={() => onSync(all)}>{n ? `Sync ${count(n, 'submission', 'submissions')}` : 'Sync'}</Button></>}>
      <div className="tf-rec__form">
        <div className="tf-bkf__group"><span className="tf-bkf__label">Which submissions</span>
          <SegmentedControl aria-label="Which submissions" selectedKey={all ? 'all' : 'unfiled'} onSelectionChange={(k) => setAll(k === 'all')} items={[{ id: 'unfiled', label: `Only unsaved · ${unfiled}` }, { id: 'all', label: `All · ${total}` }]} /></div>
        <div className="tf-bkf__group"><span className="tf-bkf__label">What syncing would do</span>
          <p className="tf-fp__syncline">{parts.length ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : 'Nothing to sync: every earlier submission already follows the form.'}</p>
          {pv.failures > 0 && <span className="tf-rec__muted">Any that can’t be synced stay as they are.</span>}</div>
      </div>
    </Dialog>
  );
}

/* ---------- Share: embed and developers ---------- */

/** "Put it on your site": three ways it sits, clear background, no title, button words and colour, a live preview and the code. */
export function EmbedSection({ form, url, set }: { readonly form: AppForm; readonly url: string; readonly set: (p: Partial<AppForm>) => void }) {
  const e = form.embed ?? { style: 'inline' as const, clear: false, hideTitle: false, words: 'Contact us', colour: '#1F5FD6' };
  const put = (p: Partial<NonNullable<AppForm['embed']>>) => set({ embed: { ...e, ...p } });
  const attrs = [`data-timefix-${e.style === 'inline' ? 'inline' : e.style === 'popup' ? 'popup' : 'slide'}="https://${url}"`, e.clear ? 'data-timefix-clear="true"' : '', e.hideTitle ? 'data-timefix-hide-title="true"' : '', e.style !== 'inline' ? `data-timefix-text="${e.words}" data-timefix-color="${e.colour}"` : ''].filter(Boolean).join(' ');
  const snippet = e.style === 'popup' ? `<button ${attrs}>${e.words}</button>\n<script src="https://timefix.com/embed.js" async></script>` : `<div ${attrs}></div>\n<script src="https://timefix.com/embed.js" async></script>`;
  return (
    <section className="tf-fp__embed" aria-label="Put it on your site">
      <span className="tf-bkf__label">Put it on your site</span>
      <div className="tf-fp__embedgrid">
        <div className="tf-rec__form">
          <div className="tf-set__switch"><span><strong>Clear background</strong><span className="tf-rec__muted">Your page’s background shows through.</span></span><Switch aria-label="Clear background" isSelected={e.clear} onChange={(clear) => put({ clear })} /></div>
          <div className="tf-set__switch"><span><strong>Hide the title</strong><span className="tf-rec__muted">When your page already says it.</span></span><Switch aria-label="Hide the title" isSelected={e.hideTitle} onChange={(hideTitle) => put({ hideTitle })} /></div>
          {e.style !== 'inline' && <TextField label="Button words" value={e.words} onChange={(words) => put({ words })} onBlur={() => { if (!e.words.trim()) put({ words: 'Contact us' }); }} />}
          {e.style !== 'inline' && <AccentPicker label="Button colour" value={e.colour} onChange={(colour) => put({ colour })} />}
        </div>
        <EmbedPreview picture={<FormPicture title={e.hideTitle ? '' : form.headline ?? form.name} questions={form.questions} />} modes={['inline', 'popup', 'slide']} mode={e.style === 'slide' ? 'slide' : e.style === 'popup' ? 'popup' : 'inline'}
          onModeChange={(m) => put({ style: m === 'slide' ? 'slide' : m === 'popup' ? 'popup' : 'inline' })} isClear={e.clear} words={e.words} accent={e.colour} url={`https://${url}`} snippet={snippet} site="acme.com/contact" />
      </div>
    </section>
  );
}

/** A question's key in your own HTML: its title in lower case with underscores. */
const keyOf = (q: FormQuestion) => (q.title || q.kind).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || q.id;
const makeSecret = () => `whsec_${Array.from({ length: 24 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('')}`;

/** For developers: your own HTML form, the sites it may post from, signed posts and the signing secret (rotating asks first). */
export function DevelopersSection({ form, questions, set }: { readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion>; readonly set: (p: Partial<AppForm>) => void }) {
  const { toast } = useToast();
  const [site, setSite] = useState('');
  const [removing, setRemoving] = useState<string>();
  const [rotating, setRotating] = useState(false);
  const [shown, setShown] = useState(false);
  const sites = form.sites ?? [];
  const secret = form.secret ?? '';
  const html = [`<form action="https://timefix.com/f/${form.slug}/post" method="post">`,
    ...answerable(questions).map((q) => q.kind === 'hidden' ? `  <input type="hidden" name="${keyOf(q)}" value="${q.defaultValue ?? ''}">`
      : q.kind === 'choice' || q.kind === 'dropdown' ? `  <select name="${keyOf(q)}"${q.required ? ' required' : ''}><option value="">Choose one</option>${(q.options ?? []).map((o) => `<option>${o}</option>`).join('')}</select>`
        : q.kind === 'long' ? `  <textarea name="${keyOf(q)}"${q.required ? ' required' : ''}></textarea>` : `  <input name="${keyOf(q)}" type="${q.kind === 'email' ? 'email' : q.kind === 'phone' ? 'tel' : q.kind === 'number' ? 'number' : q.kind === 'date' ? 'date' : 'text'}"${q.required ? ' required' : ''}>`),
    '  <input name="tf_trap" tabindex="-1" autocomplete="off" hidden aria-label="Leave this empty">', '  <button type="submit">Send</button>', '</form>'].join('\n');
  const badSite = site.trim() !== '' && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(site.trim());
  const taken = sites.includes(site.trim().toLowerCase());
  const copy = (text: string, what: string) => { void copyText(text).then((ok) => toast(ok ? { message: `${what} copied`, tone: 'success' } : { message: 'Copy didn’t work. Select it and copy.', tone: 'danger' })); };
  return (
    <ShowMore showLabel="For developers" hideLabel="Hide For developers">
      <div className="tf-fp__dev">
        <section className="tf-fp__devsec" aria-label="Your own HTML">
          <span className="tf-bkf__label">Your own HTML</span>
          <p className="tf-rec__muted">Each field’s name is its question’s key, so a rename never breaks your page. Each post adds the page, referrer and UTM tags.</p>
          <pre className="tf-fp__code" tabIndex={0} aria-label="Form HTML"><code>{html}</code></pre>
          <span><Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={() => copy(html, 'Form HTML')}>Copy form HTML</Button></span>
        </section>
        <section className="tf-fp__devsec" aria-label="Allowed sites">
          <span className="tf-bkf__label">Allowed sites</span>
          <p className="tf-rec__muted">Your own HTML only posts from these addresses. Embeds and the hosted page work on any site.</p>
          {sites.length === 0 ? <p className="tf-rec__muted">None yet, so your own HTML can’t post.</p> : <ul className="tf-set__list" aria-label="Allowed sites">{sites.map((x) => <li key={x}><span className="tf-num">{x}</span><IconButton size="sm" label={`Remove ${x}`} onPress={() => setRemoving(x)}><X {...i14} /></IconButton></li>)}</ul>}
          <div className="tf-set__row"><TextField aria-label="Site address" placeholder="https://acme.com" value={site} onChange={setSite} isInvalid={badSite || taken} errorMessage={taken ? 'That site is in the list already.' : 'Use the site’s https address, such as https://acme.com.'} className="tf-set__grow" />
            <Button size="sm" variant="secondary" icon={<Plus {...i14} />} isDisabled={!site.trim() || badSite || taken || sites.length >= 20} onPress={() => { set({ sites: [...sites, site.trim().toLowerCase()] }); setSite(''); toast({ message: 'Site added', tone: 'success' }); }}>Add site</Button></div>
        </section>
        <section className="tf-fp__devsec" aria-label="Signed posts">
          <div className="tf-set__switch"><span><strong>Refuse unsigned posts</strong><span className="tf-rec__muted">For forms only your server posts to. The hosted page and embeds keep working.</span></span>
            <Switch aria-label="Refuse unsigned posts" isSelected={Boolean(form.signedOnly)} onChange={(on) => { set({ signedOnly: on || undefined, secret: on && !secret ? makeSecret() : form.secret }); toast({ message: on ? 'Unsigned posts are refused now.' : 'Unsigned posts are taken again.' }); }} /></div>
          {secret && <>
            <p className="tf-rec__muted">On your server, sign the exact body with HMAC SHA 256 and this secret, and send it in the <code className="tf-forms__key">x-crm-signature</code> header as <code className="tf-forms__key">sha256=</code> and the hex digest.</p>
            <div className="tf-set__row"><TextField label="Signing secret" isReadOnly value={shown ? secret : '•'.repeat(28)} className="tf-set__grow" description="Keep it on your server. Anyone with it can post as you." />
              <IconButton size="sm" label={shown ? 'Hide the secret' : 'Reveal the secret'} onPress={() => setShown(!shown)}>{shown ? <EyeOff {...i14} /> : <Eye {...i14} />}</IconButton>
              <IconButton size="sm" label="Copy signing secret" onPress={() => copy(secret, 'Signing secret')}><Copy {...i14} /></IconButton>
              <Button size="sm" variant="ghost" icon={<RefreshCw {...i14} />} onPress={() => setRotating(true)}>Rotate secret</Button></div>
          </>}
        </section>
      </div>
      {removing && <Dialog isOpen onOpenChange={(o) => { if (!o) setRemoving(undefined); }} title={`Remove ${removing}?`} description="Your own HTML there stops posting at once. Embeds keep working."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { set({ sites: sites.filter((x) => x !== removing) }); setRemoving(undefined); toast({ message: 'Site removed' }); }}>Remove site</Button></>} />}
      {rotating && <Dialog isOpen onOpenChange={(o) => { if (!o) setRotating(false); }} title="Rotate the signing secret?" description="The old secret stops working at once. Update your server with the new one."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { set({ secret: makeSecret() }); setRotating(false); setShown(true); toast({ message: 'New signing secret made. Update your server.', tone: 'success' }); }}>Rotate secret</Button></>} />}
    </ShowMore>
  );
}

/* ---------- Submissions ---------- */

/** Where a submission stands, as the table's State column says it. */
export type SubState = 'review' | 'spam' | 'failed' | 'added' | 'notin' | 'kept';
const STATE_WORD: Readonly<Record<SubState, string>> = { review: 'Needs review', spam: 'Spam', failed: 'Failed', added: 'Added', notin: 'Not in CRM', kept: 'Received' };
const STATE_HUE = { review: 'orange', spam: 'red', failed: 'red', added: 'green', notin: 'gray', kept: 'gray' } as const;
const VIA_WORD: Readonly<Record<string, string>> = { page: 'The form’s own page', inline: 'An embed in the page', popup: 'An embed’s popup', slide: 'An embed’s slide-in', own: 'The site’s own HTML' };

/** What the submissions table needs from the editor: who sent it, where it was filed, and the ways to change it. */
export interface SubmissionsProps {
  readonly state: AppState; readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion>;
  readonly targetName: (n: number) => string;
  readonly who: (r: FormResponse) => { readonly name: string; readonly email: string };
  readonly filedAs: (r: FormResponse) => { readonly object: string; readonly id: string } | undefined;
  /** Which questions are saved on the record ("none" keeps it on the submission). */
  readonly attrOf: (q: FormQuestion) => string;
  /** Files these submissions in the CRM, quietly; returns how many were filed. */
  readonly onFile: (rs: ReadonlyArray<FormResponse>) => number;
  readonly patchResponses: (fn: (rs: ReadonlyArray<FormResponse>) => ReadonlyArray<FormResponse>) => void;
  readonly onOpenRecord?: (object: string, id: string) => void;
  readonly onExport: (rs: ReadonlyArray<FormResponse>, name: string) => void;
  readonly onSyncEarlier: () => void;
  /** Opens on a state (from "View spam" in Settings). */
  readonly filter: string; readonly onFilter: (f: string) => void;
}

/** Submissions: a table with a state filter and search, picks for bulk actions, Show more, and a drawer for one with where it came from. */
export function SubmissionsPanel({ state, form, questions, targetName, who, filedAs, attrOf, onFile, patchResponses, onOpenRecord, onExport, onSyncEarlier, filter, onFilter }: SubmissionsProps) {
  const { toast } = useToast();
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<Selection>(new Set());
  const [shown, setShown] = useState(10);
  const [open, setOpen] = useState<string>();
  const crm = form.saveTo !== 'none';
  const stateOf = (r: FormResponse): SubState => (r.spam ? 'spam' : r.state === 'review' ? 'review' : r.state === 'failed' ? 'failed' : filedAs(r) ? 'added' : crm ? 'notin' : 'kept');
  const all = form.responses;
  const counts = all.reduce<Record<string, number>>((m, r) => { const s = stateOf(r); return { ...m, [s]: (m[s] ?? 0) + 1 }; }, {});
  const q = find.trim().toLowerCase();
  const rows = all.filter((r) => (filter === 'all' ? !r.spam : stateOf(r) === filter) && (!q || Object.values(r.answers).some((v) => v.toLowerCase().includes(q))));
  const page = rows.slice(0, shown);
  const ids = picked === 'all' ? rows.map((r) => r.id) : [...picked].map(String).filter((id) => rows.some((r) => r.id === id));
  const chosen = all.filter((r) => ids.includes(r.id));
  const clear = () => setPicked(new Set());
  const setOne = (r: FormResponse) => patchResponses((rs) => rs.map((x) => (x.id === r.id ? r : x)));
  const restore = (gone: ReadonlyArray<FormResponse>) => patchResponses((rs) => [...rs, ...gone].sort((a, b) => b.at.getTime() - a.at.getTime()));
  /** Not spam: out of Spam or Needs review, and filed like any other. */
  const release = (rs: ReadonlyArray<FormResponse>) => {
    const was = rs;
    patchResponses((xs) => xs.map((x) => (rs.some((y) => y.id === x.id) ? { ...x, spam: undefined, state: undefined, why: undefined } : x)));
    const filed = crm ? onFile(rs.map((x) => ({ ...x, spam: undefined, state: undefined }))) : 0;
    toast({ message: `${count(rs.length, 'submission', 'submissions')} marked as not spam${filed ? `, ${filed} added to ${targetName(2)}` : ''}.`, action: filed ? undefined : { label: 'Undo', onAction: () => patchResponses((xs) => xs.map((x) => was.find((y) => y.id === x.id) ?? x)) } });
  };
  const spam = (rs: ReadonlyArray<FormResponse>) => { const was = rs; patchResponses((xs) => xs.map((x) => (rs.some((y) => y.id === x.id) ? { ...x, spam: true, state: undefined, why: 'Someone marked it as spam.' } : x))); toast({ message: `${count(rs.length, 'submission', 'submissions')} marked as spam.`, action: { label: 'Undo', onAction: () => patchResponses((xs) => xs.map((x) => was.find((y) => y.id === x.id) ?? x)) } }); };
  const remove = (rs: ReadonlyArray<FormResponse>) => { const gone = rs; patchResponses((xs) => xs.filter((x) => !rs.some((y) => y.id === x.id))); toast({ message: `${count(rs.length, 'submission', 'submissions')} deleted.`, action: { label: 'Undo', onAction: () => restore(gone) } }); };
  const add = (rs: ReadonlyArray<FormResponse>) => { const can = rs.filter((r) => !r.spam && r.state !== 'review' && !filedAs(r)); if (!can.length) { toast({ message: 'Nothing to add: these are already in the CRM or held.' }); return; } const n = onFile(can); toast({ message: n === can.length ? `${count(n, 'submission', 'submissions')} added to the CRM.` : `${count(n, 'submission', 'submissions')} added, ${can.length - n} failed.`, tone: n ? 'success' : 'danger' }); };
  const retry = (r: FormResponse) => { const n = onFile([{ ...r, state: undefined }]); if (n) { toast({ message: 'Processed again: added to the CRM.', tone: 'success' }); } else toast({ message: 'It still can’t be saved. Check the record’s email is on one person only.', tone: 'danger' }); };
  const columns: ReadonlyArray<GridColumn> = [
    { id: 'name', name: 'Person', type: 'name', width: 220, isReadOnly: true },
    { id: 'email', name: 'Email', type: 'text', width: 220, isReadOnly: true },
    { id: 'state', name: 'State', type: 'status', width: 150, isReadOnly: true, options: (Object.keys(STATE_WORD) as SubState[]).map((s) => ({ id: s, label: STATE_WORD[s], hue: STATE_HUE[s] })) },
    { id: 'source', name: 'Came from', type: 'text', width: 150, isReadOnly: true },
    { id: 'when', name: 'When', type: 'text', width: 120, isReadOnly: true },
  ];
  const gridRows: ReadonlyArray<GridRecord> = page.map((r) => ({ id: r.id, kind: 'person' as const, values: { name: who(r).name || who(r).email || 'No name given', email: who(r).email, state: stateOf(r), source: r.from?.source ?? 'Direct', when: ago(r.at) } }));
  const resp = all.find((r) => r.id === open);
  const at = resp ? rows.findIndex((r) => r.id === resp.id) : -1;
  const unfiled = all.filter((r) => !r.spam && !r.state && !filedAs(r)).length;
  const filters = [{ id: 'all', label: 'All submissions', description: String(all.length - (counts.spam ?? 0)) }, { id: 'review', label: 'Needs review', description: String(counts.review ?? 0) },
    ...(crm ? [{ id: 'notin', label: 'Not in CRM', description: String(counts.notin ?? 0) }, { id: 'added', label: 'Added', description: String(counts.added ?? 0) }] : [{ id: 'kept', label: 'Kept', description: String(counts.kept ?? 0) }]),
    { id: 'failed', label: 'Failed', description: String(counts.failed ?? 0) }, { id: 'spam', label: 'Spam', description: String(counts.spam ?? 0) }];
  return (
    <>
      <div className="tf-rec__bar">
        <Select label="State" isLabelHidden className="tf-you__select" value={filter} onChange={(v) => { onFilter(v ?? 'all'); clear(); setShown(10); }} items={filters} />
        <span className="tf-rec__spacer" />
        <SearchField label="Search submissions" placeholder="Search submissions" size="sm" value={find} onChange={setFind} />
        {rows.length > 0 && <Button size="sm" variant="secondary" icon={<Download {...i14} />} onPress={() => onExport(rows, form.slug)}>{q || filter !== 'all' ? `Export ${rows.length}` : 'Export CSV'}</Button>}
      </div>
      {(counts.review ?? 0) > 0 && filter !== 'review' && <Callout tone="warning" action={{ label: 'Review', onPress: () => { onFilter('review'); clear(); } }}>{counts.review === 1 ? '1 submission needs your review.' : `${counts.review} submissions need your review.`}</Callout>}
      {crm && unfiled > 0 && filter === 'all' && <Callout tone="info" action={{ label: 'Sync', onPress: onSyncEarlier }}>{unfiled === 1 ? `1 earlier submission isn’t in ${targetName(2)} yet.` : `${unfiled} earlier submissions aren’t in ${targetName(2)} yet.`}</Callout>}
      {rows.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={q ? `No submissions match “${find}”` : filter === 'spam' ? 'No spam' : filter === 'review' ? 'Nothing needs a look' : filter === 'failed' ? 'Nothing failed' : 'No submissions yet'}
        description={filter === 'spam' ? 'Anything that looks like it lands here.' : q ? 'Try other words.' : 'Share the link and the first one shows here.'} /> : (
        <div className="tf-fp__table">
          <DataGrid label="Submissions" columns={columns} rows={gridRows} selectedKeys={picked} onSelectionChange={setPicked} onRowAction={(id) => setOpen(id)}
            summary={<span className="tf-rec__muted tf-num">{rows.length > shown ? `${shown} of ${rows.length} shown` : count(rows.length, 'submission', 'submissions')}</span>} />
          {rows.length > shown && <span><Button size="sm" variant="secondary" onPress={() => setShown((n) => n + 10)}>Show more</Button></span>}
        </div>
      )}
      <BulkActionBar count={ids.length} onClear={clear}>
        {filter === 'spam' || filter === 'review' ? <BarButton icon={<Check {...i16} />} onPress={() => { release(chosen); clear(); }}>Not spam</BarButton>
          : crm ? <BarButton icon={<UserPlus {...i16} />} onPress={() => { add(chosen); clear(); }}>Add to CRM</BarButton> : null}
        {filter !== 'spam' && <BarButton icon={<ShieldAlert {...i16} />} onPress={() => { spam(chosen); clear(); }}>Spam</BarButton>}
        <BarButton icon={<Trash2 {...i16} />} onPress={() => { remove(chosen); clear(); }}>Delete</BarButton>
        <BarButton icon={<Download {...i16} />} onPress={() => onExport(chosen, `${form.slug}-selected`)}>{`Export ${ids.length}`}</BarButton>
      </BulkActionBar>
      {resp && <SubmissionDrawer key={resp.id} r={resp} form={form} questions={questions} crm={crm} stateWord={STATE_WORD[stateOf(resp)]} stateHue={STATE_HUE[stateOf(resp)]} name={who(resp).name || who(resp).email || 'No name given'} filed={filedAs(resp)} attrOf={attrOf}
        targetName={targetName} onClose={() => setOpen(undefined)} pos={rows.length > 1 && at >= 0 ? { at, of: rows.length, prev: rows[at - 1]?.id, next: rows[at + 1]?.id } : undefined} onGo={setOpen}
        onRelease={() => release([resp])} onRetry={() => retry(resp)} onSpam={() => { spam([resp]); setOpen(undefined); }} onDelete={() => { remove([resp]); setOpen(undefined); }} onAdd={() => add([resp])}
        onUseNew={(qid) => { setOne({ ...resp, kept: (resp.kept ?? []).filter((x) => x !== qid) }); toast({ message: 'Saved on the record.', tone: 'success' }); }}
        onOpenRecord={onOpenRecord} state={state} />}
    </>
  );
}

function SubmissionDrawer({ r, form, questions, crm, stateWord, stateHue, name, filed, attrOf, targetName, onClose, pos, onGo, onRelease, onRetry, onSpam, onDelete, onAdd, onUseNew, onOpenRecord }: {
  readonly r: FormResponse; readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion>; readonly crm: boolean; readonly stateWord: string; readonly stateHue: 'orange' | 'red' | 'green' | 'gray'; readonly name: string;
  readonly filed?: { readonly object: string; readonly id: string }; readonly attrOf: (q: FormQuestion) => string; readonly targetName: (n: number) => string; readonly onClose: () => void;
  readonly pos?: { readonly at: number; readonly of: number; readonly prev?: string; readonly next?: string }; readonly onGo: (id: string) => void;
  readonly onRelease: () => void; readonly onRetry: () => void; readonly onSpam: () => void; readonly onDelete: () => void; readonly onAdd: () => void; readonly onUseNew: (qid: string) => void;
  readonly onOpenRecord?: (object: string, id: string) => void; readonly state: AppState;
}) {
  const { toast } = useToast();
  const qs = answerable(questions).filter((q) => (r.answers[q.id] ?? '') !== '');
  const saving = answerable(questions).filter((q) => attrOf(q) !== 'none' && (r.answers[q.id] ?? '') !== '');
  const kept = new Set(r.kept ?? []);
  const saved = filed ? saving.filter((q) => !kept.has(q.id)).length : 0;
  const status = !crm ? 'Not added to the CRM' : !filed ? 'Not in the CRM' : saving.length === 0 ? 'None saved on the record' : saved === saving.length ? 'All saved on the record' : `${saved} of ${saving.length} saved on the record`;
  const copy = (title: string, v: string) => { void copyText(v).then((ok) => toast(ok ? { message: `${title} copied`, tone: 'success' } : { message: 'Copy didn’t work. Select it and copy.', tone: 'danger' })); };
  const from = r.from;
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={name} subtitle={<span className="tf-num">Sent {ago(r.at)}{r.secs ? ` · took ${r.secs < 60 ? `${r.secs}s` : `${Math.round(r.secs / 60)} min`}` : ''}</span>}
      actions={pos ? <><span className="tf-rec__muted tf-num">{pos.at + 1} of {pos.of}</span>
        <IconButton size="sm" label="Previous submission" isDisabled={!pos.prev} onPress={() => { if (pos.prev) onGo(pos.prev); }}><ChevronUp {...i14} /></IconButton>
        <IconButton size="sm" label="Next submission" isDisabled={!pos.next} onPress={() => { if (pos.next) onGo(pos.next); }}><ChevronDown {...i14} /></IconButton></> : undefined}
      footerStart={<Button variant="ghost" icon={<Trash2 {...i14} />} onPress={onDelete}>Delete</Button>}>
      <div className="tf-fp__sub">
        <div className="tf-set__row"><Tag size="sm" hue={stateHue}>{stateWord}</Tag><span className="tf-rec__muted">{status}</span></div>
        {(r.spam || r.state === 'review') && <Callout tone="warning" action={{ label: 'Not spam', onPress: onRelease }}>{r.spam ? 'Our spam check caught this' : 'This waits for you'}{r.why ? `: ${r.why.replace(/^./, (c) => c.toLowerCase())}` : '.'}</Callout>}
        {r.state === 'failed' && <Callout tone="danger" action={{ label: 'Retry', onPress: onRetry }}>{r.why ?? 'It couldn’t be added to the CRM.'}</Callout>}
        {kept.size > 0 && <Callout tone="info">{`${name.split(' ')[0]} already had ${kept.size === 1 ? 'a different answer' : 'different answers'} here, so the record kept ${kept.size === 1 ? 'its value' : 'its values'}.`}</Callout>}
        <section className="tf-fp__answers" aria-label="Answers">
          <h3 className="tf-fp__h">Answers</h3>
          <ul className="tf-fp__alist">
            {qs.map((q) => { const v = answerText(q, r.answers[q.id]) || r.answers[q.id] || ''; const a = attrOf(q); return (
              <li key={q.id}><span className="tf-fp__aq">{q.title || 'Untitled question'}{crm && a !== 'none' && <span className="tf-rec__muted"> · {kept.has(q.id) ? 'Not saved' : filed ? 'Saved' : 'Will save'}</span>}</span>
                <span className="tf-fp__av">{v}</span>
                <span className="tf-fp__aacts">{kept.has(q.id) && <Button size="sm" variant="ghost" onPress={() => onUseNew(q.id)}>Use new</Button>}<IconButton size="sm" label={`Copy ${q.title || 'answer'}`} onPress={() => copy(q.title || 'Answer', r.answers[q.id] ?? '')}><Copy {...i14} /></IconButton></span></li>); })}
          </ul>
          {r.score !== undefined && <p className="tf-rec__muted tf-num">Score {r.score}{r.ending ? ` · ended on “${form.endings?.find((e) => e.id === r.ending)?.title ?? 'a thank-you message'}”` : ''}</p>}
          {r.consent && Object.entries(r.consent).map(([qid, words]) => <p key={qid} className="tf-rec__muted">Agreed to “{words}” on {r.at.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>)}
        </section>
        <section aria-label="Where it came from">
          <h3 className="tf-fp__h">Where it came from</h3>
          <DescriptionList label="Where it came from" items={[{ id: 'src', label: 'Source', icon: Globe, value: from?.source ?? 'Direct', isReadOnly: true }, { id: 'med', label: 'UTM medium', icon: TagIcon, value: from?.medium, isReadOnly: true, placeholder: 'None' },
            { id: 'cmp', label: 'UTM campaign', icon: Megaphone, value: from?.campaign, isReadOnly: true, placeholder: 'None' }, { id: 'page', label: 'Page', icon: Link2, type: 'url', value: from?.page, isReadOnly: true, placeholder: 'Not known' }, { id: 'via', label: 'Sent from', icon: Send, value: VIA_WORD[from?.via ?? 'page'], isReadOnly: true }]} />
        </section>
        <div className="tf-set__row">
          {filed ? onOpenRecord && <Button size="sm" variant="secondary" icon={<ExternalLink {...i14} />} onPress={() => onOpenRecord(filed.object, filed.id)}>Open in {targetName(2)}</Button>
            : crm && !r.spam && r.state !== 'review' && <Button size="sm" variant="secondary" icon={<UserPlus {...i14} />} onPress={onAdd}>Add to CRM</Button>}
          {!r.spam && <Button size="sm" variant="ghost" icon={<ShieldAlert {...i14} />} onPress={onSpam}>Mark as spam</Button>}
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- Analytics ---------- */

const median = (xs: ReadonlyArray<number>) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? undefined : s.length % 2 ? s[m] : Math.round(((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2); };
const timeText = (secs: number) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`);

/** Analytics: a period, four figures with a line each, views over time, sources, where people stop for the form's layout, and each choice question's answers (unpicked choices at 0). */
export function AnalyticsPanel({ state, form, questions }: { readonly state: AppState; readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion> }) {
  const [days, setDays] = useState('30');
  const n = Number(days);
  const now = Date.now();
  const from = now - n * 86_400_000; const before = from - n * 86_400_000;
  const visits = (state.visits ?? []).filter((v) => v.page === `form:${form.id}`);
  const inP = visits.filter((v) => v.at.getTime() >= from); const prevP = visits.filter((v) => v.at.getTime() >= before && v.at.getTime() < from);
  const subs = form.responses.filter((r) => !r.spam && r.at.getTime() >= from); const prevSubs = form.responses.filter((r) => !r.spam && r.at.getTime() >= before && r.at.getTime() < from);
  const started = inP.filter((v) => v.reached > 0).length; const prevStarted = prevP.filter((v) => v.reached > 0).length;
  const rate = started ? Math.round((subs.length / started) * 100) : 0; const prevRate = prevStarted ? Math.round((prevSubs.length / prevStarted) * 100) : 0;
  const med = median(subs.map((r) => r.secs ?? 0).filter((x) => x > 0)); const prevMed = median(prevSubs.map((r) => r.secs ?? 0).filter((x) => x > 0));
  const delta = (a: number, b: number) => (b === 0 ? { value: a ? `up from 0` : 'none before', direction: 'flat' as const } : { value: `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`, direction: a > b ? 'up' as const : a < b ? 'down' as const : 'flat' as const, note: `vs ${n} days before`, isGood: a >= b });
  const step = n > 30 ? 7 : 1;
  const perDay = Array.from({ length: Math.ceil(n / step) }, (_, i) => { const a = from + i * step * 86_400_000; const b = a + step * 86_400_000; return { id: String(i), label: new Date(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: inP.filter((v) => v.at.getTime() >= a && v.at.getTime() < b).length }; });
  const sources = [...inP.reduce((m, v) => m.set(v.source, (m.get(v.source) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ id: s, label: s, value: c }));
  const shownQs = questions.filter((q) => q.kind !== 'hidden');
  if (visits.length === 0 && form.responses.length === 0) return <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No visits yet" description="Numbers show here once people open the form." />;
  return (
    <>
      <div className="tf-rec__bar"><SegmentedControl aria-label="Period" size="sm" selectedKey={days} onSelectionChange={setDays} items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} /><span className="tf-rec__spacer" /><span className="tf-rec__muted tf-num">{form.views.toLocaleString('en-IN')} views since it went live</span></div>
      <div className="tf-home__stats">
        <StatCard label="Views" value={inP.length} delta={delta(inP.length, prevP.length)} />
        <StatCard label="Started" value={started} delta={{ value: `${inP.length ? Math.round((started / inP.length) * 100) : 0}% of views`, direction: 'flat' }} />
        <StatCard label="Completion" value={rate} format={(x) => `${x}%`} delta={{ value: `${subs.length} of ${started} who started`, direction: rate > prevRate ? 'up' : rate < prevRate ? 'down' : 'flat', isGood: rate >= prevRate }} />
        <StatCard label="Median time" value={med} format={(x) => timeText(x)} delta={med === undefined ? { value: 'No finishes yet', direction: 'flat' } : prevMed === undefined ? { value: 'First answer to send', direction: 'flat' } : { value: med <= prevMed ? `${timeText(prevMed - med)} faster` : `${timeText(med - prevMed)} slower`, direction: med <= prevMed ? 'up' : 'down', isGood: med <= prevMed }} />
      </div>
      <div className="tf-home__grid">
        <ChartCard title={step === 1 ? 'Views per day' : 'Views per week'}><BarChart label="Views over time" points={perDay} emptyText="No visits in this period." /></ChartCard>
        <ChartCard title="Sources">{sources.length ? <BarList label="Views by source" items={sources} /> : <p className="tf-rec__muted">No visits in this period.</p>}</ChartCard>
      </div>
      <Funnel form={form} questions={shownQs} visits={inP} sent={subs.length} />
      <section className="tf-recp__sec"><h3>Answers</h3>
        {subs.length === 0 ? <p className="tf-rec__muted">Nobody answered in this period.</p> : shownQs.filter((x) => ['choice', 'multi', 'dropdown', 'yesno', 'scale', 'rating', 'consent', 'checkbox'].includes(x.kind)).map((x) => {
          const options = x.kind === 'yesno' ? ['Yes', 'No'] : x.kind === 'scale' ? Array.from({ length: (x.max ?? 10) - (x.min ?? 0) + 1 }, (_, k) => String((x.min ?? 0) + k)) : x.kind === 'rating' ? ['1', '2', '3', '4', '5'] : x.kind === 'consent' || x.kind === 'checkbox' ? ['Yes'] : [...(x.options ?? []), ...(x.other ? ['Other'] : [])];
          const got = subs.map((r) => r.answers[x.id] ?? '').filter(Boolean);
          const tally = (o: string) => got.filter((v) => (x.kind === 'multi' ? v.split(', ').some((p) => p === o || (o === 'Other' && p.startsWith('Other'))) : v === o || (o === 'Other' && v.startsWith('Other')))).length;
          return (
            <div key={x.id} className="tf-forms__sum">
              <h4 className="tf-forms__sumq">{x.title || 'A question with no words'} <span className="tf-rec__muted tf-num">{count(got.length, 'response', 'responses')}</span></h4>
              <BarList label={`Answers to ${x.title}`} items={options.map((o) => { const c = tally(o); return { id: o, label: x.kind === 'consent' || x.kind === 'checkbox' ? 'Agreed' : o, value: c }; })} />
            </div>
          );
        })}
      </section>
    </>
  );
}

/** Where people stop, drawn for the form's layout: each question (one at a time), each step (steps), or each question answered (one page). */
function Funnel({ form, questions, visits, sent }: { readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion>; readonly visits: ReadonlyArray<{ readonly reached: number }>; readonly sent: number }) {
  const viewed = visits.length;
  const reach = (k: number) => visits.filter((v) => v.reached >= k).length;
  const steps: Array<{ readonly id: string; readonly label: string; readonly n: number }> = [{ id: 'view', label: 'Viewed', n: viewed }];
  if (form.mode === 'steps') {
    let at = 0;
    questions.forEach((q, i) => { if (i === 0 || q.step) { at += 1; steps.push({ id: q.id, label: `Step ${at}${q.step?.title ? ` · ${q.step.title}` : ''}`, n: reach(i + 1) }); } });
  } else questions.forEach((q, i) => steps.push({ id: q.id, label: `${form.mode === 'page' ? 'Answered ' : ''}${q.title || 'A question with no words'}`, n: reach(i + 1) }));
  steps.push({ id: 'sent', label: 'Submitted', n: sent });
  const worst = steps.slice(1).reduce<{ readonly at: number; readonly lost: number }>((w, s, i) => { const lost = (steps[i]?.n ?? 0) - s.n; return lost > w.lost ? { at: i + 1, lost } : w; }, { at: -1, lost: 0 });
  return (
    <section className="tf-recp__sec"><h3>Where people stop <span className="tf-rec__muted">· {form.mode === 'steps' ? 'by step' : form.mode === 'page' ? 'one page, by question answered' : 'one question at a time'}</span></h3>
      {viewed === 0 ? <p className="tf-rec__muted">No visits in this period. Try a longer one.</p> : (
        <ul className="tf-forms__drop tf-forms__drop--funnel" aria-label="People reaching each step">
          {steps.map((s, i) => { const pct = Math.round((Math.min(s.n, viewed) / viewed) * 100); return (
            <li key={s.id} data-worst={i === worst.at || undefined}><span className="tf-forms__funq"><span className="tf-num tf-rec__muted">{i === 0 || s.id === 'sent' ? '' : i}</span>{s.label}{i === worst.at && <Tag size="sm" hue="orange">Most leave here</Tag>}</span>
              <span className="tf-forms__bar" aria-hidden><span data-w={Math.round(pct / 10) * 10} /></span><span className="tf-num tf-rec__muted">{s.n.toLocaleString('en-IN')} · {pct}%</span></li>); })}
        </ul>)}
    </section>
  );
}

/* ---------- After they send ---------- */

/** After they send, at the end of the questions: what everyone sees, routes that send some elsewhere by answer, the other thank-you
 *  messages, and the score. */
export function AfterSendSection({ state, form, set, scoreFields }: { readonly state: AppState; readonly form: AppForm; readonly set: (p: Partial<AppForm>) => void; readonly scoreFields: ReadonlyArray<{ readonly id: string; readonly label: string }> }) {
  const { toast } = useToast();
  void state;
  const routes = form.routes ?? []; const endings = form.endings ?? [];
  const choiceQs = form.questions.filter((q) => routable(q).length > 0);
  const [editing, setEditing] = useState<FormEnding>();
  const putRoute = (r: FormRoute) => set({ routes: routes.map((x) => (x.id === r.id ? r : x)) });
  const addRoute = () => { const q = choiceQs[0]; if (!q) return; set({ routes: [...routes, { id: newId('rt'), when: q.id, is: routable(q)[0] ?? '', to: endings.length ? 'ending' : 'link', ending: endings[0]?.id, url: '' }] }); };
  const addEnding = () => { const e: FormEnding = { id: newId('end'), title: 'Thanks, we’re not a fit just yet', line: 'We’ve sent you a guide that may help.' }; set({ endings: [...endings, e] }); setEditing(e); };
  const sentHere = (id: string) => [...routes.filter((r) => r.to === 'ending' && r.ending === id).map(() => 'A route'), ...form.questions.filter((q) => q.jumps?.some((j) => j.to === `end:${id}`)).map((q) => `“${q.title}”`)];
  const maxScore = form.questions.reduce((n, q) => n + (q.points ? Math.max(0, ...Object.values(q.points)) * (q.kind === 'multi' ? (q.options?.length ?? 1) : 1) : 0), 0);
  const hasPoints = form.questions.some((q) => q.points);
  return (
    <section className="tf-fp__after" aria-label="After they send">
      <h3 className="tf-fp__h">After they send</h3>
      <div className="tf-fp__route tf-fp__route--all">
        <span className="tf-fp__rif">{routes.length ? 'Everyone else' : 'Everyone'}</span>
        <SegmentedControl aria-label={routes.length ? 'Show everyone else' : 'Show everyone'} size="sm" selectedKey={form.after.kind} onSelectionChange={(k) => set({ after: { ...form.after, kind: k === 'booking' ? 'booking' : k === 'redirect' ? 'redirect' : 'thanks' } })}
          items={[{ id: 'thanks', label: 'Thank you page' }, { id: 'booking', label: 'Booking page' }, { id: 'redirect', label: 'Link' }]} />
      </div>
      {form.after.kind === 'redirect' && <TextField label="Web address" value={form.after.url ?? ''} placeholder="https://example.com/thanks" onChange={(url) => set({ after: { ...form.after, url } })} isInvalid={Boolean(form.after.url) && !/^https?:\/\/\S+\.\S+/.test(form.after.url ?? '')} errorMessage="Give a full address, like https://example.com." />}
      <TextArea label="Message" rows={2} value={form.after.message} onChange={(message) => set({ after: { ...form.after, message } })} description={hasPoints ? 'Write {{score}} to show the score.' : undefined} />
      {routes.length > 0 && <ul className="tf-fp__routes" aria-label="Routes">{routes.map((r, i) => { const q = form.questions.find((x) => x.id === r.when); const bad = !q || !routable(q).includes(r.is) || (r.to === 'ending' && !endings.some((e) => e.id === r.ending)); return (
        <li key={r.id} className="tf-fp__route">
          <span className="tf-fp__rif">If</span>
          <Select label={`Rule ${i + 1} question`} isLabelHidden className="tf-fp__rsel" value={q ? r.when : null} placeholder="Pick a question" onChange={(v) => { const nq = choiceQs.find((x) => x.id === v); if (nq) putRoute({ ...r, when: nq.id, is: routable(nq)[0] ?? '' }); }} items={choiceQs.map((x) => ({ id: x.id, label: x.title || 'Untitled question' }))} />
          <span className="tf-fp__rif">is</span>
          <Select label={`Rule ${i + 1} answer`} isLabelHidden className="tf-fp__rsel" value={routable(q).includes(r.is) ? r.is : null} placeholder="Pick an answer" onChange={(v) => { if (v) putRoute({ ...r, is: v }); }} items={routable(q).map((o) => ({ id: o, label: o }))} />
          <span className="tf-fp__rif">→</span>
          <Select label={`Rule ${i + 1} goes to`} isLabelHidden className="tf-fp__rsel" value={r.to === 'ending' ? (r.ending && endings.some((e) => e.id === r.ending) ? `e:${r.ending}` : null) : r.to} placeholder="Where they go"
            onChange={(v) => { if (!v) return; if (v.startsWith('e:')) putRoute({ ...r, to: 'ending', ending: v.slice(2) }); else putRoute({ ...r, to: v === 'booking' ? 'booking' : 'link' }); }}
            items={[...endings.map((e) => ({ id: `e:${e.id}`, label: e.title || 'Thank-you message' })), { id: 'booking', label: 'Booking page' }, { id: 'link', label: 'A link' }]} />
          <IconButton size="sm" label={`Delete rule ${i + 1}`} onPress={() => { const was = routes; set({ routes: routes.filter((x) => x.id !== r.id) }); toast({ message: 'Rule deleted.', action: { label: 'Undo', onAction: () => set({ routes: was }) } }); }}><Trash2 {...i14} /></IconButton>
          {r.to === 'link' && <TextField label="Address" className="tf-fp__rurl" value={r.url ?? ''} placeholder="https://" onChange={(url) => putRoute({ ...r, url })} isInvalid={Boolean(r.url) && !/^https?:\/\/\S+\.\S+/.test(r.url ?? '')} errorMessage="A link needs a full address that starts with https://." />}
          {bad && <span className="tf-forms__rule-say tf-forms__rule-bad" role="alert">This rule reads a question or answer that changed. Pick again or delete it.</span>}
        </li>); })}</ul>}
      <span><Button size="sm" variant="secondary" icon={<Plus {...i14} />} isDisabled={choiceQs.length === 0} onPress={addRoute}>Add a route</Button>
        {choiceQs.length === 0 && <span className="tf-rec__muted"> Add a question with choices first, so a rule has something to read.</span>}</span>
      <div className="tf-fp__endings">
        <span className="tf-bkf__label">Thank-you messages</span>
        {endings.length === 0 ? <p className="tf-rec__muted">Where a jump or a route can send a visitor instead of the thank you.</p> : <ul className="tf-set__list" aria-label="Thank-you messages">{endings.map((e) => { const by = sentHere(e.id); return (
          <li key={e.id}><span className="tf-fp__ending"><strong>{e.title || 'Thank-you message'}</strong><span className="tf-rec__muted">{by.length ? `${by.join(', ')} ${by.length === 1 ? 'sends' : 'send'} people here` : 'Nothing sends people here yet'}</span></span>
            <span className="tf-set__row"><Button size="sm" variant="ghost" onPress={() => setEditing(e)}>Edit</Button>
              <IconButton size="sm" label={`Delete ${e.title || 'thank-you message'}`} onPress={() => { const was = { endings, routes }; set({ endings: endings.filter((x) => x.id !== e.id), routes: routes.filter((x) => !(x.to === 'ending' && x.ending === e.id)) }); toast({ message: 'Thank-you message deleted.', action: { label: 'Undo', onAction: () => set(was) } }); }}><Trash2 {...i14} /></IconButton></span></li>); })}</ul>}
        <span><Button size="sm" variant="secondary" icon={<Plus {...i14} />} isDisabled={endings.length >= 10} onPress={addEnding}>Add an ending</Button></span>
      </div>
      {hasPoints && <div className="tf-fp__score">
        <span className="tf-bkf__label">Score</span>
        <p className="tf-rec__muted tf-num">Points on the answers add up to a score, up to {maxScore}. Jump on it, show it with {'{{score}}'}, and save it.</p>
        <Select label="Save the score to" value={form.scoreTo ?? 'none'} onChange={(v) => set({ scoreTo: !v || v === 'none' ? undefined : v })} items={[{ id: 'none', label: 'Keep it off the CRM' }, ...scoreFields]}
          description={scoreFields.length ? undefined : 'This object has no number field to save a score to.'} />
      </div>}
      {editing && <Dialog isOpen onOpenChange={(o) => { if (!o) setEditing(undefined); }} title="Thank-you message" description="Write {{score}} to show the score."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { const e = editing; set({ endings: endings.map((x) => (x.id === e.id ? { ...e, title: e.title.trim() || 'Thank-you message', button: e.button?.label.trim() && /^https?:\/\//.test(e.button.url) ? e.button : undefined } : x)) }); setEditing(undefined); }}>Save</Button></>}>
        <div className="tf-rec__form">
          <TextField label="Heading" value={editing.title} placeholder="Thanks, we are not a fit" onChange={(title) => setEditing({ ...editing, title })} />
          <TextArea label="Line under it" aside="Optional" rows={2} value={editing.line ?? ''} onChange={(line) => setEditing({ ...editing, line: line || undefined })} />
          <div className="tf-bkf__pair"><TextField label="Button text" aside="Optional" value={editing.button?.label ?? ''} placeholder="Read the guide" onChange={(label) => setEditing({ ...editing, button: { url: editing.button?.url ?? '', label } })} />
            <TextField label="Link" aside="Optional" value={editing.button?.url ?? ''} placeholder="https://" onChange={(url) => setEditing({ ...editing, button: { label: editing.button?.label ?? '', url } })} isInvalid={Boolean(editing.button?.url) && !/^https?:\/\/\S+\.\S+/.test(editing.button?.url ?? '')} errorMessage="Start with https://." /></div>
        </div>
      </Dialog>}
    </section>
  );
}

/* ---------- Full page preview ---------- */

/** The form on its own page, as a visitor sees it, on a desktop or a phone. Nothing is sent. */
export function FullPreview({ form, onClose, address }: { readonly form: HostedFormProps; readonly onClose: () => void; readonly address: string }) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  return (
    <FullScreenDialog aria-label="Preview" onOpenChange={(o) => { if (!o) onClose(); }} className="tf-fp__full">
      <div className="tf-fp__fullbar">
        <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onClose}>Back to editor</Button>
        <Tag size="sm" hue="orange">Preview · nothing is sent</Tag>
        <span className="tf-rec__spacer" />
        <SegmentedControl aria-label="Preview on" size="sm" selectedKey={device} onSelectionChange={(k) => setDevice(k === 'phone' ? 'phone' : 'desktop')} items={[{ id: 'desktop', label: 'Desktop' }, { id: 'phone', label: 'Phone' }]} />
      </div>
      <div className="tf-fp__fullroom" data-device={device}><HostedFormPreview {...form} device={device} onDeviceChange={setDevice} address={address} /></div>
    </FullScreenDialog>
  );
}

/** A small mark for "this needs a look" lists. */
export function Need({ children }: { readonly children: ReactNode }) { return <Tag size="sm" hue="blue">{children}</Tag>; }
