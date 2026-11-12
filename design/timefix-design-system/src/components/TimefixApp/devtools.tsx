// Settings › Developer and background work, as the real app has them: Webhooks (endpoints, events, a secret shown once, rotate, test,
// on/off, the delivery log with Resend, delete, at most 10), API keys (last used, the API reference, revoke with Undo) and Background jobs
// (counted, then waiting for Review, progress, cancel after asking, a summary; members see only their own).
import { useEffect, useState } from 'react';
import { ChevronRight, Code2, Plus, RefreshCw, Trash2, Webhook as WebhookIcon, Workflow } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { ConfirmDialog, Dialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TextField } from '../Field/Field.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { CodeBlock } from '../Code/Code.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Link } from '../Link/Link.tsx';
import { InfoTip } from '../Popover/Popover.tsx';
import { ProgressBar } from '../Progress/Progress.tsx';
import { relativeTime } from '../TeamList/TeamList.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { newId, type AppAction, type AppState, type BulkJob, type Webhook } from './data.ts';

type Dispatch = (a: AppAction) => void;
/** The events an endpoint can get, as the real app names them. */
export const WEBHOOK_EVENTS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 'booking.created', label: 'Booking made' }, { id: 'booking.rescheduled', label: 'Booking moved' }, { id: 'booking.cancelled', label: 'Booking cancelled' },
  { id: 'booking.no_show', label: 'No show' }, { id: 'form.submitted', label: 'Form submitted' }, { id: 'link_page.signup', label: 'Link page signup' },
];
const eventLabel = (id: string) => (id === 'ping' ? 'Test event' : WEBHOOK_EVENTS.find((e) => e.id === id)?.label ?? id);
const MAX = 10;
/** Why an endpoint address can't be used (client and server checks together), or undefined. */
export function urlProblem(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return 'Enter the address to send events to.';
  if (v.length > 2048) return 'Keep the address to 2,048 characters.';
  let u: URL; try { u = new URL(v); } catch { return 'Enter a full web address, such as https://example.com/hooks.'; }
  if (u.protocol !== 'https:') return 'Use an https address.';
  if (u.port && u.port !== '443') return 'Use the standard https port (443).';
  if (u.username || u.password) return 'Leave the user name and password out of the address.';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.includes(':')) return 'Use a host name, not an IP address.';
  if (u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) return 'That address points to a private network. Use a public one.';
  return undefined;
}
const secret = () => `whsec_${Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('')}`;
const STATUS: Readonly<Record<Webhook['log'][number]['status'], { readonly label: string; readonly shape: 'done' | 'waiting' | 'failed' }>> = { delivered: { label: 'Delivered', shape: 'done' }, waiting: { label: 'Waiting', shape: 'waiting' }, failed: { label: 'Failed', shape: 'failed' }, 'gave-up': { label: 'Gave up', shape: 'failed' } };

