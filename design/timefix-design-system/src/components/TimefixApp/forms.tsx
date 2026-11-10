// Forms: a list of cards, New form from a gallery, and one editor with five tabs: Questions (builder beside the live preview),
// Settings (layout, where answers go, what happens after), Share (link and embeds), Responses (with Add to People, spam, delete + Undo),
// Results (views, finishes, where people stop). Edits are a draft until Publish; the visitor's page is HostedForm itself.
import { useState } from 'react';
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
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { newId, type AppAction, type AppForm, type AppState, type FormResponse } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const statusOf = (f: AppForm) => (f.status === 'paused' ? 'closed' : f.status === 'live' ? 'live' : 'draft') as 'draft' | 'live' | 'closed';
const edited = (f: AppForm) => f.status !== 'draft' && JSON.stringify(f.questions) !== JSON.stringify(f.live);

const TEMPLATES: ReadonlyArray<{ readonly id: string; readonly name: string; readonly line: string; readonly questions: ReadonlyArray<FormQuestion> }> = [
  { id: 'blank', name: 'Blank', line: 'Start from nothing', questions: [] },
  { id: 'contact', name: 'Contact us', line: 'Name, email and a message', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'long', title: 'How can we help?' }] },
  { id: 'lead', name: 'Lead capture', line: 'Qualify, then book a call', questions: [{ id: 'a', kind: 'short', title: 'Your name', required: true }, { id: 'b', kind: 'email', title: 'Work email', required: true }, { id: 'c', kind: 'choice', title: 'Team size', options: ['1–10', '11–50', '51+'] }] },
  { id: 'event', name: 'Event signup', line: 'Who’s coming, and any needs', questions: [{ id: 'a', kind: 'short', title: 'Name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'dropdown', title: 'Which session?', options: ['Morning', 'Afternoon'] }] },
  { id: 'feedback', name: 'Feedback', line: 'A rating and a few words', questions: [{ id: 'a', kind: 'rating', title: 'How did we do?', required: true }, { id: 'b', kind: 'long', title: 'Anything to add?' }] },
  { id: 'job', name: 'Job application', line: 'CV, links and a cover note', questions: [{ id: 'a', kind: 'short', title: 'Full name', required: true }, { id: 'b', kind: 'email', title: 'Email', required: true }, { id: 'c', kind: 'file', title: 'Your CV', required: true }] },
];

/** Props for FormsScreen. */
export interface FormsScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly onOpenPerson: (id: string) => void;
  readonly onBookings: (tab: string) => void;
}

/** The forms list, or one form open. */
export function FormsScreen({ state, dispatch, onOpenPerson, onBookings }: FormsScreenProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string>();
  const [gallery, setGallery] = useState(false);
  const form = state.forms.find((f) => f.id === openId);
  if (form) return <FormEditor state={state} form={form} dispatch={dispatch} onBack={() => setOpenId(undefined)} onOpenPerson={onOpenPerson} onBookings={onBookings} />;
  return (
    <div className="tf-forms">
      <div className="tf-rec__bar"><span className="tf-rec__muted">{state.forms.length} forms · {state.forms.reduce((n, f) => n + f.responses.filter((r) => !r.spam).length, 0)} responses</span><span className="tf-rec__spacer" />
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setGallery(true)}>New form</Button></div>
      {state.forms.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No forms yet" description="Collect leads, signups and feedback; answers file into People." action={<Button size="sm" variant="primary" onPress={() => setGallery(true)}>New form</Button>} /> : (
        <ul className="tf-forms__grid">
          {state.forms.map((f) => <li key={f.id}><FormCard name={f.name} status={statusOf(f)} responses={f.responses.filter((r) => !r.spam).length} updated={`Edited ${ago(f.updated)}`} questions={f.questions} onPress={() => setOpenId(f.id)} /></li>)}
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

function FormEditor({ state, form, dispatch, onBack, onOpenPerson, onBookings }: { readonly state: AppState; readonly form: AppForm; readonly dispatch: (a: AppAction) => void; readonly onBack: () => void; readonly onOpenPerson: (id: string) => void; readonly onBookings: (tab: string) => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('questions');
  const [guest, setGuest] = useState(false);
  const [openResp, setOpenResp] = useState<string>();
  const [showSpam, setShowSpam] = useState(false);
  const set = (patch: Partial<AppForm>) => dispatch({ type: 'form/set', form: { ...form, ...patch, updated: new Date() } });
  const url = `timefix.com/f/${form.slug}`;
  const copy = () => { void navigator.clipboard?.writeText(`https://${url}`).catch(() => undefined); toast({ message: 'Link copied', tone: 'success' }); };
  const publish = () => { const first = form.status === 'draft'; set({ status: form.status === 'paused' ? 'paused' : 'live', live: form.questions }); toast({ message: first ? 'Your form is live. Share the link.' : 'Published. Visitors see the new version.', tone: 'success', action: first ? { label: 'Copy link', onAction: copy } : undefined }); };
  const responses = form.responses.filter((r) => (showSpam ? r.spam : !r.spam));
  const resp = form.responses.find((r) => r.id === openResp);
  const setResp = (r: FormResponse) => set({ responses: form.responses.map((x) => (x.id === r.id ? r : x)) });
  const addToPeople = (r: FormResponse) => {
    const id = newId('p');
    dispatch({ type: 'person/set', person: { id, name: r.answers['q-name'] ?? 'New person', email: r.answers['q-email'] ?? '', title: '', owner: form.owner, tags: [form.name], created: new Date() } });
    setResp({ ...r, personId: id }); toast({ message: `${r.answers['q-name'] ?? 'Person'} added to People`, tone: 'success', action: { label: 'Open', onAction: () => onOpenPerson(id) } });
  };
  const finishes = form.responses.filter((r) => !r.spam).length;
  const starts = Math.round(finishes * 1.6) + (form.views ? 12 : 0);
  if (guest) {
    return (
      <div className="tf-forms__guest">
        <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setGuest(false)}>Back to the form</Button><span className="tf-rec__muted">{url}</span></div>
        {form.status === 'paused' ? <EmptyState icon={<Pause size={20} strokeWidth={1.75} />} title="This form is closed" description={`${state.me.split(' ')[0]} isn't taking answers right now.`} /> : (
          <HostedForm title={form.name} questions={form.live ?? form.questions} mode={form.mode} thanks={{ title: 'Thanks, we got it.', line: form.after.message }}
            onSubmit={(answers) => new Promise<void>((resolve) => {
              const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join(', ') : '']));
              const r: FormResponse = { id: newId('r'), at: new Date(), answers: flat };
              window.setTimeout(() => { set({ responses: [r, ...form.responses] }); if (form.after.kind === 'booking') toast({ message: 'Next they pick a time on your booking page', action: { label: 'See it', onAction: () => onBookings('pages') } }); resolve(); }, 500);
            })} />
        )}
      </div>
    );
  }
  return (
    <div className="tf-forms tf-forms--edit">
      <div className="tf-forms__head">
        <IconButton label="All forms" onPress={onBack}><ArrowLeft {...i16} /></IconButton>
        <TextField aria-label="Form name" value={form.name} onChange={(name) => set({ name })} className="tf-forms__name" />
        <FormStatusTag status={statusOf(form)} />
        {edited(form) && <Tag size="sm" hue="orange">Edited, not published</Tag>}
        <span className="tf-rec__spacer" />
        <Button variant="ghost" icon={<Copy {...i14} />} onPress={copy} isDisabled={form.status === 'draft'}>Copy link</Button>
        <Button variant="secondary" icon={<ExternalLink {...i14} />} onPress={() => setGuest(true)}>Preview</Button>
        <Button variant="primary" isDisabled={form.status !== 'draft' && !edited(form)} onPress={publish}>{form.status === 'draft' ? 'Publish' : 'Publish changes'}</Button>
        <MenuTrigger>
          <IconButton label="More for this form"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="Form" placement="bottom end" onAction={(k) => {
            if (k === 'pause') { const was = form.status; set({ status: was === 'paused' ? 'live' : 'paused' }); toast({ message: was === 'paused' ? 'Taking answers again' : 'Paused. Visitors see that it’s closed.', action: { label: 'Undo', onAction: () => set({ status: was }) } }); }
            else if (k === 'discard') { const before = form; set({ questions: form.live ?? form.questions }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => dispatch({ type: 'form/set', form: before }) } }); }
            else if (k === 'delete') { const before = form; dispatch({ type: 'form/remove', id: form.id }); onBack(); toast({ message: `${form.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'form/set', form: before }) } }); }
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
            <div className="tf-forms__builder"><QuestionBuilder questions={form.questions} onChange={(questions) => set({ questions })} /></div>
            <div className="tf-forms__preview"><HostedFormPreview title={form.name} questions={form.questions} mode={form.mode} address={url} onSubmit={() => Promise.resolve()} /></div>
          </div>
        </TabPanel>
        <TabPanel id="settings" className="tf-forms__panel">
          <div className="tf-forms__settings">
            <div className="tf-bkf__group"><span className="tf-bkf__label">Layout</span>
              <SegmentedControl aria-label="Layout" selectedKey={form.mode} onSelectionChange={(k) => set({ mode: k === 'page' ? 'page' : 'one' })} items={[{ id: 'one', label: 'One question at a time' }, { id: 'page', label: 'All on one page' }]} /></div>
            <TextField label="Link" value={form.slug} onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} description="Old links keep working when you change it." />
            <Select label="Save answers to" value={form.saveTo} onChange={(v) => set({ saveTo: v === 'none' ? 'none' : 'people' })}
              items={[{ id: 'people', label: 'People', description: 'Matched by email; new people are added' }, { id: 'none', label: 'Keep answers only' }]} />
            <Select label="Owner" value={form.owner} onChange={(v) => set({ owner: v ?? form.owner })} items={state.members.map((m) => ({ id: m.name, label: m.name }))} />
            <div className="tf-bkf__group"><span className="tf-bkf__label">After they send</span>
              <SegmentedControl aria-label="After they send" selectedKey={form.after.kind} onSelectionChange={(k) => set({ after: { ...form.after, kind: k === 'booking' ? 'booking' : 'thanks' } })} items={[{ id: 'thanks', label: 'Say thanks' }, { id: 'booking', label: 'Book a meeting' }]} />
              <TextArea label="Message" rows={2} value={form.after.message} onChange={(message) => set({ after: { ...form.after, message } })} />
              {form.after.kind === 'booking' && <p className="tf-rec__muted">Their name and email carry over to your Discovery call booking page, so they only pick a time.</p>}
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
                    <Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => { void navigator.clipboard?.writeText(`<script src="https://timefix.com/embed.js" data-form="${form.slug}" data-mode="${e.id}"></script>`).catch(() => undefined); toast({ message: 'Code copied', tone: 'success' }); }}>Copy code</Button></li>
                ))}
              </ul>
              <TextField label="Prefilled link" description="For developers: fills answers from the link, like ?email=" value={`https://${url}?email={email}`} isReadOnly />
            </div>
          )}
        </TabPanel>
        <TabPanel id="responses" className="tf-forms__panel">
          <div className="tf-rec__bar"><SegmentedControl aria-label="Which" size="sm" selectedKey={showSpam ? 'spam' : 'in'} onSelectionChange={(k) => setShowSpam(k === 'spam')}
            items={[{ id: 'in', label: `Responses · ${finishes}` }, { id: 'spam', label: `Spam · ${form.responses.length - finishes}` }]} /></div>
          {responses.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={showSpam ? 'No spam' : 'No responses yet'} description={showSpam ? 'Bot answers are kept here, out of your way.' : 'Share the link; answers show up here as they arrive.'} /> : (
            <div className="tf-forms__resp">
              <ul className="tf-forms__rows">
                {responses.map((r) => (
                  <li key={r.id}><button type="button" className="tf-forms__row" aria-current={openResp === r.id || undefined} onClick={() => setOpenResp(r.id)}>
                    <strong>{r.answers['q-name'] ?? 'Anonymous'}</strong><span className="tf-rec__muted">{r.answers['q-email'] ?? Object.values(r.answers)[0]}</span>
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
                      <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { const before = form; set({ responses: form.responses.filter((x) => x.id !== resp.id) }); setOpenResp(undefined); toast({ message: 'Response deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'form/set', form: before }) } }); }}>Delete</Button>
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
            <StatCard label="Started" value={starts} />
            <StatCard label="Finished" value={finishes} />
            <StatCard label="Finish rate" value={starts ? Math.round((finishes / starts) * 100) : 0} format={(n) => `${n}%`} />
          </div>
          <section className="tf-recp__sec"><h3>Where people stop</h3>
            <ul className="tf-forms__drop">
              {(form.live ?? form.questions).map((q, n, all) => { const left = Math.round(100 - (n / Math.max(1, all.length)) * (100 - (starts ? (finishes / starts) * 100 : 100))); return (
                <li key={q.id}><span>{q.title}</span><span className="tf-forms__bar" aria-hidden><span data-w={Math.round(left / 10) * 10} /></span><span className="tf-num tf-rec__muted">{left}%</span></li>
              ); })}
            </ul>
          </section>
        </TabPanel>
      </Tabs>
    </div>
  );
}

