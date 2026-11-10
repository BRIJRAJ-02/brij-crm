// Forms: a list of cards, New form from a gallery, and one editor with five tabs: Questions (builder beside the live preview),
// Settings (layout, where answers go, what happens after), Share (link and embeds), Responses (with Add to People, spam, delete + Undo),
// Results (views, finishes, where people stop). Edits are a draft until Publish; the visitor's page is HostedForm itself.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, FileText, MoreHorizontal, Pause, Play, Plus, Trash2, UserPlus, ShieldAlert } from 'lucide-react';
import { FormCard, FormStatusTag, HostedFormPreview } from '../FormPicture/FormPicture.tsx';
import { QuestionBuilder } from '../QuestionList/QuestionList.tsx';
import { HostedForm, SentAnswers } from '../HostedForm/HostedForm.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
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
import { formWho, newId, type AppAction, type AppForm, type AppState, type FormResponse } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const statusOf = (f: AppForm) => (f.status === 'paused' ? 'closed' : f.status === 'live' ? 'live' : 'draft') as 'draft' | 'live' | 'closed';
/** The settings a visitor sees besides the questions. */
const configOf = (f: AppForm) => JSON.stringify({ name: f.name, mode: f.mode, after: f.after });
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
  readonly onBookings: (tab: string) => void;
  /** A visitor who chose "Book a meeting": opens the booking page with their name and email filled in. */
  readonly onBookGuest?: (who: { readonly name: string; readonly email: string }) => void;
  /** Opens on one form, as its editor or as a visitor sees it (from Links). */
  readonly start?: { readonly id: string; readonly visit: boolean };
}

