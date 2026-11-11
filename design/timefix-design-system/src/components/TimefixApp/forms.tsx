// Forms: a list of cards (each with ⋯ Open, Copy link, Pause, Duplicate, Delete, and "new" since you last looked), New form from a gallery,
// and one editor with six tabs: Questions (builder, After they send, and the live preview edited in place), Settings (layout, language,
// owner or round robin, emails, keeping, spam), Records, Share (link, QR, embeds, For developers), Responses (the submissions table) and
// Results (analytics). Edits are a draft until Publish; the visitor's page is HostedForm itself.
import { useGuestScale } from '../../lib/guest-scale.ts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PublishBar } from '../FloatingBar/FloatingBar.tsx';
import { ArrowLeft, Palette, Copy, ExternalLink, Eye, FileText, Mail, MessageCircle, MoreHorizontal, Pause, Play, Plus, QrCode as QrIcon, Share2, Trash2 } from 'lucide-react';
import { saveFile } from '../../lib/saveFile.ts';
import { QrSheet } from './grow.tsx';
import { FormCard, FormStatusTag, HostedFormPreview } from '../FormPicture/FormPicture.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { QuestionBuilder } from '../QuestionList/QuestionList.tsx';
import { FORM_LANGS, HostedForm, type FormLang } from '../HostedForm/HostedForm.tsx';
import { QUESTION_KINDS, type FormQuestion } from '../HostedForm/answers.ts';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { STAGES, formWho, newId, type AppAction, type AppForm, type AppState, type FormResponse, type ObjectId, LISTS_ON } from './data.ts';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { DialogTrigger } from 'react-aria-components';
import { Popover } from '../Popover/Popover.tsx';
import { GUEST_LOOKS, GuestLook, type GuestLookValue } from '../GuestLook/GuestLook.tsx';
import { AfterSendSection, AnalyticsPanel, DevelopersSection, EmbedSection, FullPreview, SubmissionsPanel, SyncDialog, routable, type SyncPreview } from './formparts.tsx';
import { ShareSheet } from '../ShareSheet/ShareSheet.tsx';

/** Calm, what a form wears until its owner picks a look. */
const CALM_LOOK: GuestLookValue = { look: 'calm', ...(GUEST_LOOKS[0]?.value ?? { accent: '#1F5FD6', font: 'sans', scheme: 'light' }) };
/** The workspace brand's colours as hex, for a form that wears the brand. */
const BRAND_HEX: Readonly<Record<string, string>> = { teal: '#0F766E', blue: '#1F5FD6', ink: '#111111', violet: '#7C3AED' };
/** "Look · Night" on the preview's button. */
const lookName = (v?: GuestLookValue, brand = false) => (brand ? 'Look · Your brand' : `Look · ${v?.look === 'custom' ? 'Custom' : GUEST_LOOKS.find((l) => l.id === (v?.look ?? 'calm'))?.title ?? 'Calm'}`);

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const statusOf = (f: AppForm) => (f.status === 'paused' ? 'closed' : f.status === 'live' ? 'live' : 'draft') as 'draft' | 'live' | 'closed';
/** Closed by date or by count: visitors see the closed message. */
const closedNow = (f: AppForm) => Boolean((f.closesOn && new Date(`${f.closesOn}T23:59`) < new Date()) || (f.maxResponses && f.responses.filter((r) => !r.spam).length >= f.maxResponses));
/** A question's key in links: its title in lower case with underscores ("work_email"). */
const keyOf = (q: FormQuestion) => (q.title || q.kind).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || q.id;
/** The settings visitors see besides the questions; a change to any counts as an unpublished edit. */
const CONFIG_KEYS = ['name', 'headline', 'mode', 'after', 'subtitle', 'logic', 'mapping', 'look', 'endings', 'routes', 'lang', 'corners', 'useBrand', 'scoreTo', 'saveProgress'] as const;
type LiveConfig = Pick<AppForm, typeof CONFIG_KEYS[number]>;
const configOf = (f: AppForm) => JSON.stringify(Object.fromEntries(CONFIG_KEYS.map((k) => [k, f[k]])));
/** What visitors see now: the published questions and settings, or the draft before the first publish. */
const liveView = (f: AppForm): LiveConfig & Pick<AppForm, 'questions'> => {
  if (!f.liveConfig) return { ...(Object.fromEntries(CONFIG_KEYS.map((k) => [k, f[k]])) as unknown as LiveConfig), questions: f.live ?? f.questions };
  const cfg = JSON.parse(f.liveConfig) as Partial<LiveConfig>;
  return { ...(cfg as LiveConfig), name: cfg.name ?? f.name, mode: cfg.mode ?? f.mode, after: cfg.after ?? f.after, mapping: cfg.mapping ?? f.mapping, questions: f.live ?? f.questions };
};
/** The People attribute a question fills when nobody picked one: email, phone, name and job title are guessed from the question. */
export const guessAttr = (q: FormQuestion) => (q.kind === 'email' ? 'email' : q.kind === 'phone' ? 'phone' : q.kind === 'short' && /name/i.test(q.title) ? 'name' : q.kind === 'short' && /title|role/i.test(q.title) ? 'title' : 'none');
const edited = (f: AppForm) => f.status !== 'draft' && (JSON.stringify(f.questions) !== JSON.stringify(f.live) || (f.liveConfig !== undefined && f.liveConfig !== configOf(f)));
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
/** Links in an answer: two or more read as spam on Normal, one on Strict, three on Relaxed. */
const linksIn = (answers: Readonly<Record<string, string>>) => Object.values(answers).reduce((n, v) => n + (v.match(/https?:\/\/|www\./gi)?.length ?? 0), 0);

/** A form holds up to this many questions; past that it's two forms. */
const MAX_QUESTIONS = 50;

