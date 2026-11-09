// Step 4, Share: Offer specific times, One-time links and Embed, each a short dialog over the page.
import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmbedPreview } from '../EmbedPreview/EmbedPreview.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';
import { formatDate, formatDay } from '../../lib/format.ts';
import { useToast } from '../Toast/Toast.tsx';
import { CopyButton, i14 } from './parts.tsx';
import { dayFrom, hoursFor, isoDay, lengthOf, lengthsText, nextId, openTimes, pageUrl, parseDay, plural, type BookingPage, type BookingsState, type OneTimeLink } from './state.ts';

/** Which share dialog is open. */
export type ShareDialogKind = 'times' | 'once' | 'embed';

/** Props for ShareDialogs. */
export interface ShareDialogsProps {
  readonly kind: ShareDialogKind | undefined;
  readonly page: BookingPage | undefined;
  readonly state: BookingsState;
  readonly onUpdate: (page: BookingPage) => void;
  readonly onClose: () => void;
}

/** The three share dialogs; one shows at a time. */
export function ShareDialogs({ kind, page, state, onUpdate, onClose }: ShareDialogsProps) {
  return (
    <>
      <OfferTimesDialog isOpen={kind === 'times' && page !== undefined} page={page} state={state} onUpdate={onUpdate} onClose={onClose} />
      <OneTimeLinksDialog isOpen={kind === 'once' && page !== undefined} page={page} onUpdate={onUpdate} onClose={onClose} />
      {page && (
        <Dialog isOpen={kind === 'embed'} onOpenChange={(o) => { if (!o) onClose(); }} size="wide" title="Embed on a website" description={`Show ${page.name} on your own site. Pick how, then paste the code.`}
          actions={<Button variant="secondary" slot="close">Done</Button>}>
          <EmbedPreview page={{ host: page.owner, title: page.name, duration: lengthsText(page), openDays: HOURS_DAYS.map((d) => hoursFor(page, state)[d].on), hue: page.accent }}
            url={`https://${pageUrl(page.slug)}`} accent={page.look.accent} site="northwind.com/contact" />
        </Dialog>
      )}
    </>
  );
}

/** Offer specific times: pick 2 to 5 open times, get a link that offers only those. */
function OfferTimesDialog({ isOpen, page, state, onUpdate, onClose }: { readonly isOpen: boolean; readonly page: BookingPage | undefined; readonly state: BookingsState; readonly onUpdate: (p: BookingPage) => void; readonly onClose: () => void }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [made, setMade] = useState<string>();
  useEffect(() => { if (isOpen) { setPicked(new Set()); setMade(undefined); } }, [isOpen]);
  const options = useMemo(() => {
    if (!page) return [];
    const now = new Date();
    const out: Array<{ id: string; label: string; day: string; start: number }> = [];
    for (let n = 0; n < 21 && out.length < 12; n += 1) {
      const d = dayFrom(now, n);
      openTimes(page, state, d, now).filter((_, k) => k % 3 === 0).slice(0, 3).forEach((m) => {
        if (out.length < 12) out.push({ id: `${isoDay(d)}T${m}`, label: `${formatDay(d)} · ${formatClockRange(m, m + lengthOf(page))}`, day: isoDay(d), start: m });
      });
    }
    return out;
  }, [page, state]);
  const full = picked.size >= 5;
  const create = () => {
    if (!page) return;
    const id = nextId('off');
    const slots = options.filter((o) => picked.has(o.id)).map((o) => ({ day: o.day, start: o.start }));
    onUpdate({ ...page, offers: [...page.offers, { id, slots, created: isoDay(new Date()) }] });
    setMade(`https://${pageUrl(page.slug)}/t/${id.slice(-6)}`);
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} size="md" title="Offer specific times"
      description={made ? 'Paste this link into your email. It offers only the times you picked.' : `Pick 2 to 5 times for ${page?.name ?? 'this page'}. The guest books one with a click.`}
      actions={made ? <Button variant="secondary" slot="close">Done</Button> : <>
        <Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={picked.size < 2} onPress={create}>{picked.size >= 2 ? `Create link with ${picked.size} times` : 'Create link'}</Button>
      </>}>
      {made ? (
        <div className="tf-bkf__linkrow">
          <TextField label="Link" value={made} isReadOnly className="tf-bkf__linkfield" onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <CopyButton value={made} />
        </div>
      ) : options.length === 0 ? (
        <p className="tf-bkf__muted">No open times in the next three weeks. Change the page's hours under When.</p>
      ) : (
        <div className="tf-bkf__stack tf-bkf__stack--8">
          <ChoiceChips label="Open times" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={picked} onSelectionChange={setPicked}
            items={options.map((o) => ({ id: o.id, label: o.label, isDisabled: full && !picked.has(o.id) }))} />
          <p className="tf-bkf__muted tf-num" aria-live="polite">{picked.size} of 5 picked{page && page.offers.length ? ` · ${plural(page.offers.length, 'offer')} already sent` : ''}</p>
        </div>
      )}
    </Dialog>
  );
}