/** Settings › Webhooks. */
export function WebhooksPage({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const hooks = state.prefs.webhooks ?? [];
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [shown, setShown] = useState<{ readonly secret: string }>();
  const now = new Date();
  const save = (next: ReadonlyArray<Webhook>, note?: string) => dispatch({ type: 'prefs/set', prefs: { webhooks: next }, note });
  const open = hooks.find((h) => h.id === openId);
  return (
    <>
      {hooks.length >= MAX && <Callout tone="info">You have 10 endpoints, the most a workspace can have.</Callout>}
      <SettingsSection title="Endpoints" description="Send bookings, form submissions and signups to other apps as they happen."
        action={<Button variant="primary" icon={<Plus size={14} strokeWidth={1.75} />} isDisabled={hooks.length >= MAX} onPress={() => setAdding(true)}>Add endpoint</Button>}>
        {hooks.length === 0 ? <EmptyState size="sm" icon={<WebhookIcon size={20} strokeWidth={1.75} />} title="No endpoints yet" description="Add one to send events to Zapier, Make, n8n or your own server." />
          : <ul className="tf-set__list tf-set__list--center">{hooks.map((h) => { const last = h.log[0]; return (
            <li key={h.id}><button type="button" className="tf-set__open" onClick={() => setOpenId(h.id)}>
              <span className="tf-set__stack"><strong>{h.name || 'Endpoint'}</strong><span className="tf-rec__muted tf-wh__url">{h.url}</span><span className="tf-rec__muted">{h.events.map(eventLabel).join(', ')}</span></span>
              <span className="tf-set__stack tf-wh__state"><Tag size="sm" hue={!h.on && h.failing ? 'red' : h.on ? 'green' : 'gray'}>{!h.on && h.failing ? 'Off, failing' : h.on ? 'Active' : 'Off'}</Tag><span className="tf-rec__muted tf-num">{last ? relativeTime(last.at, now) : 'None yet'}</span></span>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button></li>); })}</ul>}
      </SettingsSection>
      {adding && <AddEndpoint onClose={() => setAdding(false)} onAdd={(h, s) => { save([...hooks, h], `${state.me} added the webhook ${h.name || h.url}`); setAdding(false); setShown({ secret: s }); }} />}
      {shown && <Dialog isOpen isDismissable={false} showClose={false} onOpenChange={() => undefined} title="Copy your signing secret" description="Copy it now, you won’t see it again. Your developer uses it to check events came from Timefix."
        actions={<Button variant="primary" onPress={() => setShown(undefined)}>Done</Button>}><CodeBlock code={shown.secret} copyLabel="Copy secret" /></Dialog>}
      {open && <EndpointDrawer hook={open} onClose={() => setOpenId(undefined)} onChange={(next, message) => { save(hooks.map((h) => (h.id === next.id ? next : h))); if (message) toast({ message, tone: 'success' }); }}
        onRotated={(s) => setShown({ secret: s })}
        onDelete={() => { save(hooks.filter((h) => h.id !== open.id), `${state.me} deleted the webhook ${open.name || open.url}`); setOpenId(undefined); toast({ message: 'Endpoint deleted' }); }} />}
    </>
  );
}

function AddEndpoint({ onClose, onAdd }: { readonly onClose: () => void; readonly onAdd: (h: Webhook, secret: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [events, setEvents] = useState<ReadonlySet<string>>(new Set(['booking.created']));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = urlProblem(url);
  const ok = url.trim().startsWith('https://') && events.size > 0;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add endpoint"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ok} isPending={busy} onPress={() => { setTried(true); if (problem) return; setBusy(true); window.setTimeout(() => { const s = secret(); onAdd({ id: newId('wh'), name: name.trim(), url: url.trim(), events: [...events], on: true, hint: s.slice(-4), at: new Date(), log: [] }, s); }, 500); }}>{busy ? 'Adding…' : 'Add'}</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Endpoint URL" value={url} onChange={(v) => { setUrl(v); setTried(false); }} placeholder="https://example.com/webhooks" autoFocus description="Starts with https://" isInvalid={tried && Boolean(problem)} errorMessage={tried ? problem : undefined} />
        <TextField label="Name" value={name} onChange={setName} placeholder="Zapier" />
        <ChoiceChips label="Events" selectionMode="multiple" items={WEBHOOK_EVENTS} selectedKeys={events} onSelectionChange={setEvents} />
      </div>
    </Dialog>
  );
}

/** One endpoint: on/off, the signing secret (rotate), a test event, its events, and the deliveries with Resend. */
function EndpointDrawer({ hook, onClose, onChange, onRotated, onDelete }: { readonly hook: Webhook; readonly onClose: () => void; readonly onChange: (h: Webhook, message?: string) => void; readonly onRotated: (secret: string) => void; readonly onDelete: () => void }) {
  const { toast } = useToast();
  const [ask, setAsk] = useState<'rotate' | 'delete'>();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<string>();
  const [more, setMore] = useState(false);
  const now = new Date();
  const until = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const send = () => { setTesting(true); window.setTimeout(() => { setTesting(false); const good = !hook.url.includes('fail'); setTest(good ? 'Delivered' : 'Failed, 500. The server refused it.');
    onChange({ ...hook, log: [{ id: newId('dl'), event: 'ping', status: good ? 'delivered' : 'failed', code: good ? 200 : 500, ms: 120 + Math.round(Math.random() * 200), attempt: 1, at: new Date(), why: good ? undefined : 'The server refused it.' }, ...hook.log] }); }, 700); };
  const resend = (id: string) => { const was = hook.log.find((x) => x.id === id); if (!was) return; const good = !hook.url.includes('fail');
    onChange({ ...hook, log: [{ ...was, id: newId('dl'), status: good ? 'delivered' : 'failed', code: good ? 200 : 500, attempt: was.attempt + 1, at: new Date(), why: good ? undefined : 'The server refused it.' }, ...hook.log] });
    toast(good ? { message: 'Sent again', tone: 'success' } : { message: 'Sent again, but it failed.', tone: 'danger' }); };
  const log = more ? hook.log : hook.log.slice(0, 25);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} width="lg" title={hook.name || 'Endpoint'} subtitle={hook.url}
      actions={<IconButton size="sm" label="Delete endpoint" onPress={() => setAsk('delete')}><Trash2 size={16} strokeWidth={1.75} /></IconButton>}>
      <div className="tf-set__sections">
        {hook.failing && <Callout tone="danger">Turned off after 3 days of failed deliveries. Fix the server, then turn it back on.</Callout>}
        <div className="tf-set__switch"><span><strong>Send events</strong><span className="tf-rec__muted">{hook.on ? 'On' : 'Off'}</span></span><Switch aria-label="Send events" isSelected={hook.on} onChange={(on) => onChange({ ...hook, on, failing: on ? false : hook.failing }, on ? 'Endpoint on' : 'Endpoint off')} /></div>
        <div className="tf-set__switch"><span><strong>Signing secret</strong><span className="tf-rec__muted tf-num">Ends in {hook.hint}{hook.oldUntil && hook.oldUntil > now ? `. The old secret works until ${until(hook.oldUntil)}` : ''}</span></span><Button variant="secondary" onPress={() => setAsk('rotate')}>Rotate</Button></div>
        <div className="tf-set__switch"><span><strong>Test event</strong><span className="tf-rec__muted">{test ?? 'Sends a ping to this endpoint now and shows the answer.'}</span></span><Button variant="secondary" isPending={testing} onPress={send}>{testing ? 'Sending…' : 'Send'}</Button></div>
        <ChoiceChips label="Events" selectionMode="multiple" items={WEBHOOK_EVENTS} selectedKeys={hook.events}
          onSelectionChange={(k) => { if (k.size === 0) { toast({ message: 'Keep at least one event, or turn the endpoint off.', tone: 'danger' }); return; } onChange({ ...hook, events: [...k] }); }} />
        <section className="tf-wh__log" aria-label="Deliveries">
          <h3 className="tf-wh__title">Deliveries</h3>
          {hook.log.length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="Nothing sent yet" description="Events show here as they’re sent. The log keeps 30 days." />
            : <ul className="tf-set__list tf-set__list--center">{log.map((d) => (
              <li key={d.id}><span className="tf-set__stack"><strong>{eventLabel(d.event)}</strong><span className="tf-rec__muted tf-num">{d.why ?? (d.code ? `${d.code} OK` : 'No answer yet')} · {d.ms ? `${d.ms} ms` : '—'} · attempt {d.attempt} · {relativeTime(d.at, now)}</span></span>
                <span className="tf-set__row tf-wh__end"><Tag size="sm" status={STATUS[d.status].shape}>{STATUS[d.status].label}</Tag>
                  {d.event !== 'ping' ? <Button size="sm" variant="ghost" icon={<RefreshCw size={14} strokeWidth={1.75} />} onPress={() => resend(d.id)}>Resend</Button> : <span className="tf-wh__nobtn" />}</span></li>))}</ul>}
          {hook.log.length > 25 && <Button size="sm" variant="ghost" onPress={() => setMore(!more)}>{more ? 'Show fewer' : 'Show more'}</Button>}
        </section>
      </div>
      {ask === 'rotate' && <ConfirmDialog isOpen onOpenChange={() => setAsk(undefined)} title="Rotate the signing secret?" tone="primary" confirmLabel="Rotate secret" consequence="The old secret keeps working for 24 hours."
        onConfirm={() => { setAsk(undefined); const s = secret(); onChange({ ...hook, hint: s.slice(-4), oldUntil: new Date(Date.now() + 86_400_000) }); onRotated(s); }} />}
      {ask === 'delete' && <ConfirmDialog isOpen onOpenChange={() => setAsk(undefined)} title="Delete this endpoint?" confirmLabel="Delete endpoint" consequence="It stops getting events, and its log goes with it." onConfirm={() => { setAsk(undefined); onDelete(); }} />}
    </Drawer>
  );
}

