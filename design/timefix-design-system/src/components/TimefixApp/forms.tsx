// Forms: a list of cards, New form from a gallery, and one editor with five tabs: Questions (builder beside the live preview),
// Settings (layout, where answers go, what happens after), Share (link and embeds), Responses (with Add to People, spam, delete + Undo),
// Results (views, finishes, where people stop). Edits are a draft until Publish; the visitor's page is HostedForm itself.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Download, ExternalLink, FileText, MoreHorizontal, Pause, Play, Plus, QrCode as QrIcon, Trash2, UserPlus, ShieldAlert } from 'lucide-react';
import { saveFile } from '../../lib/saveFile.ts';
import { QrSheet } from './grow.tsx';
import { FormCard, FormStatusTag, HostedFormPreview } from '../FormPicture/FormPicture.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { QuestionBuilder } from '../QuestionList/QuestionList.tsx';
import { HostedForm, SentAnswers } from '../HostedForm/HostedForm.tsx';
import { QUESTION_KINDS, type FormQuestion } from '../HostedForm/answers.ts';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { StatCard } from '../Card/Card.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { STAGES, formWho, newId, type AppAction, type AppForm, type AppState, type FormResponse, type ObjectId } from './data.ts';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const statusOf = (f: AppForm) => (f.status === 'paused' ? 'closed' : f.status === 'live' ? 'live' : 'draft') as 'draft' | 'live' | 'closed';
/** The settings a visitor sees besides the questions. */
/** Closed by date or by count: visitors see the closed message. */
const closedNow = (f: AppForm) => Boolean((f.closesOn && new Date(`${f.closesOn}T23:59`) < new Date()) || (f.maxResponses && f.responses.filter((r) => !r.spam).length >= f.maxResponses));
/** A question's key in links: its title in lower case with underscores ("work_email"). */
const keyOf = (q: FormQuestion) => (q.title || q.kind).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || q.id;
const configOf = (f: AppForm) => JSON.stringify({ name: f.name, mode: f.mode, after: f.after, subtitle: f.subtitle, logic: f.logic, mapping: f.mapping });
/** What visitors see now: the published questions and settings, or the draft before the first publish. */
const liveView = (f: AppForm): Pick<AppForm, 'name' | 'mode' | 'after' | 'subtitle' | 'logic' | 'mapping' | 'questions'> => {
  const cfg = f.liveConfig ? (JSON.parse(f.liveConfig) as Partial<AppForm>) : {};
  return { name: cfg.name ?? f.name, mode: cfg.mode ?? f.mode, after: cfg.after ?? f.after, subtitle: cfg.subtitle, logic: cfg.logic, mapping: cfg.mapping ?? f.mapping, questions: f.live ?? f.questions };
};
/** The People attribute a question fills when nobody picked one: email, phone, name and job title are guessed from the question. */
export const guessAttr = (q: FormQuestion) => (q.kind === 'email' ? 'email' : q.kind === 'phone' ? 'phone' : q.kind === 'short' && /name/i.test(q.title) ? 'name' : q.kind === 'short' && /title|role/i.test(q.title) ? 'title' : 'none');
const edited = (f: AppForm) => f.status !== 'draft' && (JSON.stringify(f.questions) !== JSON.stringify(f.live) || (f.liveConfig !== undefined && f.liveConfig !== configOf(f)));
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);

/** A form holds up to this many questions; past that it's two forms. */
const MAX_QUESTIONS = 50;

const TEMPLATES: ReadonlyArray<{ readonly id: string; readonly name: string; readonly line: string; readonly questions: ReadonlyArray<FormQuestion> }> = [
  { id: 'blank', name: 'Blank', line: 'Start from nothing', questions: [] },
  { id: 'contact', name: 'Contact us', line: 'Name, email and a message', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'long', title: 'How can we help?' }] },
  { id: 'lead', name: 'Lead capture', line: 'Qualify, then book a call', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'choice', title: 'Team size', options: ['1–10', '11–50', '51+'] }] },
  { id: 'event', name: 'Event signup', line: 'Who’s coming, and any needs', questions: [{ id: 'a', kind: 'short', title: 'Name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'dropdown', title: 'Which session?', options: ['Morning', 'Afternoon'] }] },
  { id: 'feedback', name: 'Feedback', line: 'A rating and a few words', questions: [{ id: 'a', kind: 'rating', title: 'How did we do?', required: true }, { id: 'b', kind: 'long', title: 'Anything to add?' }] },
  { id: 'job', name: 'Job application', line: 'CV, links and a cover note', questions: [{ id: 'a', kind: 'short', title: 'Full name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'file', title: 'Your CV', required: true }] },
  { id: 'quote', name: 'Quote request', line: 'What they need, by when, for how much', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'long', title: 'What do you need?', required: true }, { id: 'd', kind: 'dropdown', title: 'Budget', options: ['Under ₹1 lakh', '₹1–5 lakh', '₹5 lakh+'] }, { id: 'e', kind: 'date', title: 'Needed by' }] },
  { id: 'newsletter', name: 'Newsletter signup', line: 'Just an email, and what they like', questions: [{ id: 'a', kind: 'email', title: 'Email', required: true }, { id: 'b', kind: 'multi', title: 'What would you like to hear about?', options: ['Product news', 'Guides', 'Events'] }] },
  { id: 'nps', name: 'Customer satisfaction', line: 'How likely they are to recommend you', questions: [{ id: 'a', kind: 'rating', title: 'How likely are you to recommend us?', required: true }, { id: 'b', kind: 'long', title: 'What’s the main reason?' }, { id: 'c', kind: 'email', title: 'Email, if we can follow up' }] },
  { id: 'support', name: 'Support request', line: 'The problem, how urgent, a screenshot', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'choice', title: 'How urgent is it?', options: ['It can wait', 'Today, please', 'Everything is stuck'] }, { id: 'd', kind: 'long', title: 'What happened?', required: true }, { id: 'e', kind: 'file', title: 'A screenshot' }] },
  { id: 'waitlist', name: 'Early access', line: 'Join the waitlist for something new', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'short', title: 'Company' }, { id: 'd', kind: 'choice', title: 'Team size', options: ['Just me', '2–10', '11–50', '51+'] }] },
];

/** Props for FormsScreen. */
export interface FormsScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly onOpenPerson: (id: string) => void;
  /** Opens any record a response was filed as. */
  readonly onOpenRecord?: (object: string, id: string) => void;
  readonly onBookings: (tab: string) => void;
  /** A visitor who chose "Book a meeting": opens the booking page with their name and email filled in. */
  readonly onBookGuest?: (who: { readonly name: string; readonly email: string }) => void;
  /** Opens on one form, as its editor or as a visitor sees it (from Links). */
  readonly start?: { readonly id: string; readonly visit: boolean };
}