const TEMPLATES: ReadonlyArray<{ readonly id: string; readonly name: string; readonly line: string; readonly mode?: AppForm['mode']; readonly questions: ReadonlyArray<FormQuestion> }> = [
  { id: 'blank', name: 'Blank', line: 'Start from nothing', questions: [] },
  { id: 'contact', name: 'Contact us', line: 'Name, email and a message', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'long', title: 'How can we help?' }] },
  { id: 'demo', name: 'Demo request', line: 'Qualify them, then book the demo', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'short', title: 'Company', required: true }, { id: 'd', kind: 'choice', title: 'How big is your team?', options: ['1–10', '11–50', '51–200', '200+'], points: { '1–10': 0, '11–50': 5, '51–200': 10, '200+': 15 } }, { id: 'e', kind: 'choice', title: 'How did you hear about us?', options: ['Google', 'A friend or colleague', 'LinkedIn', 'An event'], insights: true }] },
  { id: 'intake', name: 'Booking intake', line: 'What to know before the meeting', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'phone', title: 'Best number to reach you' }, { id: 'd', kind: 'long', title: 'What would you like to cover?', required: true }, { id: 'e', kind: 'file', title: 'Anything to look at first?' }] },
  { id: 'onboarding', name: 'Customer onboarding', line: 'Three short steps for a new customer', mode: 'steps', questions: [{ id: 'a', kind: 'short', title: 'Company name', required: true, step: { title: 'About you' } }, { id: 'b', kind: 'url', title: 'Website' }, { id: 'c', kind: 'short', title: 'Main contact', required: true, step: { title: 'Who we work with' } }, { id: 'd', kind: 'email', title: 'Their email', required: true }, { id: 'e', kind: 'date', title: 'When would you like to start?', earliest: 'today', step: { title: 'Getting started' } }, { id: 'f', kind: 'multi', title: 'What should we set up first?', options: ['Booking pages', 'Forms', 'Team calendars', 'Reports'], fewest: 1 }, { id: 'g', kind: 'consent', title: 'Before you send', required: true, consentKind: 'terms' }] },
  { id: 'lead', name: 'Lead capture', line: 'Qualify, then book a call', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'choice', title: 'Team size', options: ['1–10', '11–50', '51+'] }] },
  { id: 'event', name: 'Event signup', line: 'Who’s coming, and any needs', questions: [{ id: 'a', kind: 'short', title: 'Name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'dropdown', title: 'Which session?', options: ['Morning', 'Afternoon'] }] },
  { id: 'feedback', name: 'Feedback', line: 'A rating and a few words', questions: [{ id: 'a', kind: 'rating', title: 'How did we do?', required: true }, { id: 'b', kind: 'long', title: 'Anything to add?' }] },
  { id: 'job', name: 'Job application', line: 'CV, links and a cover note', questions: [{ id: 'a', kind: 'short', title: 'Full name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'file', title: 'Your CV', required: true }] },
  { id: 'quote', name: 'Quote request', line: 'What they need, by when, for how much', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'long', title: 'What do you need?', required: true }, { id: 'd', kind: 'dropdown', title: 'Budget', options: ['Under ₹1 lakh', '₹1–5 lakh', '₹5 lakh+'] }, { id: 'e', kind: 'date', title: 'Needed by', earliest: 'today' }] },
  { id: 'newsletter', name: 'Newsletter signup', line: 'Just an email, and what they like', questions: [{ id: 'a', kind: 'email', title: 'Email', required: true }, { id: 'b', kind: 'multi', title: 'What would you like to hear about?', options: ['Product news', 'Guides', 'Events'] }] },
  { id: 'nps', name: 'Customer satisfaction', line: 'How likely they are to recommend you', questions: [{ id: 'a', kind: 'scale', title: 'How likely are you to recommend us?', min: 0, max: 10, required: true }, { id: 'b', kind: 'long', title: 'What’s the main reason?' }, { id: 'c', kind: 'email', title: 'Email, if we can follow up' }] },
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
  /** The workspace showing: forms copied into another workspace stay there. */
  readonly workspace?: string;
  /** "Copy to another workspace…" on a form's ⋯ menus. */
  readonly onCopy?: (formId: string) => void;
}

/** A form copied as a draft, without its submissions, at a free address. */
const duplicateOf = (state: AppState, form: AppForm): AppForm => {
  const base = form.slug.replace(/-copy(-\d+)?$/, ''); let slug = `${base}-copy`; let n = 2;
  while (state.forms.some((f) => f.slug === slug)) { slug = `${base}-copy-${n}`; n += 1; }
  return { ...form, id: newId('f'), name: `${form.name} (copy)`, slug, status: 'draft', live: undefined, liveConfig: undefined, responses: [], views: 0, seen: 0, updated: new Date() };
};

/** The forms list, or one form open. */
export function FormsScreen({ state, dispatch, onOpenPerson, onOpenRecord, onBookings, onBookGuest, start, workspace = 'northwind', onCopy }: FormsScreenProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | undefined>(start?.id);
  const [openTab, setOpenTab] = useState<string>();
  const [gallery, setGallery] = useState(false);
  const [find, setFind] = useState('');
  const [pausing, setPausing] = useState<AppForm>();
  const [deleting, setDeleting] = useState<AppForm>();
  const [qr, setQr] = useState<AppForm>();
  const grid = useRef<HTMLUListElement>(null);
  const form = state.forms.find((f) => f.id === openId);
  if (form) return <FormEditor state={state} form={form} dispatch={dispatch} onBack={() => { setOpenId(undefined); setOpenTab(undefined); }} onOpenPerson={onOpenPerson} onOpenRecord={onOpenRecord} onOpenForm={(id) => setOpenId(id)} onBookGuest={onBookGuest} visit={start?.id === form.id && start.visit} startTab={openTab} onBookings={onBookings} onCopy={onCopy ? () => onCopy(form.id) : undefined} />;
  const live = (f: AppForm) => f.responses.filter((r) => !r.spam).length;
  const copy = (f: AppForm) => { const url = `timefix.com/f/${f.slug}`; void copyText(`https://${url}`).then((ok) => toast(ok ? { message: `${f.name} link copied`, tone: 'success' } : { message: `Copy didn’t work. The link is ${url}`, tone: 'danger' })); };
  /** Arrow keys move between the cards: left and right along a row, up and down by a row. */
  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key) || !(e.target as HTMLElement).classList.contains('tf-fcard__name')) return;
    const names = [...(grid.current?.querySelectorAll<HTMLElement>('.tf-fcard__name') ?? [])];
    const at = names.indexOf(e.target as HTMLElement);
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1;
    const to = at + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols);
    const el = names[to];
    if (el) { e.preventDefault(); el.focus(); }
  };
  const here = state.forms.filter((f) => !f.workspace || f.workspace === workspace);
  const shown = here.filter((f) => !find.trim() || f.name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="tf-forms">
      <div className="tf-rec__bar"><span className="tf-rec__muted">{here.length} {here.length === 1 ? 'form' : 'forms'} · {here.reduce((n, f) => n + live(f), 0)} responses</span><span className="tf-rec__spacer" />
        {state.forms.length > 3 && <SearchField label="Search forms" placeholder="Search forms" size="sm" value={find} onChange={setFind} />}
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setGallery(true)}>New form</Button></div>
      {state.forms.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No forms yet" description="Collect leads, signups and feedback; answers file into People." action={<Button size="sm" variant="primary" onPress={() => setGallery(true)}>New form</Button>} /> : (
        <ul className="tf-forms__grid" ref={grid} onKeyDown={move} aria-label="Forms">
          {shown.map((f) => { const fresh = Math.max(0, live(f) - (f.seen ?? live(f))); return (
            <li key={f.id}><FormCard name={f.name} status={statusOf(f)} responses={live(f)} updated={edited(f) ? `Live · edited ${ago(f.updated)}, not published` : `Edited ${ago(f.updated)}`} questions={f.questions} onPress={() => setOpenId(f.id)}
              badge={fresh > 0 ? <Tag size="sm" hue="blue">{fresh} new</Tag> : undefined}
              menu={<MenuTrigger>
                <IconButton size="sm" label={`More for ${f.name}`}><MoreHorizontal {...i16} /></IconButton>
                <Menu aria-label={`Actions for ${f.name}`} placement="bottom end" onAction={(k) => {
                  if (k === 'open') setOpenId(f.id);
                  else if (k === 'submissions') { setOpenTab('responses'); setOpenId(f.id); }
                  else if (k === 'copy') copy(f);
                  else if (k === 'qr') setQr(f);
                  else if (k === 'pause') setPausing(f);
                  else if (k === 'resume') { dispatch({ type: 'form/patch', id: f.id, patch: () => ({ status: 'live' }) }); toast({ message: `${f.name} is taking submissions again`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'form/patch', id: f.id, patch: () => ({ status: 'paused' }) }) } }); }
                  else if (k === 'duplicate') { const d = duplicateOf(state, f); dispatch({ type: 'form/set', form: d }); toast({ message: `Made “${d.name}”.`, tone: 'success', action: { label: 'Open', onAction: () => setOpenId(d.id) } }); }
                  else if (k === 'delete') setDeleting(f);
                  else if (k === 'copyws') onCopy?.(f.id);
                }}>
                  <MenuItem id="open" icon={<ExternalLink {...i16} />}>Open</MenuItem>
                  <MenuItem id="submissions" icon={<FileText {...i16} />}>{fresh ? `Submissions · ${fresh} new` : 'Submissions'}</MenuItem>
                  <MenuItem id="copy" icon={<Copy {...i16} />} isDisabled={f.status === 'draft'}>Copy link</MenuItem>
                  <MenuItem id="qr" icon={<QrIcon {...i16} />} isDisabled={f.status === 'draft'}>QR code</MenuItem>
                  {f.status === 'live' && <MenuItem id="pause" icon={<Pause {...i16} />}>Pause</MenuItem>}
                  {f.status === 'paused' && <MenuItem id="resume" icon={<Play {...i16} />}>Resume</MenuItem>}
                  <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate</MenuItem>
                  {onCopy && <MenuItem id="copyws" icon={<Copy {...i16} />}>Copy to another workspace…</MenuItem>}
                  <MenuSeparator />
                  <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem>
                </Menu>
              </MenuTrigger>} /></li>); })}
        </ul>
      )}
      {pausing && <Dialog isOpen onOpenChange={(o) => { if (!o) setPausing(undefined); }} title={`Pause “${pausing.name}”?`} description="It stops taking submissions until you resume it. Its link says it’s closed."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { const f = pausing; dispatch({ type: 'form/patch', id: f.id, patch: () => ({ status: 'paused' }) }); setPausing(undefined); toast({ message: `${f.name} is paused`, action: { label: 'Undo', onAction: () => dispatch({ type: 'form/patch', id: f.id, patch: () => ({ status: 'live' }) }) } }); }}>Pause form</Button></>} />}
      {deleting && <Dialog isOpen onOpenChange={(o) => { if (!o) setDeleting(undefined); }} title={`Delete “${deleting.name}”?`}
        description={deleting.responses.length === 0 ? 'The form and its link are gone for good.' : `Its ${deleting.responses.length} ${deleting.responses.length === 1 ? 'submission is' : 'submissions are'} gone for good; records stay.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { const f = deleting; dispatch({ type: 'form/remove', id: f.id }); setDeleting(undefined); toast({ message: `Deleted “${f.name}”.` }); }}>Delete form</Button></>} />}
      {qr && <QrSheet url={`timefix.com/f/${qr.slug}`} name={qr.name} onClose={() => setQr(undefined)} />}
      {gallery && (
        <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setGallery(false); }} title="New form" description="Start blank or from a template; change anything after.">
          <ul className="tf-forms__gallery">
            {TEMPLATES.map((t) => (
              <li key={t.id}><button type="button" className="tf-forms__tpl" onClick={() => {
                const f: AppForm = { id: newId('f'), name: t.id === 'blank' ? 'Untitled form' : t.name, slug: `${t.id}-${Date.now().toString(36).slice(-4)}`, status: 'draft', questions: t.questions.map((q) => ({ ...q, id: newId('q') })), mode: t.mode ?? 'one',
                  saveTo: t.id === 'feedback' || t.id === 'nps' ? 'none' : 'people', owner: state.me, after: { kind: t.id === 'demo' ? 'booking' : 'thanks', message: 'Thanks, we got it.' }, responses: [], views: 0, seen: 0, updated: new Date() };
                // Jumps and Show only if in a template point at its own question ids; keep them pointing after the ids change.
                const ids = new Map(t.questions.map((q, n) => [q.id, f.questions[n]?.id ?? q.id]));
                const fixed = { ...f, questions: f.questions.map((q) => ({ ...q, showIf: q.showIf ? { ...q.showIf, questionId: ids.get(q.showIf.questionId) ?? q.showIf.questionId } : undefined, jumps: q.jumps?.map((j) => ({ ...j, to: ids.get(j.to) ?? j.to })) })) };
                dispatch({ type: 'form/set', form: fixed }); setGallery(false); setOpenId(fixed.id); toast({ message: `${fixed.name} made. Publish when it’s ready.` });
              }}><strong>{t.name}</strong><span className="tf-rec__muted">{t.line}</span><span className="tf-rec__muted tf-num">{t.questions.length ? `${t.questions.length} questions${t.mode === 'steps' ? ' in steps' : ''}` : 'No questions'}</span></button></li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function FormEditor({ state, form, dispatch, onBack, onOpenPerson, onOpenRecord, onOpenForm, onBookGuest, visit = false, startTab, onBookings, onCopy }: { readonly onCopy?: () => void; readonly onOpenForm?: (id: string) => void; readonly onOpenRecord?: (object: string, id: string) => void; readonly visit?: boolean; readonly state: AppState; readonly form: AppForm; readonly dispatch: (a: AppAction) => void; readonly onBack: () => void; readonly onOpenPerson: (id: string) => void; readonly onBookGuest?: (who: { readonly name: string; readonly email: string }) => void; readonly startTab?: string; readonly onBookings: (tab: string) => void }) {
  void onOpenPerson; void onBookings;
  const { toast } = useToast();
  const [tab, setTabRaw] = useState(startTab ?? 'questions');
  const [guest, setGuest] = useState(visit);
  /** Opening the form from a prefilled link: answers by question id. */
  const [prefill, setPrefill] = useState<Readonly<Record<string, string>>>();
  const [qr, setQr] = useState(false);
  const [toBooking, setToBooking] = useState<{ readonly name: string; readonly email: string }>();
  const [discarding, setDiscarding] = useState(false);
  /** The share dialog: after a first publish ("… is live") or from Share. */
  const [liveOpen, setLiveOpen] = useState<'live' | 'share'>();
  const [syncOpen, setSyncOpen] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  const [subFilter, setSubFilter] = useState('all');
  const [keepAsk, setKeepAsk] = useState<string>();
  const visitId = useRef<string | undefined>(undefined);
  /** Opening Responses counts as looking: the list's "new" mark clears. */
  const setTab = (k: string) => { setTabRaw(k); if (k === 'responses') dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ seen: f.responses.filter((r) => !r.spam).length }) }); };
  useEffect(() => { if (startTab === 'responses') setTab('responses'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Changes to this form apply to its latest version, so an Undo later never brings back older edits. */
  const set = (patch: Partial<AppForm>) => dispatch({ type: 'form/patch', id: form.id, patch: () => ({ ...patch, updated: new Date() }) });
  const patchResponses = (fn: (rs: ReadonlyArray<FormResponse>) => ReadonlyArray<FormResponse>) => dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ responses: fn(f.responses) }) });
  const url = `timefix.com/f/${form.slug}`;
  const copy = () => { void copyText(`https://${url}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. The link is ${url}`, tone: 'danger' })); };
  const empty = form.questions.length === 0;
  const slugTaken = state.forms.some((f) => f.id !== form.id && f.slug === form.slug);
  const shownToVisitors = liveView(form);
  const questions = shownToVisitors.questions;
  const target = form.saveTo;
  const targetName = (n: number) => objectWord(state, target, n);
  /** Each question's field on the target: the one picked (on the question or in Records), else the guess. "none" keeps the answer on the form only. */
  const attrOf = (q: FormQuestion) => (shownToVisitors.mapping ?? {})[q.id] ?? guessFor(target, q);
  const draftAttrOf = (q: FormQuestion) => (form.mapping ?? {})[q.id] ?? guessFor(target, q);
  /** Earlier submissions not filed under the way the form saves now. */
  const filedAs = (r: FormResponse) => r.record ?? (r.personId ? { object: 'people', id: r.personId } : undefined);
  const unfiledRs = form.responses.filter((r) => !r.spam && !r.state && !filedAs(r));
  const publish = () => {
    if (empty) { setTab('questions'); toast({ message: 'Add a question first. A form needs at least one.', tone: 'danger' }); return; }
    if (slugTaken) { setTab('settings'); toast({ message: 'Another form uses this link. Change it in Settings first.', tone: 'danger' }); return; }
    const first = form.status === 'draft';
    const was = form.liveConfig ? (JSON.parse(form.liveConfig) as Partial<AppForm>) : undefined;
    const filingChanged = was !== undefined && JSON.stringify(was.mapping ?? {}) !== JSON.stringify(form.mapping ?? {});
    set({ status: form.status === 'paused' ? 'paused' : 'live', live: form.questions, liveConfig: configOf(form) });
    if (first) { setLiveOpen('live'); return; }
    toast({ message: form.status === 'paused' ? 'Published. Visitors see it when you resume answers.' : 'Published. Visitors see the new version.', tone: 'success' });
    if (filingChanged && form.saveTo !== 'none' && form.responses.some((r) => !r.spam)) setSyncOpen(true);
  };
  // A live form made before settings were versioned (the seed) gets its current settings as the published ones, so later edits wait for Publish.
  useEffect(() => { if (form.status !== 'draft' && form.liveConfig === undefined) dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ liveConfig: configOf(f), live: f.live ?? f.questions }) }); }, [form.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Visitors to a live form get what was published after sending (thanks, button, booking or website), not the draft.
  const after = form.status === 'live' ? shownToVisitors.after : form.after;
  /** Name and email from the questions that fill them. */
  const who = (r: FormResponse) => {
    const byAttr = (attr: string) => questions.find((q) => attrOf(q) === attr);
    const n = byAttr('name'); const e = byAttr('email') ?? questions.find((q) => q.kind === 'email');
    return { name: (n && r.answers[n.id]?.trim()) || '', email: (e && r.answers[e.id]?.trim()) || '' };
  };
  /** Files submissions as their target records, quietly: the one each matches is updated, else a new one is added. Never a second copy. */
  const fileMany = (rs: ReadonlyArray<FormResponse>): number => {
    const madeNow = new Map<string, string>();
    const done = rs.map((r) => ({ r, out: fileResponse(state, form, questions, attrOf, { ...r, state: undefined }, dispatch, madeNow) }));
    patchResponses((xs) => xs.map((x) => { const d = done.find((y) => y.r.id === x.id); return d?.out ? { ...x, state: undefined, why: undefined, record: { object: d.out.object, id: d.out.id }, personId: d.out.object === 'people' ? d.out.id : x.personId, kept: d.out.kept.length ? d.out.kept : undefined } : x; }));
    return done.filter((d) => d.out).length;
  };
  const syncPreview = (all: boolean): SyncPreview => {
    const pool = form.responses.filter((r) => !r.spam && !r.state && (all || !filedAs(r)));
    return pool.reduce<SyncPreview>((c, r) => {
      if (filedAs(r) && !all) return { ...c, unchanged: c.unchanged + 1 };
      const w = who(r); const key = (w.email || w.name).toLowerCase();
      if (!key) return { ...c, failures: c.failures + 1 };
      const exists = target === 'people' ? state.people.some((p) => p.email.toLowerCase() === w.email.toLowerCase() && w.email) : false;
      return filedAs(r) ? { ...c, unchanged: c.unchanged + 1 } : exists ? { ...c, updates: c.updates + 1 } : { ...c, creates: c.creates + 1 };
    }, { creates: 0, updates: 0, unchanged: 0, failures: 0 });
  };
  const exportCsv = (rs: ReadonlyArray<FormResponse>, name: string) => {
    const qs = (form.live ?? form.questions).filter((q) => q.kind !== 'statement');
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [['Sent', ...qs.map((q) => q.title || 'Untitled'), 'Source', 'Page', 'Filed as'].map(esc).join(','), ...rs.map((r) => [r.at.toISOString(), ...qs.map((q) => r.answers[q.id] ?? ''), r.from?.source ?? 'Direct', r.from?.page ?? '', filedAs(r) ? objectWord(state, filedAs(r)?.object ?? target, 1) : ''].map(esc).join(','))].join('\n');
    void saveFile(`${name}-responses.csv`, new Blob([csv], { type: 'text/csv' })).then((o) => { if (o === 'saved') { toast({ message: `${rs.length} ${rs.length === 1 ? 'submission' : 'submissions'} exported`, tone: 'success' }); dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: [{ id: newId('jb'), kind: 'export' as const, what: `${form.name} responses`, rows: rs.length, by: state.me, at: new Date(), file: csv, name: `${name}-responses.csv` }, ...(q.jobs ?? [])].slice(0, 20) }) }); } });
  };
  const finishes = form.responses.filter((r) => !r.spam).length;
  const live = form.status === 'live';
  const brandLook: GuestLookValue = { look: 'custom', accent: BRAND_HEX[state.prefs.workspace.colour] ?? '#0F766E', font: 'sans', scheme: 'light' };
  const lookFor = (f: { readonly useBrand?: boolean; readonly look?: GuestLookValue }) => (f.useBrand ? brandLook : f.look);
  // A visit to the live page counts as a view and a visit; each question reached feeds "Where people stop".
  useGuestScale(guest);
  useEffect(() => {
    if (!(guest && live && !closedNow(form))) return;
    dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ views: f.views + 1 }) });
    const id = newId('v'); visitId.current = id;
    dispatch({ type: 'visit/add', visit: { id, at: new Date(), page: `form:${form.id}`, source: prefill ? 'Prefilled link' : 'Direct', reached: 0, finished: false } });
  }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps
  const reach = (qid: string) => {
    dispatch({ type: 'form/patch', id: form.id, patch: (f) => ({ reached: { ...(f.reached ?? {}), [qid]: (f.reached?.[qid] ?? 0) + 1 } }) });
    const at = questions.filter((q) => q.kind !== 'hidden').findIndex((q) => q.id === qid) + 1;
    const vid = visitId.current; const v = (state.visits ?? []).find((x) => x.id === vid);
    if (vid && at > (v?.reached ?? 0)) dispatch({ type: 'visit/patch', id: vid, patch: { reached: at } });
  };
  const visitorView = live ? shownToVisitors : { ...form, questions: form.questions };
  /** An After they send route for these answers: its ending, or booking, or a link. */
  const routeFor = (answers: Readonly<Record<string, string>>) => (visitorView.routes ?? []).find((r) => { const a = answers[r.when] ?? ''; return a === r.is || a.split(', ').includes(r.is); });
  if (guest && toBooking) return <BookingCountdown name={toBooking.name} onGo={() => { const w = toBooking; setToBooking(undefined); setGuest(false); onBookGuest?.(w); }} onStay={() => { setToBooking(undefined); setGuest(false); }} />;
  if (guest) {
    const endings = (visitorView.endings ?? []).map((e) => ({ id: e.id, title: e.title, line: e.line, action: e.button && /^https?:\/\//.test(e.button.url) ? { label: e.button.label, href: e.button.url } : undefined }));
    return (
      <div className="tf-forms__guest">
        <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => { setGuest(false); setPrefill(undefined); }}>Back to the form</Button><span className="tf-rec__muted">{url}</span>
          {!live && <Tag size="sm" hue="orange">Preview · answers aren’t saved</Tag>}</div>
        {form.status === 'paused' || closedNow(form) ? <EmptyState icon={<Pause size={20} strokeWidth={1.75} />} title="This form is closed" description={form.closedMessage || `${form.owner.split(' ')[0]} isn't taking answers right now.`} /> : (
          <HostedForm look={lookFor(visitorView)} title={visitorView.headline || visitorView.name} description={visitorView.subtitle} logic={visitorView.mode === 'one' ? visitorView.logic : undefined} questions={visitorView.questions} mode={visitorView.mode}
            thanks={{ title: 'Thanks, we got it.', line: after.kind === 'redirect' && after.url ? `${after.message} Visitors now go to ${after.url}.` : after.message, action: after.kind === 'thanks' && after.button?.label && after.button.url ? { label: after.button.label, href: after.button.url } : undefined }}
            endings={endings} endingFor={(answers) => { const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])); const r = routeFor(flat); return r?.to === 'ending' ? r.ending : undefined; }}
            lang={(visitorView.lang ?? 'en') as FormLang} corners={visitorView.corners}
            onFinishLater={visitorView.saveProgress ? () => new Promise<string>((resolve) => window.setTimeout(() => resolve(`https://${url}?resume=${Math.random().toString(36).slice(2, 8)}`), 400)) : undefined}
            onReach={live ? reach : undefined} submitLabel={form.submitLabel || undefined} prefill={prefill} brand={{ name: state.prefs.workspace.name, logoSrc: state.prefs.workspace.logo, line: form.owner ? `Answers go to ${form.owner.split(' ')[0]}` : undefined }}
            onSubmit={(answers, meta) => new Promise<void>((resolve) => {
              const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join(', ') : '']));
              window.setTimeout(() => {
                const qs = visitorView.questions;
                const w = formWho(qs, flat);
                const route = routeFor(flat);
                if (live) {
                  // The spam check: links in the answers, weighed by the form's level. Doubtful sends wait in Needs review.
                  const links = linksIn(flat); const level = form.spamLevel ?? 'normal';
                  const spam = level === 'strict' ? links >= 1 : level === 'normal' ? links >= 2 : links >= 3;
                  const review = !spam && links >= 1 && level !== 'relaxed';
                  const consent = Object.fromEntries(qs.filter((q) => q.kind === 'consent' && flat[q.id] === 'Yes').map((q) => [q.id, q.defaultValue || (q.consentKind === 'marketing' ? 'Yes, email me news and offers' : 'I agree to the terms')]));
                  const r: FormResponse = { id: newId('r'), at: new Date(), answers: flat, spam: spam || undefined, state: review ? 'review' : undefined, why: spam ? 'It is full of links.' : review ? 'It looked doubtful, so it waits for you to say.' : undefined,
                    from: { source: prefill ? 'Prefilled link' : 'Direct', page: url, via: 'page' }, secs: meta?.secs, score: qs.some((q) => q.points) ? meta?.score : undefined, ending: meta?.ending, consent: Object.keys(consent).length ? consent : undefined };
                  const ref = form.saveTo !== 'none' && !spam && !review ? fileResponse(state, form, qs, attrOf, r, dispatch) : undefined;
                  patchResponses((rs) => [{ ...r, record: ref ? { object: ref.object, id: ref.id } : undefined, personId: ref?.object === 'people' ? ref.id : undefined, kept: ref?.kept.length ? ref.kept : undefined }, ...rs]);
                  if (visitId.current) dispatch({ type: 'visit/patch', id: visitId.current, patch: { finished: true, reached: qs.filter((q) => q.kind !== 'hidden').length, secs: meta?.secs, ref: r.id } });
                  const told = [...(form.notify ?? []), ...(form.confirmEmail && w.email ? [w.email] : [])];
                  if (told.length) toast({ message: `Emailed ${told.map((x) => x.split(' ')[0]).join(', ')}` });
                }
                if (route?.to === 'link' && route.url) toast({ message: `Visitors on this route now go to ${route.url}` });
                if ((route?.to === 'booking' || (!route && after.kind === 'booking')) && onBookGuest) setToBooking(w);
                resolve();
              }, 500);
            })} />
        )}
      </div>
    );
  }
  const saveTargets = target === 'none' ? [] : fieldsFor(state, target).map((f) => ({ id: f.id, label: `${objectWord(state, target, 1).replace(/^./, (c) => c.toUpperCase())} › ${f.label}` }));
  /** The builder speaks in each question's Save answer to; Records keeps the same choice in the form's mapping. */
  const builderQuestions = form.questions.map((q) => { const a = draftAttrOf(q); return { ...q, saveTo: a === 'none' ? undefined : a }; });
  const onBuilder = (next: ReadonlyArray<FormQuestion>) => {
    if (next.length > MAX_QUESTIONS) { toast({ message: `A form holds up to ${MAX_QUESTIONS} questions. Split it into two forms.`, tone: 'danger' }); return; }
    const mapping = { ...(form.mapping ?? {}) };
    next.forEach((q) => { const was = builderQuestions.find((x) => x.id === q.id); if (was && was.saveTo !== q.saveTo) mapping[q.id] = q.saveTo ?? 'none'; });
    set({ questions: next.map(({ saveTo: _s, ...q }) => q), mapping });
  };
  const scoreFields = target === 'none' ? [] : (state.objects.find((o) => o.id === target)?.attributes ?? []).filter((a) => a.type === 'number' || a.type === 'rating').map((a) => ({ id: a.id, label: a.name }));
  const groups = state.prefs.teams;
  const ownerValue = form.ownerGroup ? `team:${form.ownerGroup}` : form.owner;
  const retention = state.prefs.workspace.retention ?? 'forever';
  const months = (v: string) => (v === 'forever' ? Infinity : Number(v));
  const caught = form.responses.filter((r) => r.spam).length;
  const previewForm = { title: form.headline || form.name, description: form.subtitle, questions: form.questions, mode: form.mode, logic: form.mode === 'one' ? form.logic : undefined, look: lookFor(form), lang: (form.lang ?? 'en') as FormLang, corners: form.corners,
    endings: (form.endings ?? []).map((e) => ({ id: e.id, title: e.title, line: e.line })), submitLabel: form.submitLabel || undefined, onSubmit: () => Promise.resolve() };
  return (
    <div className="tf-forms tf-forms--edit">
      <div className="tf-forms__head">
        <IconButton label="All forms" onPress={onBack}><ArrowLeft {...i16} /></IconButton>
        <TextField aria-label="Form name" value={form.name} onChange={(name) => set({ name })} onBlur={() => { if (!form.name.trim()) set({ name: 'Untitled form' }); }} className="tf-forms__name" />
        <FormStatusTag status={statusOf(form)} />
        <span className="tf-rec__spacer" />
        {/* The same header as a booking page's: see it as a visitor, share, more. Publish lives in the bar at the foot. */}
        {/* The same header as every editor's: see it as a guest, Share, ⋯. Publish lives in the bar at the foot. */}
        <Button variant="ghost" icon={<Play {...i14} />} onPress={() => setGuest(true)}>See it as a guest</Button>
        <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => { if (form.status === 'draft') { toast({ message: 'Publish it first. The link works once the form is live.' }); } else setLiveOpen('share'); }}>Share</Button>
        <MenuTrigger>
          <IconButton label="More for this form"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="Form" placement="bottom end" onAction={(k) => {
            if (k === 'preview') setFullPreview(true);
            else if (k === 'copy') copy();
            else if (k === 'pause') { const was = form.status; set({ status: was === 'paused' ? 'live' : 'paused' }); toast({ message: was === 'paused' ? 'Taking answers again' : 'Paused. Visitors see that it’s closed.', action: { label: 'Undo', onAction: () => set({ status: was }) } }); }
            else if (k === 'discard') setDiscarding(true);
            else if (k === 'duplicate') { const d = duplicateOf(state, form); dispatch({ type: 'form/set', form: d }); onOpenForm?.(d.id); toast({ message: `${form.name} copied as a draft, without its responses`, tone: 'success' }); }
            else if (k === 'copyws') onCopy?.();
            else if (k === 'delete') { const before = form; const at = state.forms.findIndex((f) => f.id === form.id); dispatch({ type: 'form/remove', id: form.id }); onBack(); toast({ message: `${form.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'form/insert', form: before, at }) } }); }
          }}>
            <MenuItem id="preview" icon={<Eye {...i16} />} description="Desktop or phone, nothing is sent">Preview</MenuItem>
            <MenuItem id="copy" icon={<Copy {...i16} />} isDisabled={form.status === 'draft'}>Copy link</MenuItem>
            {form.status !== 'draft' && <MenuItem id="pause" icon={form.status === 'paused' ? <Play {...i16} /> : <Pause {...i16} />}>{form.status === 'paused' ? 'Resume' : 'Pause answers'}</MenuItem>}
            {edited(form) && <MenuItem id="discard">Discard changes</MenuItem>}
            <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate form</MenuItem>
            {onCopy && <MenuItem id="copyws" icon={<Copy {...i16} />}>Copy to another workspace…</MenuItem>}
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete form</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <Tabs aria-label="Form" selectedKey={tab} onSelectionChange={setTab}
        items={[{ id: 'questions', label: 'Questions', count: form.questions.length }, { id: 'settings', label: 'Settings' }, { id: 'records', label: 'Records' }, { id: 'share', label: 'Share' }, { id: 'responses', label: 'Responses', count: finishes }, { id: 'results', label: 'Results' }]}>
        <TabPanel id="questions" className="tf-forms__panel">
          <div className="tf-forms__build">
            <div className="tf-forms__builder"><QuestionBuilder title="" questions={builderQuestions} onChange={onBuilder} saveTargets={target === 'none' ? undefined : saveTargets} endings={form.endings} />
              {form.questions.length >= MAX_QUESTIONS - 10 ? <p className="tf-rec__muted tf-num">{form.questions.length} of {MAX_QUESTIONS} questions</p> : null}
              <AfterSendSection state={state} form={form} set={set} scoreFields={scoreFields} /></div>
            <div className="tf-forms__preview"><HostedFormPreview {...previewForm} address={url} onEdit={{ title: (headline) => set({ headline: headline || undefined }), description: (subtitle) => set({ subtitle: subtitle || undefined }), submitLabel: (submitLabel) => set({ submitLabel: submitLabel || undefined }) }}
              barAction={<DialogTrigger>
                <Button size="sm" variant="ghost" icon={<Palette {...i14} />}>{lookName(form.look, form.useBrand)}</Button>
                <Popover label="Form look" placement="bottom end" offset={6}>
                  <div className="tf-forms__look">
                    <div className="tf-set__switch"><span><strong>Use the workspace brand</strong><span className="tf-rec__muted">Your logo and colour, from Settings › Brand.</span></span><Switch aria-label="Use the workspace brand" isSelected={Boolean(form.useBrand)} onChange={(on) => set({ useBrand: on || undefined })} /></div>
                    {!form.useBrand && <GuestLook value={form.look ?? CALM_LOOK} onChange={(look) => set({ look })} isPreviewHidden />}
                    <div className="tf-bkf__group"><span className="tf-bkf__label">Corners</span><SegmentedControl aria-label="Corners" size="sm" selectedKey={form.corners ?? 'rounded'} onSelectionChange={(k) => set({ corners: k === 'square' ? 'square' : undefined })} items={[{ id: 'rounded', label: 'Rounded' }, { id: 'square', label: 'Square' }]} /></div>
                  </div>
                </Popover>
              </DialogTrigger>} /></div>
          </div>
        </TabPanel>
        <TabPanel id="settings" className="tf-forms__panel">
          <div className="tf-forms__setgrid">
          <div className="tf-forms__settings">
            <div className="tf-bkf__group"><span className="tf-bkf__label">Layout</span>
              <SegmentedControl aria-label="Layout" selectedKey={form.mode} onSelectionChange={(k) => set({ mode: k === 'page' ? 'page' : k === 'steps' ? 'steps' : 'one' })} items={[{ id: 'one', label: 'One at a time' }, { id: 'steps', label: 'Steps' }, { id: 'page', label: 'Classic: one page' }]} />
              {form.mode === 'steps' && <p className="tf-rec__muted">{form.questions.filter((q, n) => n > 0 && q.step).length ? `${form.questions.filter((q, n) => n === 0 || q.step).length} steps. Add, rename or merge them from a question’s ⋯ on Questions.` : 'Everything is one step for now. Start a new step from a question’s ⋯ on Questions.'}</p>}</div>
            <div className="tf-bkf__pair">
              <Select label="Form language" value={form.lang ?? 'en'} onChange={(v) => set({ lang: !v || v === 'en' ? undefined : v as FormLang })} items={FORM_LANGS.map((l) => ({ id: l.id, label: l.label }))} description="Its buttons and steps. Your questions stay as you wrote them." />
              <div className="tf-set__switch"><span><strong>Save progress</strong><span className="tf-rec__muted">Visitors can leave and come back with a link.</span></span><Switch aria-label="Save progress" isSelected={Boolean(form.saveProgress)} onChange={(on) => set({ saveProgress: on || undefined })} /></div>
            </div>
            <TextArea label="Subtitle" aside="Optional" rows={2} value={form.subtitle ?? ''} onChange={(subtitle) => set({ subtitle: subtitle || undefined })} description="A line under the title. You can also type it on the preview." />
            <TextField label="Link" value={form.slug} onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} onBlur={() => { const clean = form.slug.replace(/-+/g, '-').replace(/^-|-$/g, ''); if (clean !== form.slug || !clean) set({ slug: clean || `form-${form.id.slice(-4)}` }); }}
              isInvalid={slugTaken} errorMessage={slugTaken ? 'Another form uses this link' : undefined} description="The address of the form. Change it before you share it." />
            {form.mode === 'one' && (form.logic?.length ?? 0) > 0 && <ShowMore showLabel="More options" hideLabel="Fewer options" defaultExpanded>
              <LogicEditor form={form} onChange={(logic) => set({ logic })} />
            </ShowMore>}
            <Select label="Owner" value={ownerValue} onChange={(v) => { if (!v) return; if (v.startsWith('team:')) set({ ownerGroup: v.slice(5) }); else set({ owner: v, ownerGroup: undefined }); }}
              items={[...state.members.map((m) => ({ id: m.name, label: m.name })), ...groups.map((g) => ({ id: `team:${g.id}`, label: `${g.name} · round robin`, description: g.members.length === 1 ? '1 teammate' : `${g.members.length} teammates` }))]}
              description={form.ownerGroup ? `Each new record goes to the next teammate in ${groups.find((g) => g.id === form.ownerGroup)?.name ?? 'the group'}.` : 'For new records only.'} />
            <div className="tf-bkf__group"><span className="tf-bkf__label">Closing</span>
              <div className="tf-bkf__pair">
                <TextField label="Stop taking answers on" aside="Optional" type="date" value={form.closesOn ?? ''} onChange={(v) => set({ closesOn: v || undefined })} />
                <TextField label="Or after this many" aside="Optional" inputMode="numeric" value={form.maxResponses ? String(form.maxResponses) : ''} onChange={(v) => { const n = Number(v.replace(/[^\d]/g, '')); set({ maxResponses: n > 0 ? n : undefined }); }} description={form.maxResponses ? `${finishes} of ${form.maxResponses} so far` : undefined} />
              </div>
              {(form.closesOn || form.maxResponses) && <TextArea label="What visitors see when it’s closed" rows={2} value={form.closedMessage ?? ''} placeholder={`${form.owner.split(' ')[0]} isn't taking answers right now.`} onChange={(v) => set({ closedMessage: v || undefined })} />}
              {closedNow(form) && <Callout tone="warning">Closed now: {form.closesOn && new Date(`${form.closesOn}T23:59`) < new Date() ? 'the date has passed' : 'it reached its limit'}. Visitors see the closed message.</Callout>}
            </div>
            <div className="tf-bkf__group"><span className="tf-bkf__label">Emails</span>
              <ChoiceChips label="Email each submission to" selectionMode="multiple" size="sm" selectedKeys={form.notify ?? []} items={state.members.map((m) => ({ id: m.name, label: m.name.split(' ')[0] ?? m.name }))}
                onSelectionChange={(k) => set({ notify: k.size ? [...k] : undefined })} />
              <span className="tf-rec__muted">{form.notify?.length ? `${form.notify.length} ${form.notify.length === 1 ? 'person is' : 'people are'} emailed each one. The Inbox gets it too.` : 'Nobody else. The Inbox still gets each one.'}</span>
              <div className="tf-set__switch"><span><strong>Send them a confirmation</strong><span className="tf-rec__muted">To the email they gave, with their answers.</span></span><Switch aria-label="Send a confirmation" isSelected={Boolean(form.confirmEmail)} onChange={(on) => set({ confirmEmail: on ? { subject: `We got your answers: ${form.name}`, line: 'Thanks for writing. We’ll be in touch soon.' } : undefined })} /></div>
              {form.confirmEmail && <div className="tf-bkf__pair"><TextField label="Subject" value={form.confirmEmail.subject} onChange={(subject) => set({ confirmEmail: { ...(form.confirmEmail ?? { line: '' }), subject } })} /><TextField label="First line" value={form.confirmEmail.line} onChange={(line) => set({ confirmEmail: { ...(form.confirmEmail ?? { subject: '' }), line } })} /></div>}
            </div>
            <div className="tf-bkf__group"><span className="tf-bkf__label">Submissions</span>
              <Select label="Keep submissions" value={retention} onChange={(v) => { if (!v || v === retention) return; if (months(v) < months(retention)) setKeepAsk(v); else dispatch({ type: 'prefs/set', prefs: { workspace: { ...state.prefs.workspace, retention: v } }, note: `${state.me} set form answers to keep ${v === 'forever' ? 'until deleted' : `${v} months`}` }); }}
                items={[{ id: 'forever', label: 'Until deleted' }, { id: '24', label: 'For 24 months' }, { id: '12', label: 'For 12 months' }, { id: '6', label: 'For 6 months' }]} description="This applies to every form in the workspace. Older ones are deleted nightly; the people they made stay." />
              <div className="tf-set__row tf-forms__spam"><span className="tf-set__grow"><strong>Spam check</strong><span className="tf-rec__muted"> · {caught ? `${caught} caught` : 'Nothing caught'}. Bots go to Spam; doubtful sends wait in Needs review.</span></span>
                <Select label="How strict" isLabelHidden className="tf-you__select" value={form.spamLevel ?? 'normal'} onChange={(v) => set({ spamLevel: v === 'relaxed' ? 'relaxed' : v === 'strict' ? 'strict' : undefined })} items={[{ id: 'relaxed', label: 'Relaxed', description: 'Only obvious bots' }, { id: 'normal', label: 'Normal', description: 'Bots, and links held for review' }, { id: 'strict', label: 'Strict', description: 'Any link goes to Spam' }]} />
                <Button size="sm" variant="ghost" onPress={() => { setSubFilter('spam'); setTab('responses'); }}>View spam</Button></div>
            </div>
          </div>
          {/* The form at a glance, with the switches people look for before publishing (owner's 11 Nov reference). */}
          <aside className="tf-forms__summary" aria-label="Form summary">
            <SettingsSection title="Form summary">
              <dl className="tf-set__facts">
                {[['Questions', String(form.questions.filter((q) => q.kind !== 'statement').length)], ['Layout', form.mode === 'steps' ? 'Steps' : form.mode === 'page' ? 'One page' : 'One at a time'],
                  ['Answers go to', form.saveTo === 'none' ? 'This form only' : objectWord(state, form.saveTo, 2)], ['Owner', form.ownerGroup ? `${groups.find((g) => g.id === form.ownerGroup)?.name ?? 'Group'} (round robin)` : form.owner], ['Status', form.status === 'live' ? (edited(form) ? 'Live, with unpublished edits' : 'Live') : form.status === 'paused' ? 'Paused' : 'Draft']]
                  .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </SettingsSection>
            <SettingsSection title="When someone answers">
              <div className="tf-set__switch"><span><strong>Email {form.notify?.[0]?.split(' ')[0] ?? form.owner.split(' ')[0]}{(form.notify?.length ?? 0) > 1 ? ` +${(form.notify?.length ?? 1) - 1}` : ''}</strong><span className="tf-rec__muted">Each response, as it arrives.</span></span><Switch aria-label="Email each response" isSelected={Boolean(form.notify?.length)} onChange={(on) => set({ notify: on ? [form.owner] : undefined })} /></div>
              <div className="tf-set__switch"><span><strong>Confirm to them</strong><span className="tf-rec__muted">An email with their answers.</span></span><Switch aria-label="Send a confirmation email" isSelected={Boolean(form.confirmEmail)} onChange={(on) => set({ confirmEmail: on ? { subject: `We got your answers: ${form.name}`, line: 'Thanks for writing. We’ll be in touch soon.' } : undefined })} /></div>
              <div className="tf-set__switch"><span><strong>Spam check</strong><span className="tf-rec__muted">{form.spamLevel === 'strict' ? 'Strict' : form.spamLevel === 'relaxed' ? 'Relaxed' : 'Normal'}: bot answers go to Spam.</span></span><Tag size="sm" hue="green">On</Tag></div>
            </SettingsSection>
            <p className="tf-rec__muted">{form.status === 'draft' ? 'Not published yet. Publish from the bar at the foot.' : edited(form) ? 'Your edits wait for Publish, in the bar at the foot.' : `Live at ${url}.`}</p>
          </aside>
          </div>
        </TabPanel>
        <TabPanel id="records" className="tf-forms__panel">
          <RecordsPanel state={state} form={form} dispatch={dispatch} set={set} attrOf={draftAttrOf} unfiled={unfiledRs.length} onFileEarlier={() => setSyncOpen(true)} />
        </TabPanel>
        <TabPanel id="share" className="tf-forms__panel">
          {form.status === 'draft' ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="Publish to share" description="The link and embeds work once the form is live." action={<Button size="sm" variant="primary" onPress={publish}>Publish</Button>} /> : (
            <div className="tf-forms__settings">
              <div className="tf-forms__link"><span className="tf-num">{url}</span><span className="tf-set__row">
                <Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={copy}>Copy</Button>
                <Button size="sm" variant="secondary" icon={<Share2 {...i14} />} onPress={() => setLiveOpen('share')}>Share</Button></span></div>
              {qr && <QrSheet url={url} name={form.name} onClose={() => setQr(false)} />}
              <EmbedSection form={form} url={url} set={set} />
              <span className="tf-bkf__label">Fill answers from the link</span>
              <p className="tf-rec__muted">Add any of these to the link and the form opens with the answer filled in. Hidden fields read theirs from here.</p>
              <ul className="tf-set__list">{questions.filter((q) => q.kind !== 'statement').map((q) => <li key={q.id}><span>{q.title || 'Untitled question'}</span><code className="tf-forms__key">?{keyOf(q)}=</code></li>)}</ul>
              {(() => { const sample = questions.filter((q) => q.kind === 'short' || q.kind === 'email' || q.kind === 'hidden').slice(0, 3); const vals = sample.map((q) => [q, q.kind === 'email' ? 'asha@example.com' : q.kind === 'hidden' ? 'newsletter' : 'Asha Rao'] as const); const link = `https://${url}?${vals.map(([q, v]) => `${keyOf(q)}=${encodeURIComponent(v)}`).join('&')}`;
                return sample.length ? <div className="tf-set__row"><TextField label="Example" value={link} isReadOnly className="tf-set__grow" /><Button size="sm" variant="secondary" onPress={() => { setPrefill(Object.fromEntries(vals.map(([q, v]) => [q.id, v]))); setGuest(true); }}>Open it</Button></div> : null; })()}
              <DevelopersSection form={form} questions={questions} set={set} />
            </div>
          )}
        </TabPanel>
        <TabPanel id="responses" className="tf-forms__panel">
          <SubmissionsPanel state={state} form={form} questions={form.live ?? form.questions} targetName={targetName} who={who} filedAs={filedAs} attrOf={attrOf} onFile={fileMany} patchResponses={patchResponses}
            onOpenRecord={onOpenRecord} onExport={exportCsv} onSyncEarlier={() => setSyncOpen(true)} filter={subFilter} onFilter={setSubFilter} />
        </TabPanel>
        <TabPanel id="results" className="tf-forms__panel">
          <AnalyticsPanel state={state} form={form} questions={questions} />
        </TabPanel>
      </Tabs>
      {discarding && <Dialog isOpen onOpenChange={(o) => { if (!o) setDiscarding(false); }} title="Discard your changes?" description="The form goes back to what visitors see now. You can undo this."
        actions={<><Button variant="ghost" slot="close">Keep editing</Button><Button variant="danger" onPress={() => { setDiscarding(false); const was = Object.fromEntries([...CONFIG_KEYS, 'questions'].map((k) => [k, form[k as keyof AppForm]])) as Partial<AppForm>; const cfg = form.liveConfig ? (JSON.parse(form.liveConfig) as Partial<AppForm>) : {}; set({ questions: form.live ?? form.questions, ...cfg }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => set(was) } }); }}>Discard changes</Button></>} />}
      <ShareSheet isOpen={liveOpen !== undefined} onOpenChange={(o) => { if (!o) setLiveOpen(undefined); }} title={liveOpen === 'live' ? `${form.name} is live` : `Share ${form.name}`} url={url} name={form.name} onSite={() => { setLiveOpen(undefined); setTab('share'); }}
        footer={<>{form.saveTo === 'none' ? 'Answers stay in Submissions' : `Answers go to ${targetName(2)}`} · <Button size="sm" variant="ghost" onPress={() => { setLiveOpen(undefined); setTab('records'); }}>Change</Button></>} />
      {syncOpen && <SyncDialog total={form.responses.filter((r) => !r.spam && !r.state).length} unfiled={unfiledRs.length} preview={syncPreview} targetName={targetName(2)} onClose={() => setSyncOpen(false)}
        onSync={(all) => { const pool = form.responses.filter((r) => !r.spam && !r.state && (all || !filedAs(r))); setSyncOpen(false); const n = fileMany(pool); toast({ message: n === pool.length ? `${n} ${n === 1 ? 'submission' : 'submissions'} synced.` : `${n} synced; ${pool.length - n} couldn’t be.`, tone: n ? 'success' : 'danger' }); }} />}
      {keepAsk && <Dialog isOpen onOpenChange={(o) => { if (!o) setKeepAsk(undefined); }} title={`Keep submissions for ${keepAsk} months?`}
        description={(() => { const cut = Date.now() - Number(keepAsk) * 30 * 86_400_000; const old = state.forms.reduce((n, f) => n + f.responses.filter((r) => r.at.getTime() < cut).length, 0); return `${old ? `${old} older ${old === 1 ? 'submission is' : 'submissions are'} deleted tonight` : 'Nothing is old enough to go yet'}, across every form. The people they made stay.`; })()}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { dispatch({ type: 'prefs/set', prefs: { workspace: { ...state.prefs.workspace, retention: keepAsk } }, note: `${state.me} set form answers to keep ${keepAsk} months` }); setKeepAsk(undefined); toast({ message: `Submissions are kept for ${keepAsk} months.` }); }}>Keep for {keepAsk} months</Button></>} />}
      {fullPreview && <FullPreview form={previewForm} address={url} onClose={() => setFullPreview(false)} />}
      <div className="tf-forms__publish">
        <PublishBar status={form.status === 'draft' || edited(form) ? 'draft' : 'live'} changes={1} message={form.status === 'draft' ? 'Not published yet' : 'Unpublished changes'}
          onPublish={publish} onDiscard={form.status === 'draft' ? undefined : () => setDiscarding(true)} />
      </div>
    </div>
  );
}