/** Settings › API keys: name, access, the key's end, last used; revoking is one click with Undo. */
export function ApiKeysPage({ state, dispatch, onNew }: { readonly state: AppState; readonly dispatch: Dispatch; readonly onNew: () => void }) {
  const { toast } = useToast();
  const keys = state.prefs.apiKeys; const now = new Date();
  return (
    <SettingsSection title="API keys" description="For your own scripts and tools. A key acts as you could, so keep it secret."
      footnote={<Link href="https://timefix.com/api/v1/openapi.json" isExternal>API reference</Link>}
      action={<Button variant="primary" onPress={onNew}>Create key</Button>}>
      {keys.length === 0 ? <EmptyState size="sm" icon={<Code2 size={20} strokeWidth={1.75} />} title="No API keys yet" description="A key lets your own tools read and change records, as you could." /> : (
        <ul className="tf-set__list tf-set__list--center">{keys.map((k, n) => <li key={k.id}><span className="tf-set__stack"><strong>{k.name}</strong><span className="tf-rec__muted tf-num">{k.scope === 'read' ? 'Read' : 'Read and write'} · crm_…{k.last4} · last used {k.used ? relativeTime(k.used, now).toLowerCase() : 'never'}</span></span>
          <IconButton size="sm" label={`Revoke ${k.name}`} onPress={() => { dispatch({ type: 'prefs/set', prefs: { apiKeys: keys.filter((x) => x.id !== k.id) }, note: `${state.me} revoked the API key ${k.name}` });
            toast({ message: `${k.name} revoked`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'prefs/update', fn: (q) => ({ apiKeys: [...q.apiKeys.slice(0, n), k, ...q.apiKeys.slice(n)] }) }); toast({ message: `${k.name} is back`, tone: 'success' }); } } }); }}><Trash2 size={16} strokeWidth={1.75} /></IconButton></li>)}</ul>)}
    </SettingsSection>
  );
}