const EXPIRY = [{ id: '7', label: 'In a week' }, { id: '14', label: 'In two weeks' }, { id: '30', label: 'In 30 days' }, { id: '365', label: 'In a year' }];

/** One-time links: make one (label, how many bookings, expiry) and see the list with Revoke. */
function OneTimeLinksDialog({ isOpen, page, onUpdate, onClose }: { readonly isOpen: boolean; readonly page: BookingPage | undefined; readonly onUpdate: (p: BookingPage) => void; readonly onClose: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState(1);
  const [expiry, setExpiry] = useState('7');
  const [fresh, setFresh] = useState<string>();
  const [revoking, setRevoking] = useState<OneTimeLink>();
  useEffect(() => { if (isOpen) { setLabel(''); setUses(1); setExpiry('7'); setFresh(undefined); } }, [isOpen]);
  if (!page) return null;
  const linkUrl = (l: OneTimeLink) => `https://${pageUrl(page.slug)}/o/${l.id.slice(-6)}`;
  const create = () => {
    const link: OneTimeLink = { id: nextId('otl'), label: label.trim() || 'One-time link', uses, used: 0, expires: isoDay(dayFrom(new Date(), Number(expiry))), revoked: false };
    onUpdate({ ...page, links: [link, ...page.links] });
    setFresh(link.id);
    setLabel('');
    void navigator.clipboard?.writeText(linkUrl(link)).catch(() => undefined);
    toast({ message: 'Link created and copied', tone: 'success' });
  };
  const today = isoDay(new Date());
  return (
    <>
      <Dialog isOpen={isOpen && !revoking} onOpenChange={(o) => { if (!o) onClose(); }} size="md" title="One-time links" description={`Links to ${page.name} that work a set number of times, then stop.`}
        actions={<Button variant="secondary" slot="close">Done</Button>}>
        <div className="tf-bkf__stack">
          <div className="tf-bkf__otl-form">
            <TextField label="Who it's for" value={label} onChange={setLabel} placeholder="For Liam at Acme" />
            <NumberField label="Bookings" value={uses} minValue={1} maxValue={10} onChange={(n) => { if (Number.isFinite(n)) setUses(n); }} />
            <Select label="Stops working" items={EXPIRY} value={expiry} onChange={(v) => { if (v) setExpiry(v); }} />
            <Button variant="primary" icon={<Plus {...i14} />} onPress={create}>Create link</Button>
          </div>
          {page.links.length === 0 ? <p className="tf-bkf__muted">No one-time links yet.</p> : (
            <ul className="tf-bkf__list-plain" aria-label="One-time links">
              {page.links.map((l) => {
                const expired = l.expires < today;
                const done = l.revoked || expired || l.used >= l.uses;
                return (
                  <li key={l.id} className={l.id === fresh ? 'tf-bkf__otl is-new' : 'tf-bkf__otl'}>
                    <Link2 {...i14} aria-hidden="true" />
                    <span className="tf-bkf__otl-text">
                      <span className="tf-bkf__otl-label">{l.label}</span>
                      <span className="tf-bkf__muted tf-num">{l.used} of {plural(l.uses, 'booking')} used · {expired ? 'ended' : 'until'} {formatDate(parseDay(l.expires))}</span>
                    </span>
                    {l.revoked ? <Tag size="sm" status="failed">Revoked</Tag> : done ? <Tag size="sm" status="waiting">Ended</Tag> : <>
                      <CopyButton value={linkUrl(l)} label="Copy" variant="ghost" size="sm" />
                      <Button size="sm" variant="ghost" onPress={() => setRevoking(l)}>Revoke</Button>
                    </>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>
      <ConfirmDialog isOpen={revoking !== undefined} onOpenChange={(o) => { if (!o) setRevoking(undefined); }} title={`Revoke “${revoking?.label ?? ''}”?`}
        consequence="The link stops working at once. Meetings already booked through it stay booked." confirmLabel="Revoke link"
        onConfirm={() => { if (revoking) onUpdate({ ...page, links: page.links.map((l) => (l.id === revoking.id ? { ...l, revoked: true } : l)) }); setRevoking(undefined); }} />
    </>
  );
}