/** The forms list, or one form open. */
export function FormsScreen({ state, dispatch, onOpenPerson, onBookings, onBookGuest, start }: FormsScreenProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | undefined>(start?.id);
  const [gallery, setGallery] = useState(false);
  const [find, setFind] = useState('');
  const form = state.forms.find((f) => f.id === openId);
  if (form) return <FormEditor state={state} form={form} dispatch={dispatch} onBack={() => setOpenId(undefined)} onOpenPerson={onOpenPerson} onBookGuest={onBookGuest} visit={start?.id === form.id && start.visit} />;
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

function FormEditor({ state, form, dispatch, onBack, onOpenPerson, onBookGuest, visit = false }: { readonly visit?: boolean; readonly state: AppState; readonly form: AppForm; readonly dispatch: (a: AppAction) => void; readonly onBack: () => void; readonly onOpenPerson: (id: string) => void; readonly onBookGuest?: (who: { readonly name: string; readonly email: string }) => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('questions');
  const [guest, setGuest] = useState(visit);
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
  const publish = () => {
    if (empty) { setTab('questions'); toast({ message: 'Add a question first. A form needs at least one.', tone: 'danger' }); return; }
    const first = form.status === 'draft'; set({ status: form.status === 'paused' ? 'paused' : 'live', live: form.questions, liveConfig: configOf(form) });
    toast({ message: first ? 'Your form is live. Share the link.' : 'Published. Visitors see the new version.', tone: 'success', action: first ? { label: 'Copy link', onAction: copy } : undefined });
  };
  const questions = form.live ?? form.questions;
  /** Name and email from the mapped questions first, then the usual guess. */
  const who = (r: FormResponse) => {
    const m = form.mapping ?? {}; const by = (attr: string) => Object.entries(m).find(([, a]) => a === attr)?.[0];
    const guess = formWho(questions, r.answers);
    return { name: (by('name') && r.answers[by('name') ?? '']) || guess.name, email: (by('email') && r.answers[by('email') ?? '']) || guess.email };
  };
  /** The other mapped answers, as fields on the person. */
  const mappedFields = (r: FormResponse) => {
    const out: Record<string, string> = {}; const extra: Record<string, string> = {};
    for (const [qid, attr] of Object.entries(form.mapping ?? {})) { const v = r.answers[qid]; if (!v || attr === 'name' || attr === 'email' || attr === 'none') continue; if (attr === 'title' || attr === 'phone') out[attr] = v; else extra[attr] = v; }
    return { out, extra };
  };
  /** Files a response under People: the person with that email if there is one, else a new person. Never a second copy. */
  const file = (r: FormResponse, quiet = false): string | undefined => {
    const w = who(r); if (!w.name && !w.email) { if (!quiet) toast({ message: 'This response has no name or email to file under.', tone: 'danger' }); return undefined; }
    const match = w.email ? state.people.find((p) => p.email.toLowerCase() === w.email.toLowerCase()) : undefined;
    const id = match?.id ?? newId('p');
    const { out, extra } = mappedFields(r);
    if (match) dispatch({ type: 'records/fields', object: 'people', changes: [{ id: match.id, patch: { tags: [...new Set([...match.tags, form.name])], ...out, ...(Object.keys(extra).length ? { extra: { ...(match.extra ?? {}), ...extra } } : {}) } }] });
    else dispatch({ type: 'person/set', person: { id, name: w.name || w.email, email: w.email, title: out.title ?? '', phone: out.phone, owner: form.owner, tags: [form.name], created: new Date(), extra: Object.keys(extra).length ? extra : undefined } });
    dispatch({ type: 'activity/add', activity: { id: newId('a'), record: { object: 'people', id }, kind: 'form', actor: w.name || w.email, text: `sent ${form.name}`, at: r.at } });
    if (!quiet) toast({ message: match ? `Filed under ${match.name}, who was already in People` : `${w.name || w.email} added to People`, tone: 'success', action: { label: 'Open', onAction: () => onOpenPerson(id) } });
    return id;
  };
  const responses = form.responses.filter((r) => (showSpam ? r.spam : !r.spam) && (!respFind.trim() || Object.values(r.answers).some((v) => v.toLowerCase().includes(respFind.trim().toLowerCase()))));
  const resp = form.responses.find((r) => r.id === openResp);
  const setResp = (r: FormResponse) => patchResponses((rs) => rs.map((x) => (x.id === r.id ? r : x)));
  const setRespBack = (r: FormResponse) => patchResponses((rs) => [...rs, r].sort((a, b) => b.at.getTime() - a.at.getTime()));
  const addToPeople = (r: FormResponse) => { const id = file(r); if (id) setResp({ ...r, personId: id }); };
  const finishes = form.responses.filter((r) => !r.spam).length;
  const live = form.status === 'live';
  if (guest && toBooking) return <BookingCountdown name={toBooking.name} onGo={() => { const w = toBooking; setToBooking(undefined); setGuest(false); onBookGuest?.(w); }} onStay={() => setToBooking(undefined)} />;
  if (guest) {
    return (
      <div className="tf-forms__guest">
        <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setGuest(false)}>Back to the form</Button><span className="tf-rec__muted">{url}</span>
          {!live && <Tag size="sm" hue="orange">Preview · answers aren’t saved</Tag>}</div>
        {form.status === 'paused' ? <EmptyState icon={<Pause size={20} strokeWidth={1.75} />} title="This form is closed" description={`${form.owner.split(' ')[0]} isn't taking answers right now.`} /> : (
          <HostedForm title={form.name} description={form.subtitle} logic={form.mode === 'one' ? form.logic : undefined} questions={live ? questions : form.questions} mode={form.mode} thanks={{ title: 'Thanks, we got it.', line: form.after.message }}
            onSubmit={(answers) => new Promise<void>((resolve) => {
              const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join(', ') : '']));
              window.setTimeout(() => {
                const w = formWho(live ? questions : form.questions, flat);
                if (live) {
                  const r: FormResponse = { id: newId('r'), at: new Date(), answers: flat };
                  const personId = form.saveTo === 'people' ? file(r, true) : undefined;
                  patchResponses((rs) => [{ ...r, personId }, ...rs]);
                }
                if (form.after.kind === 'booking' && onBookGuest) setToBooking(w);
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
            else if (k === 'delete') { const before = form; const at = state.forms.findIndex((f) => f.id === form.id); dispatch({ type: 'form/remove', id: form.id }); onBack(); toast({ message: `${form.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'form/insert', form: before, at }) } }); }
          }}>
            {form.status !== 'draft' && <MenuItem id="pause" icon={form.status === 'paused' ? <Play {...i16} /> : <Pause {...i16} />}>{form.status === 'paused' ? 'Resume' : 'Pause answers'}</MenuItem>}
            {edited(form) && <MenuItem id="discard">Discard changes</MenuItem>}
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete form</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <Tabs aria-label="Form" selectedKey={tab} onSelectionChange={setTab}
        items={[{ id: 'questions', label: 'Questions', count: form.questions.length }, { id: 'settings', label: 'Settings' }, { id: 'share', label: 'Share' }, { id: 'responses', label: 'Responses', count: finishes }, { id: 'results', label: 'Results' }]}>
        <TabPanel id="questions" className="tf-forms__panel">
          <div className="tf-forms__build">
            <div className="tf-forms__builder"><QuestionBuilder questions={form.questions} onChange={(questions) => { if (questions.length > MAX_QUESTIONS) { toast({ message: `A form holds up to ${MAX_QUESTIONS} questions. Split it into two forms.`, tone: 'danger' }); return; } set({ questions }); }} />
              <p className="tf-rec__muted tf-num">{form.questions.length} of {MAX_QUESTIONS} questions</p></div>
            <div className="tf-forms__preview"><HostedFormPreview title={form.name} description={form.subtitle} questions={form.questions} mode={form.mode} address={url} onSubmit={() => Promise.resolve()} /></div>
          </div>
        </TabPanel>
        <TabPanel id="settings" className="tf-forms__panel">
          <div className="tf-forms__settings">
            <div className="tf-bkf__group"><span className="tf-bkf__label">Layout</span>
              <SegmentedControl aria-label="Layout" selectedKey={form.mode} onSelectionChange={(k) => set({ mode: k === 'page' ? 'page' : 'one' })} items={[{ id: 'one', label: 'One question at a time' }, { id: 'page', label: 'Classic: all on one page' }]} /></div>
            <TextArea label="Subtitle" aside="Optional" rows={2} value={form.subtitle ?? ''} onChange={(subtitle) => set({ subtitle: subtitle || undefined })} description="A line under the title, like what it’s for or how long it takes." />
            <TextField label="Link" value={form.slug} onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} onBlur={() => { const clean = form.slug.replace(/-+/g, '-').replace(/^-|-$/g, ''); if (clean !== form.slug || !clean) set({ slug: clean || `form-${form.id.slice(-4)}` }); }}
              isInvalid={state.forms.some((f) => f.id !== form.id && f.slug === form.slug)} errorMessage={state.forms.some((f) => f.id !== form.id && f.slug === form.slug) ? 'Another form uses this link' : undefined} description="Old links keep working when you change it." />
            <Select label="Save answers to" value={form.saveTo} onChange={(v) => set({ saveTo: v === 'none' ? 'none' : 'people' })}
              items={[{ id: 'people', label: 'People', description: 'Matched by email; new people are added' }, { id: 'none', label: 'Keep answers only' }]} />
            {form.saveTo === 'people' && <MappingEditor form={form} state={state} onChange={(mapping) => set({ mapping })} />}
            {form.mode === 'one' && <LogicEditor form={form} onChange={(logic) => set({ logic })} />}
            <Select label="Owner" value={form.owner} onChange={(v) => set({ owner: v ?? form.owner })} items={state.members.map((m) => ({ id: m.name, label: m.name }))} />
            <div className="tf-bkf__group"><span className="tf-bkf__label">After they send</span>
              <SegmentedControl aria-label="After they send" selectedKey={form.after.kind} onSelectionChange={(k) => set({ after: { ...form.after, kind: k === 'booking' ? 'booking' : 'thanks' } })} items={[{ id: 'thanks', label: 'Say thanks' }, { id: 'booking', label: 'Book a meeting' }]} />
              <TextArea label="Message" rows={2} value={form.after.message} onChange={(message) => set({ after: { ...form.after, message } })} />
              {form.after.kind === 'booking' && <p className="tf-rec__muted">They go straight to your booking page with their name and email filled in, so they only pick a time.</p>}
            </div>
          </div>
        </TabPanel>
        <TabPanel id="share" className="tf-forms__panel">
          {form.status === 'draft' ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="Publish to share" description="The link and embeds work once the form is live." action={<Button size="sm" variant="primary" onPress={publish}>Publish</Button>} /> : (
            <div className="tf-forms__settings">
              <div className="tf-forms__link"><span className="tf-num">{url}</span><Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={copy}>Copy</Button></div>
              <span className="tf-bkf__label">On your website</span>
              <ul className="tf-forms__embeds">
                {[{ id: 'inline', t: 'In the page', d: 'The form sits in your page like a section.' }, { id: 'popup', t: 'As a popup', d: 'A button opens it over your page.' }, { id: 'floating', t: 'Floating button', d: 'A small button in the corner, on every page.' }].map((e) => (
                  <li key={e.id}><strong>{e.t}</strong><span className="tf-rec__muted">{e.d}</span>
                    <Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => { void copyText(`<script src="https://timefix.com/embed.js" data-form="${form.slug}" data-mode="${e.id}"></script>`).then((ok) => toast(ok ? { message: 'Code copied', tone: 'success' } : { message: 'Copy didn’t work. Try again, or ask us for the code.', tone: 'danger' })); }}>Copy code</Button></li>
                ))}
              </ul>
              <TextField label="Prefilled link" description="For developers: fills answers from the link, like ?email=" value={`https://${url}?email={email}`} isReadOnly />
            </div>
          )}
        </TabPanel>
        <TabPanel id="responses" className="tf-forms__panel">
          <div className="tf-rec__bar"><SegmentedControl aria-label="Which" size="sm" selectedKey={showSpam ? 'spam' : 'in'} onSelectionChange={(k) => { setShowSpam(k === 'spam'); setOpenResp(undefined); }}
            items={[{ id: 'in', label: `Responses · ${finishes}` }, { id: 'spam', label: `Spam · ${form.responses.length - finishes}` }]} />
            <span className="tf-rec__spacer" />{form.responses.length > 3 && <SearchField label="Search answers" placeholder="Search answers" size="sm" value={respFind} onChange={setRespFind} />}</div>
          {(() => { const unfiled = form.responses.filter((r) => !r.spam && !r.personId); return form.saveTo === 'people' && !showSpam && unfiled.length > 0 ? (
            <Callout tone="info" action={{ label: `File ${unfiled.length}`, onPress: () => { const ids = unfiled.map((r) => ({ id: r.id, personId: file(r, true) })); patchResponses((rs) => rs.map((x) => { const f = ids.find((y) => y.id === x.id); return f?.personId ? { ...x, personId: f.personId } : x; })); toast({ message: `${ids.filter((x) => x.personId).length} earlier ${ids.length === 1 ? 'answer' : 'answers'} filed in People`, tone: 'success' }); } }}>
              {unfiled.length === 1 ? '1 earlier answer isn’t in People yet.' : `${unfiled.length} earlier answers aren’t in People yet.`}</Callout>) : null; })()}
          {responses.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={showSpam ? 'No spam' : 'No responses yet'} description={showSpam ? 'Bot answers are kept here, out of your way.' : 'Share the link; answers show up here as they arrive.'} /> : (
            <div className="tf-forms__resp">
              <ul className="tf-forms__rows">
                {responses.map((r) => (
                  <li key={r.id}><button type="button" className="tf-forms__row" aria-current={openResp === r.id || undefined} onClick={() => setOpenResp(r.id)}>
                    <strong>{who(r).name || who(r).email || 'No name given'}</strong><span className="tf-rec__muted">{who(r).name ? who(r).email : Object.values(r.answers)[0]}</span>
                    <span className="tf-rec__muted tf-num">{ago(r.at)}</span>{r.personId && <Tag size="sm" hue="green">In People</Tag>}
                  </button></li>
                ))}
              </ul>
              <div className="tf-forms__answer">
                {!resp ? <p className="tf-rec__muted">Pick a response to read it.</p> : (
                  <>
                    <SentAnswers questions={form.live ?? form.questions} answers={resp.answers} />
                    <div className="tf-rec__bar">
                      {resp.personId ? <Button size="sm" variant="secondary" onPress={() => resp.personId && onOpenPerson(resp.personId)}>Open person</Button>
                        : form.saveTo === 'people' && !resp.spam && <Button size="sm" variant="secondary" icon={<UserPlus {...i14} />} onPress={() => addToPeople(resp)}>Add to People</Button>}
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
            <StatCard label="Of views" value={form.views ? Math.round((finishes / form.views) * 100) : 0} format={(n) => `${n}%`} />
            <StatCard label="Filed in People" value={form.responses.filter((r) => r.personId && !r.spam).length} />
          </div>
          {finishes === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No answers to sum up yet" description="Once people answer, each choice question shows how they answered." /> : (
            <section className="tf-recp__sec"><h3>How people answered</h3>
              <ul className="tf-forms__drop">
                {questions.filter((q) => q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating').flatMap((q) => {
                  const got = form.responses.filter((r) => !r.spam).map((r) => r.answers[q.id]).filter((v): v is string => Boolean(v));
                  const counts = [...got.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]);
                  return counts.map(([v, n]) => { const pct = Math.round((n / Math.max(1, got.length)) * 100); return (
                    <li key={`${q.id}-${v}`}><span>{q.title}: <strong>{v}</strong></span><span className="tf-forms__bar" aria-hidden><span data-w={Math.round(pct / 10) * 10} /></span><span className="tf-num tf-rec__muted">{n} · {pct}%</span></li>
                  ); });
                })}
              </ul>
              {questions.every((q) => !['choice', 'dropdown', 'rating'].includes(q.kind)) && <p className="tf-rec__muted">This form has no choice questions to sum up. Read each answer in Responses.</p>}
            </section>
          )}
        </TabPanel>
      </Tabs>
      {discarding && <Dialog isOpen onOpenChange={(o) => { if (!o) setDiscarding(false); }} title="Discard your changes?" description="The form goes back to what visitors see now. You can undo this."
        actions={<><Button variant="ghost" slot="close">Keep editing</Button><Button variant="danger" onPress={() => { setDiscarding(false); const was = { questions: form.questions, name: form.name, mode: form.mode, after: form.after, subtitle: form.subtitle, mapping: form.mapping, logic: form.logic }; const cfg = form.liveConfig ? (JSON.parse(form.liveConfig) as Pick<AppForm, 'name' | 'mode' | 'after'>) : {}; set({ questions: form.live ?? form.questions, ...cfg }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => set(was) } }); }}>Discard changes</Button></>} />}
    </div>
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

/** Which People attribute each question fills. Name and email are guessed; the rest are picked here. */
function MappingEditor({ form, state, onChange }: { readonly form: AppForm; readonly state: AppState; readonly onChange: (m: Readonly<Record<string, string>>) => void }) {
  const people = state.objects.find((o) => o.id === 'people');
  const attrs = [{ id: 'none', label: 'Nothing (answer only)' }, { id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'title', label: 'Job title' },
    ...(people?.attributes ?? []).filter((a) => !['name', 'email', 'phone', 'title', 'company', 'tags', 'owner', 'created'].includes(a.id)).map((a) => ({ id: a.id, label: a.name }))];
  const guess = (q: FormQuestion) => (q.kind === 'email' ? 'email' : q.kind === 'phone' ? 'phone' : q.kind === 'short' && /name/i.test(q.title) ? 'name' : q.kind === 'short' && /title|role/i.test(q.title) ? 'title' : 'none');
  const m = form.mapping ?? {};
  return (
    <div className="tf-bkf__group"><span className="tf-bkf__label">Each answer fills</span>
      <ul className="tf-set__list">{form.questions.map((q) => (
        <li key={q.id}><span>{q.title}</span><Select label={`${q.title} fills`} isLabelHidden className="tf-you__select" value={m[q.id] ?? guess(q)} onChange={(v) => { if (v) onChange({ ...m, [q.id]: v }); }} items={attrs} /></li>
      ))}</ul>
    </div>
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
          <span className="tf-rec__muted tf-forms__rule-say">If “{title(r.when)}” is {r.is}, they go to {title(r.goto)}.</span>
        </li>); })}</ul>
      <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={add}>Add a rule</Button>
    </div>
  );
}