const JOB_STATUS: Readonly<Record<BulkJob['status'], { readonly label: string; readonly shape: 'draft' | 'progress' | 'review' | 'done' | 'failed' | 'waiting' }>> = {
  preparing: { label: 'Preparing', shape: 'draft' }, confirm: { label: 'Needs confirm', shape: 'review' }, running: { label: 'Running', shape: 'progress' }, cancelling: { label: 'Cancelling', shape: 'progress' },
  done: { label: 'Done', shape: 'done' }, cancelled: { label: 'Cancelled', shape: 'failed' }, failed: { label: 'Failed', shape: 'failed' },
};
const records = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'record' : 'records'}`;

/** Background jobs: bulk changes counted first, then waiting for Review, then run in batches with progress; Cancel asks; members see only their own. */
export function BackgroundJobs({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const all = state.prefs.bulkJobs ?? [];
  const mineOnly = state.previewRole === 'Member';
  const jobs = mineOnly ? all.filter((j) => j.by === state.me) : all;
  const [review, setReview] = useState<BulkJob>();
  const [cancel, setCancel] = useState<BulkJob>();
  const patch = (id: string, p: Partial<BulkJob>) => dispatch({ type: 'prefs/update', fn: (q) => ({ bulkJobs: (q.bulkJobs ?? []).map((j) => (j.id === id ? { ...j, ...p } : j)) }) });
  const live = all.filter((j) => j.status === 'preparing' || j.status === 'running' || j.status === 'cancelling').map((j) => `${j.id}:${j.status}:${j.done}`).join();
  // The work itself: counting, then batches of 250 every 600ms; cancelling stops after the batch.
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const j of state.prefs.bulkJobs ?? []) {
        if (j.status === 'preparing') patch(j.id, { status: 'confirm' });
        if (j.status === 'cancelling') { patch(j.id, { status: 'cancelled', finished: new Date() }); toast({ message: `${j.what ?? 'Job'}: Cancelled` }); }
        if (j.status === 'running') { const done = Math.min(j.total, j.done + 250); patch(j.id, done >= j.total ? { done, status: 'done', finished: new Date() } : { done }); if (done >= j.total) toast({ message: `${j.what ?? 'Job'}: Done`, tone: 'success' }); }
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (d?: Date) => (d ? `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Not yet');
  const start = () => { const total = state.people.length * 250; const j: BulkJob = { id: newId('bj'), kind: 'edit', object: 'people', total, done: 0, by: state.me, at: new Date(), status: 'preparing', what: 'Test job: count people, change nothing' };
    dispatch({ type: 'prefs/update', fn: (q) => ({ bulkJobs: [j, ...(q.bulkJobs ?? [])] }) }); };
  return (
    <SettingsSection title="Background jobs" status={mineOnly ? <Tag size="sm">Only yours</Tag> : undefined} description="Big changes run here, in batches, so you can keep working. Over 500 records waits for your OK first."
      action={<Button variant="secondary" onPress={start}>Run a test job</Button>}>
      {jobs.length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="No background jobs yet" /> : <ul className="tf-set__list tf-set__list--center">{jobs.map((j) => (
        <li key={j.id} className="tf-wh__job">
          <span className="tf-set__stack"><strong>{j.what ?? 'Bulk change'}</strong>
            <span className="tf-rec__muted tf-num">{mineOnly ? '' : `${j.by} · `}Started {when(j.status === 'preparing' || j.status === 'confirm' ? undefined : j.at)}{j.finished ? ` · finished ${when(j.finished)}` : ''}{j.refused ? ` · ${j.refused} refused` : ''}</span>
            {(j.status === 'running' || j.status === 'cancelling' || j.status === 'confirm') && <ProgressBar size="sm" aria-label={`${j.what ?? 'Job'} progress`} value={j.status === 'confirm' ? 0 : j.done} maxValue={j.total} />}
            <span className="tf-rec__muted tf-num">{j.status === 'preparing' ? 'Counting…' : j.status === 'confirm' ? `${records(j.total)} counted. Waits for Review.` : j.status === 'cancelling' ? 'Stopping after this batch…' : `${j.done.toLocaleString('en-IN')} of ${j.total.toLocaleString('en-IN')}`}</span></span>
          <span className="tf-set__row tf-wh__end">
            <Tag size="sm" status={JOB_STATUS[j.status].shape}>{JOB_STATUS[j.status].label}</Tag>
            {j.status === 'preparing' && <InfoTip label="About preparing">Counting records. Nothing has changed yet.</InfoTip>}
            {j.status === 'confirm' && <Button size="sm" variant="primary" onPress={() => setReview(j)}>Review</Button>}
            {(j.status === 'confirm' || j.status === 'running' || j.status === 'preparing') && <Button size="sm" variant="ghost" onPress={() => setCancel(j)}>Cancel</Button>}
          </span></li>))}</ul>}
      {review && <ConfirmDialog isOpen onOpenChange={() => setReview(undefined)} tone="primary" cancelLabel="Not now" title={review.kind === 'delete' ? `Delete ${records(review.total)}?` : `Run “${review.what ?? 'job'}”?`}
        consequence={review.kind === 'delete' ? 'They stay in the trash for 30 days.' : `It runs on the ${review.total.toLocaleString('en-IN')} items it counted.`} confirmLabel="Run job"
        onConfirm={() => { patch(review.id, { status: 'running', at: new Date() }); setReview(undefined); }} />}
      {cancel && <ConfirmDialog isOpen onOpenChange={() => setCancel(undefined)} cancelLabel="Keep job" title={`Cancel “${cancel.what ?? 'job'}”?`} confirmLabel="Cancel job"
        consequence={`It stops after this batch. Done work stays.${cancel.by !== state.me ? ` ${cancel.by} started it.` : ''}`} onConfirm={() => { patch(cancel.id, { status: cancel.status === 'running' ? 'cancelling' : 'cancelled', finished: cancel.status === 'running' ? undefined : new Date() }); setCancel(undefined); }} />}
    </SettingsSection>
  );
}