/** The forms list, or one form open. */
export function FormsScreen({ state, dispatch, onOpenPerson, onOpenRecord, onBookings, onBookGuest, start }: FormsScreenProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | undefined>(start?.id);
  const [gallery, setGallery] = useState(false);
  const [find, setFind] = useState('');
  const form = state.forms.find((f) => f.id === openId);
  if (form) return <FormEditor state={state} form={form} dispatch={dispatch} onBack={() => setOpenId(undefined)} onOpenPerson={onOpenPerson} onOpenRecord={onOpenRecord} onOpenForm={(id) => setOpenId(id)} onBookGuest={onBookGuest} visit={start?.id === form.id && start.visit} />;
  return (
    <div className="tf-forms">
      <div className="tf-rec__bar"><span className="tf-rec__muted">{state.forms.length} {state.forms.length === 1 ? 'form' : 'forms'} · {state.forms.reduce((n, f) => n + f.responses.filter((r) => !r.spam).length, 0)} responses</span><span className="tf-rec__spacer" />
        {state.forms.length > 3 && <SearchField label="Search forms" placeholder="Search forms" size="sm" value={find} onChange={setFind} />}
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setGallery(true)}>New form</Button></div>
      {state.forms.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No forms yet" description="Collect leads, signups and feedback; answers file into People." action={<Button size="sm" variant="primary" onPress={() => setGallery(true)}>New form</Button>} /> : (
        <ul className="tf-forms__grid">
          {state.forms.filter((f) => !find.trim() || f.name.toLowerCase().includes(find.trim().toLowerCase())).map((f) => <li key={f.id}><FormCard name={f.name} status={statusOf(f)} responses={f.responses.filter((r) => !r.spam).length} updated={edited(f) ? `Live · edited ${ago(f.updated)}, not published` : `Edited ${ago(f.updated)}`} questions={f.questions} onPress={() => setOpenId(f.id)} /></li>)}
        </ul>
      )}
      {gallery && (
        <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setGallery(false); }} title="New form" description="Start blank or from a template; change anything after.">
          <ul className="tf-forms__gallery">
            {TEMPLATES.map((t) => (
              <li key={t.id}><button type="button" className="tf-forms__tpl" onClick={() => {
                const f: AppForm = { id: newId('f'), name: t.id === 'blank' ? 'Untitled form' : t.name, slug: `${t.id}-${Date.now().toString(36).slice(-4)}`, status: 'draft', questions: t.questions.map((q) => ({ ...q, id: newId('q') })), mode: 'one',
                  saveTo: t.id === 'feedback' ? 'none' : 'people', owner: state.me, after: { kind: 'thanks', message: 'Thanks, we got it.' }, responses: [], views: 0, updated: new Date() };
                dispatch({ type: 'form/set', form: f }); setGallery(false); setOpenId(f.id); toast({ message: `${f.name} made. Publish when it’s ready.` });
              }}><strong>{t.name}</strong><span className="tf-rec__muted">{t.line}</span><span className="tf-rec__muted tf-num">{t.questions.length ? `${t.questions.length} questions` : 'No questions'}</span></button></li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function FormEditor({ state, form, dispatch, onBack, onOpenPerson, onOpenRecord, onOpenForm, onBookGuest, visit = false }: { readonly onOpenForm?: (id: string) => void; readonly onOpenRecord?: (object: string, id: string) => void; readonly visit?: boolean; readonly state: AppState; readonly form: AppForm; readonly dispatch: (a: AppAction) => void; readonly onBack: () => void; readonly onOpenPerson: (id: string) => void; readonly onBookGuest?: (who: { readonly name: string; readonly email: string }) => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('questions');
  const [guest, setGuest] = useState(visit);
  /** Opening the form from a prefilled link: answers by question id. */
  const [prefill, setPrefill] = useState<Readonly<Record<string, string>>>();
  const [qr, setQr] = useState(false);
  const [toBooking, setToBooking] = useState<{ readonly name: string; readonly email: string }>();
  const [discarding, setDiscarding] = useState(false);
  const [respFind, setRespFind] = useState('');
  const [openResp, setOpenResp] = useState<string>();
  const [showSpam, setShowSpam] = useState(false);
  /** Changes to this form apply to its latest version, so an Undo later never brings back older edits. */
  const set = (patch: Partial<AppForm>) => dispatch({ type: 'form/patch', id: form.id, patch: () => ({ ...patch, updated: new Date() }) });
  const patchResponses = (fn: (rs: ReadonlyArray<FormResponse>) => ReadonlyArray<FormResponse>) => dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ responses: fn(f.responses) }) });
  const url = `timefix.com/f/${form.slug}`;
  const copy = () => { void copyText(`https://${url}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. The link is ${url}`, tone: 'danger' })); };
  const empty = form.questions.length === 0;
  const slugTaken = state.forms.some((f) => f.id !== form.id && f.slug === form.slug);
  const publish = () => {
    if (empty) { setTab('questions'); toast({ message: 'Add a question first. A form needs at least one.', tone: 'danger' }); return; }
    if (slugTaken) { setTab('settings'); toast({ message: 'Another form uses this link. Change it in Settings first.', tone: 'danger' }); return; }
    const first = form.status === 'draft'; set({ status: form.status === 'paused' ? 'paused' : 'live', live: form.questions, liveConfig: configOf(form) });
    toast({ message: first ? 'Your form is live. Share the link.' : form.status === 'paused' ? 'Published. Visitors see it when you resume answers.' : 'Published. Visitors see the new version.', tone: 'success', action: first ? { label: 'Copy link', onAction: copy } : undefined });
  };
  // A live form made before settings were versioned (the seed) gets its current settings as the published ones, so later edits wait for Publish.
  useEffect(() => { if (form.status !== 'draft' && form.liveConfig === undefined) dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ liveConfig: configOf(f), live: f.live ?? f.questions }) }); }, [form.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownToVisitors = liveView(form);
  // Visitors to a live form get what was published after sending (thanks, button, booking or website), not the draft.
  const after = form.status === 'live' ? shownToVisitors.after : form.after;
  const questions = shownToVisitors.questions;
  const target = form.saveTo;
  const targetName = (n: number) => objectWord(state, target, n);
  /** Each question's field on the target: the one picked in Records, else the guess. "none" keeps the answer on the form only. */
  const attrOf = (q: FormQuestion) => (shownToVisitors.mapping ?? {})[q.id] ?? guessFor(target, q);
  /** Name and email from the questions that fill them. */
  const who = (r: FormResponse) => {
    const byAttr = (attr: string) => questions.find((q) => attrOf(q) === attr);
    const n = byAttr('name'); const e = byAttr('email') ?? questions.find((q) => q.kind === 'email');
    return { name: (n && r.answers[n.id]?.trim()) || '', email: (e && r.answers[e.id]?.trim()) || '' };
  };
  /** Files a response as its target record: the one it matches is updated, else a new one is added. Never a second copy. */
  const file = (r: FormResponse, quiet = false, madeNow?: Map<string, string>): { readonly object: string; readonly id: string } | undefined => {
    const out = fileResponse(state, form, questions, attrOf, r, dispatch, madeNow);
    if (!out) { if (!quiet) toast({ message: `This response has nothing to file a ${targetName(1)} under. Pick which question gives the name or email in Records.`, tone: 'danger' }); return undefined; }
    if (!quiet) toast({ message: out.matched ? `Filed under ${out.label}, already in ${targetName(2)}` : `${out.label} added to ${targetName(2)}`, tone: 'success', action: onOpenRecord ? { label: 'Open', onAction: () => onOpenRecord(out.object, out.id) } : undefined });
    return { object: out.object, id: out.id };
  };
  const responses = form.responses.filter((r) => (showSpam ? r.spam : !r.spam) && (!respFind.trim() || Object.values(r.answers).some((v) => v.toLowerCase().includes(respFind.trim().toLowerCase()))));
  const resp = form.responses.find((r) => r.id === openResp);
  const setResp = (r: FormResponse) => patchResponses((rs) => rs.map((x) => (x.id === r.id ? r : x)));
  const setRespBack = (r: FormResponse) => patchResponses((rs) => [...rs, r].sort((a, b) => b.at.getTime() - a.at.getTime()));
  const addToPeople = (r: FormResponse) => { const ref = file(r); if (ref) setResp({ ...r, record: ref, personId: ref.object === 'people' ? ref.id : r.personId }); };
  const filedAs = (r: FormResponse) => r.record ?? (r.personId ? { object: 'people', id: r.personId } : undefined);
  const finishes = form.responses.filter((r) => !r.spam).length;
  const live = form.status === 'live';
  // A visit to the live page counts as a view; each question reached feeds "Where people stop".
  useEffect(() => { if (guest && live && !closedNow(form) && form.status === 'live') dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ views: f.views + 1 }) }); }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps
  const reach = (qid: string) => dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ reached: { ...(f.reached ?? {}), [qid]: (f.reached?.[qid] ?? 0) + 1 } }) });
  if (guest && toBooking) return <BookingCountdown name={toBooking.name} onGo={() => { const w = toBooking; setToBooking(undefined); setGuest(false); onBookGuest?.(w); }} onStay={() => { setToBooking(undefined); setGuest(false); }} />;
  if (guest) {
    return (
      <div className="tf-forms__guest">
        <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => { setGuest(false); setPrefill(undefined); }}>Back to the form</Button><span className="tf-rec__muted">{url}</span>
          {!live && <Tag size="sm" hue="orange">Preview · answers aren’t saved</Tag>}</div>
        {form.status === 'paused' || closedNow(form) ? <EmptyState icon={<Pause size={20} strokeWidth={1.75} />} title="This form is closed" description={form.closedMessage || `${form.owner.split(' ')[0]} isn't taking answers right now.`} /> : (
          <HostedForm title={live ? shownToVisitors.name : form.name} description={live ? shownToVisitors.subtitle : form.subtitle} logic={(live ? shownToVisitors.mode : form.mode) === 'one' ? (live ? shownToVisitors.logic : form.logic) : undefined} questions={live ? questions : form.questions} mode={live ? shownToVisitors.mode : form.mode} thanks={{ title: 'Thanks, we got it.', line: after.kind === 'redirect' && after.url ? `${after.message} Visitors now go to ${after.url}.` : after.message, action: after.kind === 'thanks' && after.button?.label && after.button.url ? { label: after.button.label, href: after.button.url } : undefined }} onReach={live ? reach : undefined} submitLabel={form.submitLabel || undefined} prefill={prefill} brand={{ name: state.prefs.workspace.name, logoSrc: state.prefs.workspace.logo, line: form.owner ? `Answers go to ${form.owner.split(' ')[0]}` : undefined }}
            onSubmit={(answers) => new Promise<void>((resolve) => {
              const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join(', ') : '']));
              window.setTimeout(() => {
                const w = formWho(live ? questions : form.questions, flat);
                if (live) {
                  const r: FormResponse = { id: newId('r'), at: new Date(), answers: flat };
                  const ref = form.saveTo !== 'none' ? file(r, true) : undefined;
                  patchResponses((rs) => [{ ...r, record: ref, personId: ref?.object === 'people' ? ref.id : undefined }, ...rs]);
                  const told = [...(form.notify ?? []), ...(form.confirmEmail && w.email ? [w.email] : [])];
                  if (told.length) toast({ message: `Emailed ${told.map((x) => x.split(' ')[0]).join(', ')}` });
                }
                if (after.kind === 'booking' && onBookGuest) setToBooking(w);
                resolve();
              }, 500);
            })} />
        )}
      </div>
    );
  }
  return (
    <div className="tf-forms tf-forms--edit">
      <div className="tf-forms__head">
        <IconButton label="All forms" onPress={onBack}><ArrowLeft {...i16} /></IconButton>
        <TextField aria-label="Form name" value={form.name} onChange={(name) => set({ name })} onBlur={() => { if (!form.name.trim()) set({ name: 'Untitled form' }); }} className="tf-forms__name" />
        <FormStatusTag status={statusOf(form)} />
        {edited(form) && <Tag size="sm" hue="orange">Edited, not published</Tag>}
        <span className="tf-rec__spacer" />
        <Button variant="ghost" icon={<Copy {...i14} />} onPress={copy} isDisabled={form.status === 'draft'}>Copy link</Button>
        <Button variant="secondary" icon={<ExternalLink {...i14} />} onPress={() => setGuest(true)}>{live ? 'Open as a visitor' : 'Preview'}</Button>
        <Button variant="primary" isDisabled={form.status !== 'draft' && !edited(form)} onPress={publish}>{form.status === 'draft' ? 'Publish' : 'Publish changes'}</Button>
        <MenuTrigger>
          <IconButton label="More for this form"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="Form" placement="bottom end" onAction={(k) => {
            if (k === 'pause') { const was = form.status; set({ status: was === 'paused' ? 'live' : 'paused' }); toast({ message: was === 'paused' ? 'Taking answers again' : 'Paused. Visitors see that it’s closed.', action: { label: 'Undo', onAction: () => set({ status: was }) } }); }
            else if (k === 'discard') setDiscarding(true);
            else if (k === 'duplicate') { const id = newId('f'); const base = form.slug.replace(/-copy(-\d+)?$/, ''); let slug = `${base}-copy`; let n = 2; while (state.forms.some((f) => f.slug === slug)) { slug = `${base}-copy-${n}`; n += 1; }
              dispatch({ type: 'form/set', form: { ...form, id, name: `${form.name} (copy)`, slug, status: 'draft', live: undefined, liveConfig: undefined, responses: [], views: 0, updated: new Date() } }); onOpenForm?.(id); toast({ message: `${form.name} copied as a draft, without its responses`, tone: 'success' }); }
            else if (k === 'delete') { const before = form; const at = state.forms.findIndex((f) => f.id === form.id); dispatch({ type: 'form/remove', id: form.id }); onBack(); toast({ message: `${form.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'form/insert', form: before, at }) } }); }
          }}>
            {form.status !== 'draft' && <MenuItem id="pause" icon={form.status === 'paused' ? <Play {...i16} /> : <Pause {...i16} />}>{form.status === 'paused' ? 'Resume' : 'Pause answers'}</MenuItem>}
            {edited(form) && <MenuItem id="discard">Discard changes</MenuItem>}
            <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate form</MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete form</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <Tabs aria-label="Form" selectedKey={tab} onSelectionChange={setTab}
        items={[{ id: 'questions', label: 'Questions', count: form.questions.length }, { id: 'settings', label: 'Settings' }, { id: 'records', label: 'Records' }, { id: 'share', label: 'Share' }, { id: 'responses', label: 'Responses', count: finishes }, { id: 'results', label: 'Results' }]}>
        <TabPanel id="questions" className="tf-forms__panel">
          <div className="tf-forms__build">
            <div className="tf-forms__builder"><QuestionBuilder title="" questions={form.questions} onChange={(questions) => { if (questions.length > MAX_QUESTIONS) { toast({ message: `A form holds up to ${MAX_QUESTIONS} questions. Split it into two forms.`, tone: 'danger' }); return; } set({ questions }); }} />
              {form.questions.length >= MAX_QUESTIONS - 10 ? <p className="tf-rec__muted tf-num">{form.questions.length} of {MAX_QUESTIONS} questions</p> : null}</div>
            <div className="tf-forms__preview"><HostedFormPreview title={form.name} description={form.subtitle} questions={form.questions} mode={form.mode} logic={form.mode === 'one' ? form.logic : undefined} address={url} onSubmit={() => Promise.resolve()} /></div>
          </div>
        </TabPanel>
        <TabPanel id="settings" className="tf-forms__panel">
          <div className="tf-forms__setgrid">
          <div className="tf-forms__settings">
            <div className="tf-bkf__group"><span className="tf-bkf__label">Layout</span>
              <SegmentedControl aria-label="Layout" selectedKey={form.mode} onSelectionChange={(k) => set({ mode: k === 'page' ? 'page' : 'one' })} items={[{ id: 'one', label: 'One question at a time' }, { id: 'page', label: 'Classic: all on one page' }]} /></div>
            <TextArea label="Subtitle" aside="Optional" rows={2} value={form.subtitle ?? ''} onChange={(subtitle) => set({ subtitle: subtitle || undefined })} description="A line under the title, like what it’s for or how long it takes." />
            <TextField label="Link" value={form.slug} onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} onBlur={() => { const clean = form.slug.replace(/-+/g, '-').replace(/^-|-$/g, ''); if (clean !== form.slug || !clean) set({ slug: clean || `form-${form.id.slice(-4)}` }); }}
              isInvalid={state.forms.some((f) => f.id !== form.id && f.slug === form.slug)} errorMessage={state.forms.some((f) => f.id !== form.id && f.slug === form.slug) ? 'Another form uses this link' : undefined} description="The address of the form. Change it before you share it." />
            {form.mode === 'one' && <ShowMore showLabel="More options" hideLabel="Fewer options" defaultExpanded={Boolean(form.logic?.length)}>
              <LogicEditor form={form} onChange={(logic) => set({ logic })} />
            </ShowMore>}
            <Select label="Owner" value={form.owner} onChange={(v) => set({ owner: v ?? form.owner })} items={state.members.map((m) => ({ id: m.name, label: m.name }))} />
            <TextField label="Last button says" aside="Optional" value={form.submitLabel ?? ''} placeholder="Submit" onChange={(v) => set({ submitLabel: v || undefined })} description="Like “Get my quote” or “Send”." />
            <div className="tf-bkf__group"><span className="tf-bkf__label">Closing</span>
              <div className="tf-bkf__pair">
                <TextField label="Stop taking answers on" aside="Optional" type="date" value={form.closesOn ?? ''} onChange={(v) => set({ closesOn: v || undefined })} />
                <TextField label="Or after this many" aside="Optional" inputMode="numeric" value={form.maxResponses ? String(form.maxResponses) : ''} onChange={(v) => { const n = Number(v.replace(/[^\d]/g, '')); set({ maxResponses: n > 0 ? n : undefined }); }} description={form.maxResponses ? `${finishes} of ${form.maxResponses} so far` : undefined} />
              </div>
              {(form.closesOn || form.maxResponses) && <TextArea label="What visitors see when it’s closed" rows={2} value={form.closedMessage ?? ''} placeholder={`${form.owner.split(' ')[0]} isn't taking answers right now.`} onChange={(v) => set({ closedMessage: v || undefined })} />}
              {closedNow(form) && <Callout tone="warning">Closed now: {form.closesOn && new Date(`${form.closesOn}T23:59`) < new Date() ? 'the date has passed' : 'it reached its limit'}. Visitors see the closed message.</Callout>}
            </div>
            <div className="tf-bkf__group"><span className="tf-bkf__label">Emails</span>
              <Select label="Email each response to" value={form.notify?.[0] ?? 'none'} onChange={(v) => set({ notify: v && v !== 'none' ? [v] : undefined })} items={[{ id: 'none', label: 'Nobody (the Inbox still gets it)' }, ...state.members.map((m) => ({ id: m.name, label: m.name }))]} />
              <div className="tf-set__switch"><span><strong>Send them a confirmation</strong><span className="tf-rec__muted">To the email they gave, with their answers.</span></span><Switch aria-label="Send a confirmation" isSelected={Boolean(form.confirmEmail)} onChange={(on) => set({ confirmEmail: on ? { subject: `We got your answers: ${form.name}`, line: 'Thanks for writing. We’ll be in touch soon.' } : undefined })} /></div>
              {form.confirmEmail && <div className="tf-bkf__pair"><TextField label="Subject" value={form.confirmEmail.subject} onChange={(subject) => set({ confirmEmail: { ...(form.confirmEmail ?? { line: '' }), subject } })} /><TextField label="First line" value={form.confirmEmail.line} onChange={(line) => set({ confirmEmail: { ...(form.confirmEmail ?? { subject: '' }), line } })} /></div>}
            </div>
            <div className="tf-bkf__group"><span className="tf-bkf__label">After they send</span>
              <SegmentedControl aria-label="After they send" selectedKey={form.after.kind} onSelectionChange={(k) => set({ after: { ...form.after, kind: k === 'booking' ? 'booking' : k === 'redirect' ? 'redirect' : 'thanks' } })} items={[{ id: 'thanks', label: 'Say thanks' }, { id: 'booking', label: 'Book a meeting' }, { id: 'redirect', label: 'Go to a website' }]} />
              {form.after.kind === 'redirect' && <TextField label="Website" value={form.after.url ?? ''} placeholder="https://example.com/thanks" onChange={(url) => set({ after: { ...form.after, url } })} isInvalid={Boolean(form.after.url) && !/^https?:\/\/\S+\.\S+/.test(form.after.url ?? '')} errorMessage="Start with https:// and include the domain." />}
              <TextArea label="Message" rows={2} value={form.after.message} onChange={(message) => set({ after: { ...form.after, message } })} />
              {form.after.kind === 'thanks' && <div className="tf-set__switch"><span><strong>Add a button</strong><span className="tf-rec__muted">Under the message, like “See our pricing”. Opens in a new tab.</span></span><Switch aria-label="Add a button" isSelected={Boolean(form.after.button)} onChange={(on) => set({ after: { ...form.after, button: on ? { label: 'Visit our website', url: '' } : undefined } })} /></div>}
              {form.after.kind === 'thanks' && form.after.button && <div className="tf-bkf__pair"><TextField label="Button words" value={form.after.button.label} onChange={(label) => set({ after: { ...form.after, button: { url: form.after.button?.url ?? '', label } } })} onBlur={() => { if (!form.after.button?.label.trim()) set({ after: { ...form.after, button: { url: form.after.button?.url ?? '', label: 'Visit our website' } } }); }} />
                <TextField label="Button link" placeholder="https://example.com/pricing" value={form.after.button.url} onChange={(url) => set({ after: { ...form.after, button: { label: form.after.button?.label ?? '', url } } })} isInvalid={Boolean(form.after.button.url) && !/^https?:\/\/\S+\.\S+/.test(form.after.button.url)} errorMessage="Start with https:// and include the domain." description={form.after.button.url ? undefined : 'Without a link the button stays hidden.'} /></div>}
              {form.after.kind === 'booking' && <p className="tf-rec__muted">They go straight to your booking page with their name and email filled in, so they only pick a time.</p>}
            </div>
          </div>
          {/* The form at a glance, with the switches people look for before publishing (owner's 11 Nov reference). */}
          <aside className="tf-forms__summary" aria-label="Form summary">
            <SettingsSection title="Form summary">
              <dl className="tf-set__facts">
                {[['Questions', String(form.questions.filter((q) => q.kind !== 'statement').length)], ['Required', String(form.questions.filter((q) => q.required).length)],
                  ['Answers go to', form.saveTo === 'none' ? 'This form only' : objectWord(state, form.saveTo, 2)], ['Owner', form.owner], ['Status', form.status === 'live' ? (edited(form) ? 'Live, with unpublished edits' : 'Live') : form.status === 'paused' ? 'Paused' : 'Draft']]
                  .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </SettingsSection>
            <SettingsSection title="When someone answers">
              <div className="tf-set__switch"><span><strong>Email {form.notify?.[0]?.split(' ')[0] ?? form.owner.split(' ')[0]}</strong><span className="tf-rec__muted">Each response, as it arrives.</span></span><Switch aria-label="Email each response" isSelected={Boolean(form.notify?.length)} onChange={(on) => set({ notify: on ? [form.owner] : undefined })} /></div>
              <div className="tf-set__switch"><span><strong>Confirm to them</strong><span className="tf-rec__muted">An email with their answers.</span></span><Switch aria-label="Send a confirmation email" isSelected={Boolean(form.confirmEmail)} onChange={(on) => set({ confirmEmail: on ? { subject: `We got your answers: ${form.name}`, line: 'Thanks for writing. We’ll be in touch soon.' } : undefined })} /></div>
              <div className="tf-set__switch"><span><strong>Spam check</strong><span className="tf-rec__muted">Bot answers go to Spam, out of your way.</span></span><Tag size="sm" hue="green">On</Tag></div>
            </SettingsSection>
            {form.status === 'draft' ? <Button variant="primary" onPress={publish}>Publish form</Button> : edited(form) ? <Button variant="primary" onPress={publish}>Publish changes</Button> : <p className="tf-rec__muted">Live at {url}. Share it from Share.</p>}
          </aside>
          </div>
        </TabPanel>
        <TabPanel id="records" className="tf-forms__panel">
          <RecordsPanel state={state} form={form} dispatch={dispatch} set={set} attrOf={(q) => (form.mapping ?? {})[q.id] ?? guessFor(form.saveTo, q)} unfiled={form.responses.filter((r) => !r.spam && !filedAs(r)).length} onFileEarlier={() => setTab('responses')} />
        </TabPanel>
        <TabPanel id="share" className="tf-forms__panel">
          {form.status === 'draft' ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="Publish to share" description="The link and embeds work once the form is live." action={<Button size="sm" variant="primary" onPress={publish}>Publish</Button>} /> : (
            <div className="tf-forms__settings">
              <div className="tf-forms__link"><span className="tf-num">{url}</span><Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={copy}>Copy</Button><Button size="sm" variant="secondary" icon={<QrIcon {...i14} />} onPress={() => setQr(true)}>QR code</Button></div>
              {qr && <QrSheet url={url} name={form.name} onClose={() => setQr(false)} />}
              <span className="tf-bkf__label">On your website</span>
              <ul className="tf-forms__embeds">
                {[{ id: 'inline', t: 'In the page', d: 'The form sits in your page like a section.' }, { id: 'popup', t: 'As a popup', d: 'A button opens it over your page.' }, { id: 'floating', t: 'Floating button', d: 'A small button in the corner, on every page.' }].map((e) => (
                  <li key={e.id}><strong>{e.t}</strong><span className="tf-rec__muted">{e.d}</span>
                    <Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => { void copyText(`<script src="https://timefix.com/embed.js" data-form="${form.slug}" data-mode="${e.id}"></script>`).then((ok) => toast(ok ? { message: 'Code copied', tone: 'success' } : { message: 'Copy didn’t work. Try again, or ask us for the code.', tone: 'danger' })); }}>Copy code</Button></li>
                ))}
              </ul>
              <span className="tf-bkf__label">Fill answers from the link</span>
              <p className="tf-rec__muted">Add any of these to the link and the form opens with the answer filled in. Hidden fields read theirs from here.</p>
              <ul className="tf-set__list">{questions.filter((q) => q.kind !== 'statement').map((q) => <li key={q.id}><span>{q.title || 'Untitled question'}</span><code className="tf-forms__key">?{keyOf(q)}=</code></li>)}</ul>
              {(() => { const sample = questions.filter((q) => q.kind === 'short' || q.kind === 'email' || q.kind === 'hidden').slice(0, 3); const vals = sample.map((q) => [q, q.kind === 'email' ? 'asha@example.com' : q.kind === 'hidden' ? 'newsletter' : 'Asha Rao'] as const); const link = `https://${url}?${vals.map(([q, v]) => `${keyOf(q)}=${encodeURIComponent(v)}`).join('&')}`;
                return sample.length ? <div className="tf-set__row"><TextField label="Example" value={link} isReadOnly className="tf-set__grow" /><Button size="sm" variant="secondary" onPress={() => { setPrefill(Object.fromEntries(vals.map(([q, v]) => [q.id, v]))); setGuest(true); }}>Open it</Button></div> : null; })()}
            </div>
          )}
        </TabPanel>
        <TabPanel id="responses" className="tf-forms__panel">
          <div className="tf-rec__bar"><SegmentedControl aria-label="Which" size="sm" selectedKey={showSpam ? 'spam' : 'in'} onSelectionChange={(k) => { setShowSpam(k === 'spam'); setOpenResp(undefined); }}
            items={[{ id: 'in', label: `Responses · ${finishes}` }, { id: 'spam', label: `Spam · ${form.responses.length - finishes}` }]} />
            <span className="tf-rec__spacer" />{form.responses.length > 3 && <SearchField label="Search answers" placeholder="Search answers" size="sm" value={respFind} onChange={setRespFind} />}
            {responses.length > 0 && <Button size="sm" variant="secondary" icon={<Download {...i14} />} onPress={() => {
              const qs = (form.live ?? form.questions).filter((q) => q.kind !== 'statement');
              const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
              const csv = [['Sent', ...qs.map((q) => q.title || 'Untitled'), 'Filed as'].map(esc).join(','), ...responses.map((r) => [r.at.toISOString(), ...qs.map((q) => r.answers[q.id] ?? ''), filedAs(r) ? objectWord(state, filedAs(r)?.object ?? target, 1) : ''].map(esc).join(','))].join('\n');
              void saveFile(`${form.slug}-responses.csv`, new Blob([csv], { type: 'text/csv' })).then((o) => { if (o === 'saved') { toast({ message: `${responses.length} ${responses.length === 1 ? 'response' : 'responses'} exported`, tone: 'success' }); dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: [{ id: newId('jb'), kind: 'export' as const, what: `${form.name} responses`, rows: responses.length, by: state.me, at: new Date(), file: csv, name: `${form.slug}-responses.csv` }, ...(q.jobs ?? [])].slice(0, 20) }) }); } });
            }}>{respFind.trim() ? `Export ${responses.length}` : 'Export CSV'}</Button>}</div>
          {(() => { const unfiled = form.responses.filter((r) => !r.spam && !filedAs(r)); return form.saveTo !== 'none' && !showSpam && unfiled.length > 0 ? (
            <Callout tone="info" action={{ label: `File ${unfiled.length}`, onPress: () => {
              const madeNow = new Map<string, string>(); const before = new Set(existingIds(state, target));
              const ids = unfiled.map((r) => ({ id: r.id, ref: file(r, true, madeNow) })); const filed = ids.filter((x) => x.ref);
              if (filed.length === 0) { toast({ message: `None of these answers has a name or email to file under. Pick which question gives it in Records.` }); return; }
              patchResponses((rs) => rs.map((x) => { const f = ids.find((y) => y.id === x.id); return f?.ref ? { ...x, record: f.ref, personId: f.ref.object === 'people' ? f.ref.id : x.personId } : x; }));
              const made = [...new Set(filed.map((x) => x.ref?.id).filter((rid): rid is string => rid !== undefined && !before.has(rid)))];
              toast({ message: `${filed.length} earlier ${filed.length === 1 ? 'answer' : 'answers'} filed in ${targetName(2)}${made.length ? ` (${made.length} new)` : ''}`, tone: 'success', action: { label: 'Undo', onAction: () => { patchResponses((rs) => rs.map((x) => (filed.some((y) => y.id === x.id) ? { ...x, record: undefined, personId: undefined } : x))); if (made.length) dropRecords(dispatch, target, made); } } });
            } }}>
              {unfiled.length === 1 ? `1 earlier answer isn’t in ${targetName(2)} yet.` : `${unfiled.length} earlier answers aren’t in ${targetName(2)} yet.`}</Callout>) : null; })()}
          {responses.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={showSpam ? 'No spam' : 'No responses yet'} description={showSpam ? 'Bot answers are kept here, out of your way.' : 'Share the link; answers show up here as they arrive.'} /> : (
            <div className="tf-forms__resp">
              <ul className="tf-forms__rows">
                {responses.map((r) => (
                  <li key={r.id}><button type="button" className="tf-forms__row" aria-current={openResp === r.id || undefined} onClick={() => setOpenResp(r.id)}>
                    <strong>{who(r).name || who(r).email || 'No name given'}</strong><span className="tf-rec__muted">{who(r).name ? who(r).email : Object.values(r.answers)[0]}</span>
                    <span className="tf-rec__muted tf-num">{ago(r.at)}</span>{filedAs(r) && <Tag size="sm" hue="green">In {objectWord(state, filedAs(r)?.object ?? target, 2)}</Tag>}
                  </button></li>
                ))}
              </ul>
              <div className="tf-forms__answer">
                {!resp ? <p className="tf-rec__muted">Pick a response to read it.</p> : (
                  <>
                    {(() => { const at = responses.findIndex((x) => x.id === resp.id); return responses.length > 1 && at >= 0 ? (
                      <div className="tf-rec__bar"><span className="tf-rec__muted tf-num">{at + 1} of {responses.length} · {ago(resp.at)}</span><span className="tf-rec__spacer" />
                        <IconButton size="sm" label="Previous response" isDisabled={at === 0} onPress={() => setOpenResp(responses[at - 1]?.id)}><ChevronUp {...i14} /></IconButton>
                        <IconButton size="sm" label="Next response" isDisabled={at === responses.length - 1} onPress={() => setOpenResp(responses[at + 1]?.id)}><ChevronDown {...i14} /></IconButton></div>) : null; })()}
                    <SentAnswers questions={form.live ?? form.questions} answers={resp.answers} />
                    <div className="tf-rec__bar">
                      {filedAs(resp) ? (onOpenRecord && <Button size="sm" variant="secondary" onPress={() => { const f = filedAs(resp); if (f) onOpenRecord(f.object, f.id); }}>Open {objectWord(state, filedAs(resp)?.object ?? target, 1)}</Button>)
                        : form.saveTo !== 'none' && !resp.spam && <Button size="sm" variant="secondary" icon={<UserPlus {...i14} />} onPress={() => addToPeople(resp)}>Add to {targetName(2)}</Button>}
                      <Button size="sm" variant="ghost" icon={<ShieldAlert {...i14} />} onPress={() => { setResp({ ...resp, spam: !resp.spam }); setOpenResp(undefined); toast({ message: resp.spam ? 'Moved back to responses' : 'Marked as spam', action: { label: 'Undo', onAction: () => setResp(resp) } }); }}>{resp.spam ? 'Not spam' : 'Spam'}</Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { const gone = resp; patchResponses((rs) => rs.filter((x) => x.id !== gone.id)); setOpenResp(undefined); toast({ message: 'Response deleted', action: { label: 'Undo', onAction: () => setRespBack(gone) } }); }}>Delete</Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </TabPanel>
        <TabPanel id="results" className="tf-forms__panel">
          <div className="tf-home__stats">
            <StatCard label="Views" value={form.views} />
            <StatCard label="Responses" value={finishes} />
            <StatCard label="Of views" value={form.views ? Math.round((finishes / form.views) * 1000) / 10 : 0} format={(n) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`} />
            <StatCard label="Filed in People" value={form.responses.filter((r) => r.personId && !r.spam).length} />
          </div>
          <DropOff form={form} questions={questions} sent={form.responses.length} />
          {finishes === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No answers to sum up yet" description="Once people answer, each choice question shows how they answered." /> : (
            <section className="tf-recp__sec"><h3>How people answered</h3>
              {questions.filter((q) => q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating').map((q) => {
                const got = form.responses.filter((r) => !r.spam).map((r) => r.answers[q.id]).filter((v): v is string => Boolean(v));
                const counts = [...got.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]);
                return (
                  <div key={q.id} className="tf-forms__sum">
                    <h4 className="tf-forms__sumq">{q.title} <span className="tf-rec__muted tf-num">{got.length} {got.length === 1 ? 'answer' : 'answers'}</span></h4>
                    {counts.length === 0 ? <p className="tf-rec__muted">No one has answered this yet.</p> : <ul className="tf-forms__drop">
                      {counts.map(([v, n]) => { const pct = Math.round((n / Math.max(1, got.length)) * 100); return (
                        <li key={v}><span>{v}</span><span className="tf-forms__bar" aria-hidden><span data-w={Math.round(pct / 10) * 10} /></span><span className="tf-num tf-rec__muted">{n} · {pct}%</span></li>
                      ); })}
                    </ul>}
                  </div>
                );
              })}
              {questions.filter((q) => q.kind === 'short' || q.kind === 'long').map((q) => { const got = form.responses.filter((r) => !r.spam && r.answers[q.id]?.trim()).slice(0, 3); return got.length === 0 ? null : (
                <div key={q.id} className="tf-forms__sum"><h4 className="tf-forms__sumq">{q.title} <span className="tf-rec__muted tf-num">latest {got.length}</span></h4>
                  <ul className="tf-set__list">{got.map((r) => <li key={r.id}><span>“{r.answers[q.id]}”</span><span className="tf-rec__muted tf-num">{ago(r.at)}</span></li>)}</ul></div>); })}
            </section>
          )}
        </TabPanel>
      </Tabs>
      {discarding && <Dialog isOpen onOpenChange={(o) => { if (!o) setDiscarding(false); }} title="Discard your changes?" description="The form goes back to what visitors see now. You can undo this."
        actions={<><Button variant="ghost" slot="close">Keep editing</Button><Button variant="danger" onPress={() => { setDiscarding(false); const was = { questions: form.questions, name: form.name, mode: form.mode, after: form.after, subtitle: form.subtitle, mapping: form.mapping, logic: form.logic }; const cfg = form.liveConfig ? (JSON.parse(form.liveConfig) as Pick<AppForm, 'name' | 'mode' | 'after'>) : {}; set({ questions: form.live ?? form.questions, ...cfg }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => set(was) } }); }}>Discard changes</Button></>} />}
    </div>
  );
}


/** Where people stop (Tally's drop-off): of those who started, how many reached each question, and the biggest drop flagged. One at a time only. */
function DropOff({ form, questions, sent }: { readonly form: AppForm; readonly questions: ReadonlyArray<FormQuestion>; readonly sent: number }) {
  const shown = questions.filter((q) => q.kind !== 'hidden');
  if (form.mode !== 'one' || shown.length < 2) return null;
  const started = form.reached?.[shown[0]?.id ?? ''] ?? 0;
  const rows = [...shown.map((q) => ({ id: q.id, label: q.title || 'Untitled question', n: form.reached?.[q.id] ?? 0 })), { id: 'sent', label: 'Sent', n: sent }];
  // The biggest fall between one step and the next, by people lost.
  const worst = rows.slice(1).reduce<{ readonly at: number; readonly lost: number }>((w, r, n) => { const lost = (rows[n]?.n ?? 0) - r.n; return lost > w.lost ? { at: n + 1, lost } : w; }, { at: -1, lost: 0 });
  return (
    <section className="tf-recp__sec"><h3>Where people stop</h3>
      {started === 0 ? <p className="tf-rec__muted">Nobody has started this form since it went live. Share the link and this fills in as people answer.</p> : <>
        <p className="tf-rec__muted tf-num">{started.toLocaleString('en-IN')} started · {form.views ? Math.round((started / form.views) * 100) : 0}% of views · {Math.round((sent / started) * 100)}% of starts sent it</p>
        <ul className="tf-forms__drop tf-forms__drop--funnel">
          {rows.map((r, n) => { const pct = Math.round((Math.min(r.n, started) / started) * 100); return (
            <li key={r.id} data-worst={n === worst.at || undefined}><span className="tf-forms__funq"><span className="tf-num tf-rec__muted">{r.id === 'sent' ? '' : n + 1}</span>{r.label}{n === worst.at && <Tag size="sm" hue="orange">Most leave here</Tag>}</span>
              <span className="tf-forms__bar" aria-hidden><span data-w={Math.round(pct / 10) * 10} /></span><span className="tf-num tf-rec__muted">{r.n.toLocaleString('en-IN')} · {pct}%</span></li>); })}
        </ul></>}
    </section>
  );
}

/** After a form that books: a short count, then the booking page, with a way to stay. */
function BookingCountdown({ name, onGo, onStay }: { readonly name: string; readonly onGo: () => void; readonly onStay: () => void }) {
  const [left, setLeft] = useState(3);
  const go = useRef(onGo); go.current = onGo;
  useEffect(() => { if (left <= 0) { go.current(); return undefined; } const t = window.setTimeout(() => setLeft((n) => n - 1), 1000); return () => window.clearTimeout(t); }, [left]);
  return (
    <div className="tf-forms__guest"><div className="tf-app__empty">
      <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={`Thanks${name ? `, ${name.split(' ')[0]}` : ''}. Now pick a time.`} description={`Taking you to the booking page in ${left}…`}
        action={<span className="tf-set__row"><Button size="sm" variant="primary" onPress={onGo}>Pick a time now</Button><Button size="sm" variant="ghost" onPress={onStay}>Stay here</Button></span>} />
    </div></div>
  );
}

/** "If <question> is <answer>, go to <question>", in plain words. Only for questions with set answers. */
function LogicEditor({ form, onChange }: { readonly form: AppForm; readonly onChange: (l: AppForm['logic']) => void }) {
  const rules = form.logic ?? [];
  const pickable = form.questions.filter((q) => (q.kind === 'choice' || q.kind === 'dropdown') && (q.options?.length ?? 0) > 0);
  const title = (id: string) => (id === 'end' ? 'the end' : form.questions.find((q) => q.id === id)?.title ?? 'a deleted question');
  if (pickable.length === 0) return null;
  const add = () => { const q = pickable[0]; if (!q) return; const later = form.questions.slice(form.questions.findIndex((x) => x.id === q.id) + 2)[0]; onChange([...rules, { id: newId('rule'), when: q.id, is: q.options?.[0] ?? '', goto: later?.id ?? 'end' }]); };
  return (
    <div className="tf-bkf__group"><span className="tf-bkf__label">Skip questions by answer</span>
      {rules.length === 0 && <p className="tf-rec__muted">Everyone sees every question, in order.</p>}
      <ul className="tf-set__list">{rules.map((r) => { const q = form.questions.find((x) => x.id === r.when); const after = form.questions.slice(form.questions.findIndex((x) => x.id === r.when) + 1); return (
        <li key={r.id} className="tf-forms__rule">
          <span>If</span><Select label="Question" isLabelHidden className="tf-you__select" value={r.when} onChange={(v) => { const nq = pickable.find((x) => x.id === v); if (nq) onChange(rules.map((x) => (x.id === r.id ? { ...x, when: nq.id, is: nq.options?.[0] ?? '' } : x))); }} items={pickable.map((x) => ({ id: x.id, label: x.title }))} />
          <span>is</span><Select label="Answer" isLabelHidden className="tf-you__select" value={r.is} onChange={(v) => { if (v) onChange(rules.map((x) => (x.id === r.id ? { ...x, is: v } : x))); }} items={(q?.options ?? []).map((o) => ({ id: o, label: o }))} />
          <span>go to</span><Select label="Go to" isLabelHidden className="tf-you__select" value={r.goto} onChange={(v) => { if (v) onChange(rules.map((x) => (x.id === r.id ? { ...x, goto: v } : x))); }} items={[...after.map((x) => ({ id: x.id, label: x.title })), { id: 'end', label: 'The end (send)' }]} />
          <Button size="sm" variant="ghost" onPress={() => onChange(rules.filter((x) => x.id !== r.id))}>Remove</Button>
          {!q || !(q.options ?? []).includes(r.is) || (r.goto !== 'end' && !after.some((x) => x.id === r.goto))
            ? <span className="tf-forms__rule-say tf-forms__rule-bad" role="alert">This rule no longer matches the questions (one was renamed, moved or deleted). Pick again or remove it.</span>
            : <span className="tf-rec__muted tf-forms__rule-say">If “{title(r.when)}” is {r.is}, they go to {title(r.goto)}.</span>}
        </li>); })}</ul>
      <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={add}>Add a rule</Button>
    </div>
  );
}

/* ---------- Forms → records ---------- */

const BUILT_IN: ReadonlyArray<string> = ['people', 'companies', 'deals'];
/** "person" / "People": an object's word for one record (lower case) or many (as the sidebar names them). */
export const objectWord = (state: AppState, object: string, n: number) => { const o = state.objects.find((x) => x.id === object); if (!o) return n === 1 ? 'record' : 'Records'; return n === 1 ? o.one.toLowerCase() : o.many; };
const defaultMatch = (target: string) => (target === 'people' ? 'email' : target === 'companies' ? 'domain' : 'name');
/** The fields a question can fill on each kind of record. */
export function fieldsFor(state: AppState, target: string): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const base = target === 'people' ? [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['title', 'Job title'], ['company', 'Company (by name)']]
    : target === 'companies' ? [['name', 'Name'], ['domain', 'Website or domain'], ['industry', 'Industry'], ['city', 'City']]
      : target === 'deals' ? [['name', 'Deal name'], ['amount', 'Amount'], ['company', 'Company (by name)']] : [['name', 'Name']];
  const taken = new Set([...base.map(([id]) => id), 'tags', 'owner', 'created', 'size', 'stage', 'close', 'contact', 'lastContact']);
  const own = (state.objects.find((o) => o.id === target)?.attributes ?? []).filter((a) => !a.isSystem && !taken.has(a.id)).map((a) => ({ id: a.id, label: a.name }));
  return [...base.map(([id, label]) => ({ id: id ?? '', label: label ?? '' })), ...own];
}
/** A sensible field for a question before anyone picks one. */
export function guessFor(target: string, q: FormQuestion): string {
  const t = q.title.toLowerCase();
  if (target === 'people') return /compan|organi[sz]ation|business/.test(t) && q.kind === 'short' ? 'company' : guessAttr(q);
  if (target === 'companies') return q.kind === 'url' || /website|domain/.test(t) ? 'domain' : /industry/.test(t) ? 'industry' : /city|where/.test(t) ? 'city' : /compan|business|name/.test(t) && q.kind === 'short' ? 'name' : 'none';
  if (target === 'deals') return /compan|business/.test(t) && q.kind === 'short' ? 'company' : q.kind === 'number' || /budget|amount|value/.test(t) ? 'amount' : /project|deal/.test(t) ? 'name' : 'none';
  return /name/.test(t) && q.kind === 'short' ? 'name' : 'none';
}
export const existingIds = (state: AppState, target: string): ReadonlyArray<string> => (target === 'people' ? state.people : target === 'companies' ? state.companies : target === 'deals' ? state.deals : state.customRecords[target] ?? []).map((x) => x.id);
export const dropRecords = (dispatch: (a: AppAction) => void, target: string, ids: ReadonlyArray<string>) => { if (BUILT_IN.includes(target)) dispatch({ type: 'records/drop', object: target as ObjectId, ids }); else dispatch({ type: 'custom/remove', object: target, ids }); };

/** Files one response as its target record and returns what it touched. The match key decides update versus new; nothing is filed twice. */
export function fileResponse(state: AppState, form: AppForm, questions: ReadonlyArray<FormQuestion>, attrOf: (q: FormQuestion) => string, r: FormResponse, dispatch: (a: AppAction) => void, madeNow?: Map<string, string>):
  { readonly object: string; readonly id: string; readonly label: string; readonly matched: boolean } | undefined {
  const target = form.saveTo; if (target === 'none') return undefined;
  const f: Record<string, string> = {};
  for (const q of questions) { const a = attrOf(q); const v = (r.answers[q.id] ?? '').trim(); if (v && a !== 'none') f[a] = v; }
  const emailQ = questions.find((q) => q.kind === 'email'); const email = f.email ?? (emailQ ? (r.answers[emailQ.id] ?? '').trim() : '');
  const by = form.matchBy ?? defaultMatch(target);
  const domain = (f.domain ?? email.split('@')[1] ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const key = (by === 'email' ? email : by === 'phone' ? f.phone ?? '' : by === 'domain' ? domain : f.name ?? '').toLowerCase();
  const label = f.name || email || domain || 'New record';
  if (!key && !f.name && !email) return undefined;
  const memo = key ? madeNow?.get(`${target}:${key}`) : undefined;
  if (memo) return { object: target, id: memo, label, matched: true };
  const tags = form.tagWith === false ? [] : [form.name];
  const now = new Date();
  const known = new Set(['name', 'email', 'phone', 'title', 'company', 'domain', 'industry', 'city', 'amount']);
  const extra = Object.fromEntries(Object.entries(f).filter(([k]) => !known.has(k)));
  const hasExtra = Object.keys(extra).length > 0;
  /** A company by the name given: the one already there, else a new one. */
  const companyFor = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    const found = state.companies.find((c) => c.name.toLowerCase() === name.toLowerCase()); if (found) return found.id;
    const id = newId('c'); dispatch({ type: 'company/set', company: { id, name, domain: domain && target === 'people' ? domain : '', industry: '', size: '', city: '', owner: form.owner, created: now } }); return id;
  };
  let id: string; let matched = false;
  if (target === 'people') {
    const m = state.people.find((p) => (by === 'phone' ? (p.phone ?? '').toLowerCase() === key : by === 'name' ? p.name.toLowerCase() === key : p.email.toLowerCase() === key) && key !== '');
    const companyId = companyFor(f.company);
    if (m) { matched = true; id = m.id; dispatch({ type: 'records/fields', object: 'people', changes: [{ id: m.id, patch: { tags: [...new Set([...m.tags, ...tags])], ...(f.title ? { title: f.title } : {}), ...(f.phone ? { phone: f.phone } : {}), ...(companyId ? { companyId } : {}), ...(hasExtra ? { extra: { ...(m.extra ?? {}), ...extra } } : {}) } }] }); }
    else { id = newId('p'); dispatch({ type: 'person/set', person: { id, name: f.name || email, email, title: f.title ?? '', phone: f.phone, companyId, owner: form.owner, tags, created: now, extra: hasExtra ? extra : undefined } }); }
    dispatch({ type: 'activity/add', activity: { id: newId('a'), record: { object: 'people', id }, kind: 'form', actor: label, text: `sent ${form.name}`, at: r.at } });
    if (form.alsoDeal && !matched) dispatch({ type: 'deal/set', deal: { id: newId('d'), name: `${label} · ${form.name}`, companyId: companyId ?? '', contactId: id, stage: (STAGES as ReadonlyArray<string>).includes(form.alsoDeal.stage) ? form.alsoDeal.stage as typeof STAGES[number] : 'Lead', amount: Number((f.amount ?? '').replace(/[^\d.]/g, '')) || 0, owner: form.owner, close: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()), created: now } });
  } else if (target === 'companies') {
    const m = state.companies.find((c) => (by === 'name' ? c.name.toLowerCase() === key : c.domain.toLowerCase() === key) && key !== '');
    if (m) { matched = true; id = m.id; dispatch({ type: 'records/fields', object: 'companies', changes: [{ id: m.id, patch: { ...(f.industry ? { industry: f.industry } : {}), ...(f.city ? { city: f.city } : {}), ...(hasExtra ? { extra: { ...(m.extra ?? {}), ...extra } } : {}) } }] }); }
    else { id = newId('c'); dispatch({ type: 'company/set', company: { id, name: f.name || domain, domain, industry: f.industry ?? '', size: '', city: f.city ?? '', owner: form.owner, created: now, extra: hasExtra ? extra : undefined } }); }
    dispatch({ type: 'activity/add', activity: { id: newId('a'), record: { object: 'companies', id }, kind: 'form', actor: label, text: `sent ${form.name}`, at: r.at } });
  } else if (target === 'deals') {
    const m = by === 'name' && key ? state.deals.find((d) => d.name.toLowerCase() === key) : undefined;
    const companyId = companyFor(f.company);
    if (m) { matched = true; id = m.id; dispatch({ type: 'records/fields', object: 'deals', changes: [{ id: m.id, patch: { ...(f.amount ? { amount: Number(f.amount.replace(/[^\d.]/g, '')) || m.amount } : {}), ...(hasExtra ? { extra: { ...(m.extra ?? {}), ...extra } } : {}) } }] }); }
    else { id = newId('d'); dispatch({ type: 'deal/set', deal: { id, name: f.name || `${label} · ${form.name}`, companyId: companyId ?? '', stage: 'Lead', amount: Number((f.amount ?? '').replace(/[^\d.]/g, '')) || 0, owner: form.owner, close: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()), created: now, extra: hasExtra ? extra : undefined } }); }
  } else {
    const list = state.customRecords[target] ?? [];
    const m = key ? list.find((x) => x.name.toLowerCase() === key) : undefined;
    if (m) { matched = true; id = m.id; dispatch({ type: 'custom/set', object: target, record: { ...m, extra: { ...m.extra, ...extra } } }); }
    else { id = newId('cr'); dispatch({ type: 'custom/set', object: target, record: { id, name: f.name || label, owner: form.owner, created: now, extra } }); }
  }
  const list = form.toList ? state.lists.find((l) => l.id === form.toList && l.object === target) : undefined;
  if (list && !(list.oncePerRecord && list.entries.some((e) => e.recordId === id))) dispatch({ type: 'list/entries', id: list.id, add: [{ id: newId('e'), recordId: id, stage: list.stages[0] ?? '', priority: 'Medium', next: '', added: now }] });
  if (key) madeNow?.set(`${target}:${key}`, id);
  return { object: target, id, label: matched ? (target === 'people' ? state.people.find((p) => p.id === id)?.name ?? label : label) : label, matched };
}

/** Forms › Records: what each response becomes, how it finds the one it updates, which field each answer fills, and what else happens. */
function RecordsPanel({ state, form, dispatch, set, attrOf, unfiled, onFileEarlier }: { readonly state: AppState; readonly form: AppForm; readonly dispatch: (a: AppAction) => void; readonly set: (p: Partial<AppForm>) => void; readonly attrOf: (q: FormQuestion) => string; readonly unfiled: number; readonly onFileEarlier: () => void }) {
  const { toast } = useToast();
  const target = form.saveTo;
  const objects = state.objects.filter((o) => !o.archived);
  const fields = target === 'none' ? [] : fieldsFor(state, target);
  const by = form.matchBy ?? defaultMatch(target);
  const matchItems = target === 'people' ? [{ id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'name', label: 'Name' }] : target === 'companies' ? [{ id: 'domain', label: 'Domain (from the website or email)' }, { id: 'name', label: 'Name' }] : [{ id: 'name', label: 'Name' }];
  const answerable = form.questions.filter((q) => q.kind !== 'statement');
  const filled = answerable.filter((q) => attrOf(q) !== 'none');
  const label = (id: string) => fields.find((x) => x.id === id)?.label ?? id;
  const lists = state.lists.filter((l) => l.object === target && !l.archived);
  /** A field made from a question: its title becomes the name, its kind picks the type. */
  const newField = (q: FormQuestion) => {
    const o = state.objects.find((x) => x.id === target); if (!o) return;
    const id = newId('attr');
    const type = q.kind === 'number' ? 'number' : q.kind === 'date' ? 'date' : q.kind === 'email' ? 'email' : q.kind === 'phone' ? 'phone' : q.kind === 'url' ? 'url' : q.kind === 'long' ? 'longText' : 'text';
    dispatch({ type: 'object/set', object: { ...o, attributes: [...o.attributes, { id, name: q.title || 'New field', type }] } });
    set({ mapping: { ...(form.mapping ?? {}), [q.id]: id } });
    toast({ message: `${q.title || 'New field'} added to ${o.many}`, tone: 'success', action: { label: 'Undo', onAction: () => { dispatch({ type: 'object/set', object: o }); set({ mapping: form.mapping }); } } });
  };
  const summary = target === 'none' ? 'Answers stay on this form. Nothing is added to your records.' : [
    `Each response ${target === 'people' ? 'finds the person' : target === 'companies' ? 'finds the company' : `finds the ${objectWord(state, target, 1)}`} with the same ${matchItems.find((m) => m.id === by)?.label.toLowerCase().replace(/ \(.*\)/, '') ?? by} and updates it, or adds a new one`,
    filled.length ? `fills ${filled.length} ${filled.length === 1 ? 'field' : 'fields'}` : 'fills no fields yet',
    form.tagWith !== false && (target === 'people') ? `tags it “${form.name}”` : '',
    form.alsoDeal && target === 'people' ? `opens a deal in ${form.alsoDeal.stage} for each new person` : '',
    form.toList ? `adds it to ${state.lists.find((l) => l.id === form.toList)?.name ?? 'a list'}` : '',
  ].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
  const needsKey = target !== 'none' && !answerable.some((q) => attrOf(q) === 'name' || attrOf(q) === 'email' || q.kind === 'email');
  return (
    <div className="tf-forms__records">
      <SettingsSection title="Where answers go" description="Every response can add or update a record, so nobody is typed in twice.">
        <div className="tf-rec__form tf-set__narrow">
          <Select label="Each response becomes" value={target} onChange={(v) => { if (v) set({ saveTo: v, matchBy: undefined, mapping: undefined, toList: undefined }); }}
            items={[...objects.map((o) => ({ id: o.id, label: `A ${o.one.toLowerCase()}`, description: o.many })), { id: 'none', label: 'Nothing, keep the answers here' }]} />
          {target !== 'none' && <Select label="Find the one to update by" value={by} onChange={(v) => { if (v) set({ matchBy: v }); }} items={matchItems} description="A match is updated; otherwise a new one is added." />}
        </div>
        {needsKey && <Callout tone="warning">No question gives a name or email, so responses can’t be filed. Pick one below.</Callout>}
      </SettingsSection>
      {target !== 'none' && (
        <SettingsSection title="Which field each answer fills" description={`${filled.length} of ${answerable.length} answers are saved on the ${objectWord(state, target, 1)}. The rest stay on the form.`}>
          <ul className="tf-forms__map">{answerable.map((q) => (
            <li key={q.id}><span className="tf-forms__mapq"><strong>{q.title || 'Untitled question'}</strong><span className="tf-rec__muted">{QUESTION_KINDS[q.kind].label}</span></span>
              <span className="tf-forms__arrow" aria-hidden="true">→</span>
              <Select label={`${q.title || 'Question'} fills`} isLabelHidden className="tf-forms__mapsel" value={attrOf(q)}
                onChange={(v) => { if (!v) return; if (v === 'new') { newField(q); return; } set({ mapping: { ...(form.mapping ?? {}), [q.id]: v } }); }}
                items={[{ id: 'none', label: 'Don’t save' }, ...fields, { id: 'new', label: 'New field…', description: `Adds “${q.title || 'this question'}” to ${objectWord(state, target, 2)}` }]} /></li>
          ))}</ul>
          {filled.length > 0 && <p className="tf-rec__muted">Saved: {filled.map((q) => label(attrOf(q))).join(', ')}.</p>}
        </SettingsSection>
      )}
      {target !== 'none' && (
        <SettingsSection title="Also">
          {target === 'people' && <div className="tf-set__switch"><span><strong>Tag them with the form’s name</strong><span className="tf-rec__muted">So you can filter People by “{form.name}”.</span></span><Switch aria-label="Tag with the form's name" isSelected={form.tagWith !== false} onChange={(on) => set({ tagWith: on })} /></div>}
          {target === 'people' && <div className="tf-set__switch"><span><strong>Open a deal for each new person</strong><span className="tf-rec__muted">Named after them and the form, owned by {form.owner.split(' ')[0]}.</span></span><Switch aria-label="Open a deal" isSelected={Boolean(form.alsoDeal)} onChange={(on) => set({ alsoDeal: on ? { stage: 'Lead' } : undefined })} /></div>}
          {target === 'people' && form.alsoDeal && <div className="tf-rec__form tf-set__narrow"><Select label="In stage" value={form.alsoDeal.stage} onChange={(v) => { if (v) set({ alsoDeal: { stage: v } }); }} items={STAGES.filter((x) => x !== 'Won' && x !== 'Lost').map((x) => ({ id: x, label: x }))} /></div>}
          <div className="tf-rec__form tf-set__narrow"><Select label="Add to a list" value={form.toList ?? 'none'} onChange={(v) => set({ toList: v && v !== 'none' ? v : undefined })} items={[{ id: 'none', label: 'No list' }, ...lists.map((l) => ({ id: l.id, label: l.name }))]} description={lists.length === 0 ? `No ${objectWord(state, target, 2).toLowerCase()} lists yet.` : 'Each record goes in its first stage.'} /></div>
        </SettingsSection>
      )}
      <Callout tone="neutral">{summary}</Callout>
      {target !== 'none' && unfiled > 0 && <Callout tone="info" action={{ label: 'File them', onPress: onFileEarlier }}>{unfiled === 1 ? '1 earlier response isn’t filed yet.' : `${unfiled} earlier responses aren’t filed yet.`}</Callout>}
    </div>
  );
}