/** A route's answers, for the Records summary. */
export const routeWords = (q: FormQuestion | undefined) => routable(q).join(', ');

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
  { readonly object: string; readonly id: string; readonly label: string; readonly matched: boolean; /** Questions whose answer the record kept its own value for (Replace was off). */ readonly kept: ReadonlyArray<string> } | undefined {
  const target = form.saveTo; if (target === 'none') return undefined;
  const f: Record<string, string> = {};
  for (const q of questions) { const a = attrOf(q); const v = (r.answers[q.id] ?? '').trim(); if (v && a !== 'none') f[a] = v; }
  // A matched record keeps a different value it already has unless the question replaces it; those answers wait on the submission.
  const kept: string[] = [];
  const keepOwn = (rec: Readonly<Record<string, unknown>>) => { for (const q of questions) { const a = attrOf(q); const had = rec[a] ?? (rec.extra as Readonly<Record<string, unknown>> | undefined)?.[a]; if (a !== 'none' && a !== 'name' && a !== 'email' && !q.overwrite && f[a] && typeof had === 'string' && had.trim() && had !== f[a]) { kept.push(q.id); delete f[a]; } } };
  const emailQ = questions.find((q) => q.kind === 'email'); const email = f.email ?? (emailQ ? (r.answers[emailQ.id] ?? '').trim() : '');
  const by = form.matchBy ?? defaultMatch(target);
  const domain = (f.domain ?? email.split('@')[1] ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const key = (by === 'email' ? email : by === 'phone' ? f.phone ?? '' : by === 'domain' ? domain : f.name ?? '').toLowerCase();
  const label = f.name || email || domain || 'New record';
  if (!key && !f.name && !email) return undefined;
  const memo = key ? madeNow?.get(`${target}:${key}`) : undefined;
  if (memo) return { object: target, id: memo, label, matched: true, kept: [] };
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
    if (m) keepOwn(m as unknown as Readonly<Record<string, unknown>>);
    const companyId = companyFor(f.company);
    if (m) { matched = true; id = m.id; dispatch({ type: 'records/fields', object: 'people', changes: [{ id: m.id, patch: { tags: [...new Set([...m.tags, ...tags])], ...(f.title ? { title: f.title } : {}), ...(f.phone ? { phone: f.phone } : {}), ...(companyId ? { companyId } : {}), ...(hasExtra ? { extra: { ...(m.extra ?? {}), ...extra } } : {}) } }] }); }
    else { id = newId('p'); dispatch({ type: 'person/set', person: { id, name: f.name || email, email, title: f.title ?? '', phone: f.phone, companyId, owner: form.owner, tags, created: now, extra: hasExtra ? extra : undefined } }); }
    dispatch({ type: 'activity/add', activity: { id: newId('a'), record: { object: 'people', id }, kind: 'form', actor: label, text: `sent ${form.name}`, at: r.at } });
    if (form.alsoDeal && !matched) dispatch({ type: 'deal/set', deal: { id: newId('d'), name: `${label} · ${form.name}`, companyId: companyId ?? '', contactId: id, stage: (STAGES as ReadonlyArray<string>).includes(form.alsoDeal.stage) ? form.alsoDeal.stage as typeof STAGES[number] : 'Lead', amount: Number((f.amount ?? '').replace(/[^\d.]/g, '')) || 0, owner: form.owner, close: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()), created: now } });
  } else if (target === 'companies') {
    const m = state.companies.find((c) => (by === 'name' ? c.name.toLowerCase() === key : c.domain.toLowerCase() === key) && key !== '');
    if (m) keepOwn(m as unknown as Readonly<Record<string, unknown>>);
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
  return { object: target, id, label: matched ? (target === 'people' ? state.people.find((p) => p.id === id)?.name ?? label : label) : label, matched, kept };
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
          <div className="tf-rec__form tf-set__narrow">{LISTS_ON && <Select label="Add to a list" value={form.toList ?? 'none'} onChange={(v) => set({ toList: v && v !== 'none' ? v : undefined })} items={[{ id: 'none', label: 'No list' }, ...lists.map((l) => ({ id: l.id, label: l.name }))]} description={lists.length === 0 ? `No ${objectWord(state, target, 2).toLowerCase()} lists yet.` : 'Each record goes in its first stage.'} />}</div>
        </SettingsSection>
      )}
      <Callout tone="neutral">{summary}</Callout>
      {target !== 'none' && unfiled > 0 && <Callout tone="info" action={{ label: 'File them', onPress: onFileEarlier }}>{unfiled === 1 ? '1 earlier response isn’t filed yet.' : `${unfiled} earlier responses aren’t filed yet.`}</Callout>}
    </div>
  );
}

