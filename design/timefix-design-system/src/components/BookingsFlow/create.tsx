// Steps 2 and 3: the Create sheet (three questions beside the guest's view), then "Your page is live".
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay, Radio as AriaRadio, RadioGroup as AriaRadioGroup, Label, Button as AriaButton } from 'react-aria-components';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Check, Code2, Eye, EyeOff, LayoutList, Mail, MapPin, Phone, Play, Video, Webcam } from 'lucide-react';
import { TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { HoursEditor, summarizeHours } from '../HoursEditor/HoursEditor.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Button } from '../Button/Button.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { cx } from '../../lib/cx.ts';
import { CopyButton, Eyebrow, GuestView, ScaledPreview, SlidePages, i14, i16, noBook } from './parts.tsx';
import { newPage, uniqueSlug } from './seed.ts';
import { PLACES, PLACE_ORDER, hoursFor, lengthOf, pageUrl, placeOf, slugify, type BookingPage, type BookingsState, type PlaceKind } from './state.ts';

const DURATIONS = ['15', '30', '45', '60'];
const PLACE_ICON: Readonly<Record<PlaceKind, typeof Video>> = { meet: Video, zoom: Webcam, phone: Phone, 'in-person': MapPin };
/** BookingFlow's phone layout width (its own breakpoint is 864px): the preview draws it here, then scales to the column. */
const PHONE_WIDTH = 400;

/** Where: four compact tiles in a 2 × 2 grid (icon well and label; the chosen one gets an accent edge and a check badge). */
export function PlaceTiles({ value, onChange }: { readonly value: PlaceKind; readonly onChange: (k: PlaceKind) => void }) {
  return (
    <AriaRadioGroup value={value} onChange={(v) => onChange(v as PlaceKind)} className="tf-bkf-tiles" orientation="horizontal">
      <Label className="tf-bkf__label">Where</Label>
      <div className="tf-bkf-tiles__grid">
        {PLACE_ORDER.map((k) => {
          const Icon = PLACE_ICON[k];
          return (
            <AriaRadio key={k} value={k} className="tf-bkf-tile">
              <span className="tf-bkf-tile__icon" aria-hidden="true"><Icon {...i16} /></span>
              <span className="tf-bkf-tile__label">{k === 'in-person' ? 'In person' : PLACES[k].label}</span>
              <span className="tf-bkf-tile__badge" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </AriaRadio>
          );
        })}
      </div>
    </AriaRadioGroup>
  );
}

/** Props for CreateSheet. */
export interface CreateSheetProps {
  readonly isOpen: boolean;
  readonly state: BookingsState;
  readonly onCreate: (page: BookingPage) => void;
  /** Done, Cancel or Esc. `created` is the new page's id once made. */
  readonly onClose: (created?: string) => void;
  readonly onAfter: (page: BookingPage, what: 'guest' | 'website' | 'email' | 'linkpage') => void;
  /** The same connect as Availability's. */
  readonly onConnect: () => Promise<void>;
}

/** One sheet, three questions beside a readable guest preview; then "Your page is live" slides in (08 page side-by-side). */
export function CreateSheet({ isOpen, state, onCreate, onClose, onAfter, onConnect }: CreateSheetProps) {
  const [draft, setDraft] = useState<BookingPage>(() => newPage(state.pages));
  const [step, setStep] = useState<0 | 1>(0);
  const [custom, setCustom] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    // A fresh sheet every time it opens.
    setDraft(newPage(state.pages)); setStep(0); setCustom(false); setNameTouched(false); setSlugTouched(false); setHoursOpen(false); setConnecting(false); setShowPreview(false);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== 1) return undefined;
    const t = window.setTimeout(() => liveRef.current?.querySelector<HTMLElement>('button')?.focus(), 260);
    return () => window.clearTimeout(t);
  }, [step]);

  const set = (patch: Partial<BookingPage>) => setDraft((d) => ({ ...d, ...patch }));
  const length = lengthOf(draft);
  const place = placeOf(draft);
  const taken = state.pages.some((p) => p.slug === draft.slug);
  const setName = (name: string) => {
    setNameTouched(true);
    set({ name, ...(slugTouched ? {} : { slug: uniqueSlug(slugify(name), state.pages) }) });
  };
  const setLength = (n: number) => set({ durations: [n], ...(nameTouched ? {} : { name: `${n} min meeting`, ...(slugTouched ? {} : { slug: uniqueSlug(`${n}-min-meeting`, state.pages) }) }) });
  const canCreate = draft.name.trim() !== '' && draft.slug !== '' && !taken;
  const create = () => { if (step === 0 && canCreate) { onCreate(draft); setStep(1); } };
  const close = () => onClose(step === 1 ? draft.id : undefined);
  const keys = (e: KeyboardEvent<HTMLElement>) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (step === 0) create(); else close(); } };
  const hours = hoursFor(draft, state);
  const url = pageUrl(draft.slug);

  const preview = (
    <aside className="tf-bkf-sheet__aside" data-shown={showPreview || undefined} aria-label="What guests see">
      <Eyebrow>What guests see</Eyebrow>
      <div className="tf-bkf-sheet__preview">
        <div className="tf-bkf__soft" key={`${length}-${place}`}>
          <ScaledPreview label="Booking page preview" designWidth={PHONE_WIDTH}>
            <GuestView page={draft} state={state} onBook={noBook} />
          </ScaledPreview>
        </div>
      </div>
    </aside>
  );

  const form = (
    <div className="tf-bkf-sheet__grid">
      <div className="tf-bkf-sheet__form">
        <div className="tf-bkf__group">
          <TextField label="Name" size="lg" value={draft.name} autoFocus onFocus={(e) => (e.target as HTMLInputElement).select()} onChange={setName} isRequired />
          <TextField label="Link" value={draft.slug} className="tf-bkf__linkinput"
            icon={<span className="tf-bkf__prefix">timefix.com/priya/</span>}
            onChange={(v) => { setSlugTouched(true); set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') }); }}
            isInvalid={taken} errorMessage="Another page has this link. Try another."
            suffix={draft.slug && !taken ? <span className="tf-bkf__ok-word"><Check size={14} strokeWidth={2} aria-hidden="true" />Available</span> : undefined} />
        </div>
        <div className="tf-bkf__group">
          <span className="tf-bkf__label" aria-hidden="true">Duration</span>
          <SegmentedControl aria-label="Duration" isFullWidth selectedKey={custom ? 'custom' : String(length)}
            items={[...DURATIONS.map((d) => ({ id: d, label: `${d} min` })), { id: 'custom', label: 'Custom' }]}
            onSelectionChange={(k) => { if (k === 'custom') { setCustom(true); if (DURATIONS.includes(String(length))) setLength(90); } else { setCustom(false); setLength(Number(k)); } }} />
          <div className="tf-bkf__reveal tf-bkf__reveal--tight" data-open={custom || undefined}>
            <div className="tf-bkf__reveal-clip" inert={!custom}>
              <NumberField label="Minutes" value={length} minValue={5} maxValue={480} step={5} unit="min" onChange={(n) => { if (Number.isFinite(n) && n > 0) setLength(n); }} />
            </div>
          </div>
        </div>
        <div className="tf-bkf__group">
          <PlaceTiles value={place} onChange={(k) => set({ places: [k] })} />
          <div className="tf-bkf__reveal tf-bkf__reveal--tight" data-open={place === 'in-person' || undefined}>
            <div className="tf-bkf__reveal-clip" inert={place !== 'in-person'}>
              <TextField label="Address" value={draft.address} onChange={(address) => set({ address })} placeholder="12 Harbour Street, Mumbai" icon={<MapPin {...i16} />} />
            </div>
          </div>
          <div className="tf-bkf__reveal tf-bkf__reveal--tight" data-open={place === 'phone' || undefined}>
            <div className="tf-bkf__reveal-clip" inert={place !== 'phone'}>
              <SegmentedControl aria-label="Who calls" size="sm" isFullWidth selectedKey={draft.phoneWho} onSelectionChange={(k) => set({ phoneWho: k === 'guest' ? 'guest' : 'host' })}
                items={[{ id: 'host', label: 'You call them' }, { id: 'guest', label: 'They call you' }]} />
            </div>
          </div>
        </div>
        <div className="tf-bkf__group">
          <span className="tf-bkf__label">When</span>
          <div className="tf-bkf-when">
            <div className="tf-bkf-when__row">
              <span className="tf-bkf-when__icon" aria-hidden="true"><CalendarDays {...i16} /></span>
              <span className="tf-bkf-when__text">
                <span className="tf-bkf-when__title tf-num">{summarizeHours(hours).replace(/ – (?=[A-Z][a-z]{2},)/, '–').replace(', ', ' · ')}</span>
                <span className="tf-bkf-when__sub">India time · {draft.hoursFrom === 'custom' ? 'hours for this page' : 'your working hours'}</span>
              </span>
              <Button size="sm" variant="ghost" aria-expanded={hoursOpen} onPress={() => setHoursOpen((o) => !o)}>
                <TextSwap swapKey={hoursOpen ? 'done' : 'change'}>{hoursOpen ? 'Done' : 'Change'}</TextSwap>
              </Button>
            </div>
            <div className="tf-bkf__reveal tf-bkf__reveal--tight" data-open={hoursOpen || undefined}>
              <div className="tf-bkf__reveal-clip" inert={!hoursOpen}>
                <HoursEditor value={hours} onChange={(h) => set({ hoursFrom: 'custom', customHours: h })} />
              </div>
            </div>
          </div>
          {state.calendars.length === 0 && (
            <Callout tone="neutral" action={{ label: connecting ? 'Connecting…' : 'Connect', onPress: () => { if (connecting) return; setConnecting(true); void onConnect(); } }}>
              Connect a calendar so guests never book over your meetings.
            </Callout>
          )}
        </div>
      </div>
      {preview}
    </div>
  );

  const live = (
    <div className="tf-bkf-sheet__grid">
      <div className="tf-bkf-sheet__form" ref={liveRef}>
        <p className="tf-bkf__live-lede"><span className="tf-bkf__live-check" aria-hidden="true">{step === 1 && <SuccessCheck size={16} />}</span><span>Guests can book <strong>{draft.name}</strong> now.</span></p>
        <div className="tf-bkf__linkrow">
          <TextField label="Your link" value={`https://${url}`} isReadOnly className="tf-bkf__linkfield" onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <CopyButton value={`https://${url}`} />
        </div>
        <div className="tf-bkf__group">
          <span className="tf-bkf__label">Or share it another way</span>
          <div className="tf-bkf__ways">
            <Button variant="secondary" icon={<Mail {...i14} />} onPress={() => onAfter(draft, 'email')}>Email it</Button>
            <Button variant="secondary" icon={<Code2 {...i14} />} onPress={() => onAfter(draft, 'website')}>Add to website</Button>
            <Button variant="secondary" icon={<LayoutList {...i14} />} onPress={() => onAfter(draft, 'linkpage')}>Add to link page</Button>
          </div>
        </div>
        <AriaButton className="tf-bkf__textbtn tf-bkf__guestlink" onPress={() => onAfter(draft, 'guest')}><Play {...i14} aria-hidden="true" />See it as a guest</AriaButton>
      </div>
      {preview}
    </div>
  );

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(o) => { if (!o) close(); }} isDismissable className="tf-bkf-scrim tf-overlay">
      <Modal className="tf-bkf-sheet">
        <AriaDialog className="tf-bkf-sheet__dialog" aria-label={step === 0 ? 'New booking page' : 'Your page is live'}>
          <div className="tf-bkf-sheet__inner" onKeyDown={keys}>
          <header className="tf-bkf-sheet__head">
            <div className="tf-bkf-sheet__titles">
              <Heading slot="title" className="tf-bkf-sheet__title"><TextSwap swapKey={String(step)}>{step === 0 ? 'New booking page' : 'Your page is live'}</TextSwap></Heading>
              <p className="tf-bkf-sheet__desc">{step === 0 ? 'You can change everything later.' : 'Share the link anywhere. Changes you make later show up at once.'}</p>
            </div>
            <Button size="sm" variant="ghost" className="tf-bkf-sheet__toggle" icon={showPreview ? <EyeOff {...i14} /> : <Eye {...i14} />} aria-pressed={showPreview} onPress={() => setShowPreview((v) => !v)}>Preview</Button>
          </header>
          <div className="tf-bkf-sheet__body">
            <SlidePages step={step} pages={[<div key="create">{form}</div>, <div key="live">{live}</div>]} />
          </div>
          <footer className={cx('tf-bkf-sheet__foot')}>
            {step === 0 ? (
              <>
                <Button variant="ghost" slot="close">Cancel</Button>
                <Button variant="primary" isDisabled={!canCreate} onPress={create} aria-keyshortcuts="Meta+Enter" iconEnd={<span className="tf-bkf__kbd"><Kbd>⌘↵</Kbd></span>}>Create page</Button>
              </>
            ) : <Button variant="primary" onPress={close}>Done</Button>}
          </footer>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
