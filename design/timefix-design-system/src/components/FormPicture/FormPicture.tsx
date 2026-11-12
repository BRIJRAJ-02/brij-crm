import { Link } from 'react-aria-components';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Lock, Monitor, Smartphone } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { HostedForm, QuestionInput, type FormQuestion, type HostedFormProps } from '../HostedForm/HostedForm.tsx';
import './FormPicture.css';

/** Where a form stands: being written, taking answers, or no longer taking them. */
export type FormStatus = 'draft' | 'live' | 'closed';

const STATUS = {
  draft: { label: 'Not published', hue: 'gray', shape: 'draft' },
  live: { label: 'Live', hue: 'green', shape: 'done' },
  closed: { label: 'Paused', hue: 'gray', shape: 'failed' },
} as const;

/** A form's status as the shared Tag: a dashed circle for Draft, a green check for Live, a crossed circle for Closed. */
export function FormStatusTag({ status }: { readonly status: FormStatus }) {
  const s = STATUS[status];
  return <Tag size="sm" hue={s.hue} status={s.shape}>{s.label}</Tag>;
}

const noop = () => undefined;

/** A form in miniature, drawn with the real guest controls at half size: its first telling question and its button. Decorative. */
export function FormPicture({ title, questions }: { readonly title: string; readonly questions: ReadonlyArray<FormQuestion> }) {
  const q = questions.find((x) => x.kind === 'choice' || x.kind === 'multi' || x.kind === 'rating') ?? questions[0];
  return (
    <div className="tf-fpic" aria-hidden="true" inert>
      <div className="tf-fpic__stage">
        <div className="tf-fpic__sheet">
          <p className="tf-fpic__name">{title}</p>
          {q && (
            <>
              <p className="tf-fpic__q">{q.title}</p>
              <QuestionInput question={{ ...q, options: q.options?.slice(0, 3) }} value={q.kind === 'multi' ? q.options?.slice(0, 1) : q.kind === 'rating' ? 4 : q.options?.[0]} onChange={noop} labelId="" />
            </>
          )}
          <span className="tf-fpic__btn"><Button variant="primary" size="lg">OK</Button></span>
        </div>
      </div>
    </div>
  );
}

/** Props for FormCard. */
export interface FormCardProps {
  readonly name: string;
  readonly status: FormStatus;
  readonly responses: number;
  /** "Edited 2h ago". */
  readonly updated?: string;
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly href?: string;
  readonly onPress?: () => void;
  /** A mark beside the count, like "2 new" since the owner last looked. */
  readonly badge?: ReactNode;
  /** The card's ⋯ menu (Open, Copy link, Pause, Duplicate, Delete); it sits above the card's own press. */
  readonly menu?: ReactNode;
}

/** A form on the forms list: its picture, name, status and a response count whose digits roll as answers arrive. The whole card opens the form; the ⋯ menu sits above it. */
export function FormCard({ name, status, responses, updated, questions, href, onPress, badge, menu }: FormCardProps) {
  return (
    <article className="tf-fcard">
      <FormPicture title={name} questions={questions} />
      <span className="tf-fcard__body">
        <span className="tf-fcard__text">
          {/* The name is the card's one link; its hit area stretches over the whole card. */}
          <Link className="tf-fcard__name" href={href} onPress={onPress}>{name}</Link>
          <span className="tf-fcard__sub">
            <span className="tf-num"><NumberRoll value={responses} /></span> {responses === 1 ? 'response' : 'responses'}{badge}{updated ? ` · ${updated}` : ''}
          </span>
        </span>
        <span className="tf-fcard__end"><FormStatusTag status={status} />{menu}</span>
      </span>
    </article>
  );
}

const DEVICES = { desktop: { width: 960, height: 640 }, phone: { width: 390, height: 720 } } as const;
/** The device a preview shows a form on. */
export type PreviewDevice = keyof typeof DEVICES;

/** Props for HostedFormPreview: the live form's own props plus the device and the address shown in the frame. */
export interface HostedFormPreviewProps extends HostedFormProps {
  readonly device?: PreviewDevice;
  readonly defaultDevice?: PreviewDevice;
  readonly onDeviceChange?: (device: PreviewDevice) => void;
  /** The address in the browser frame ("timefix.com/f/acme-intake"). */
  readonly address?: string;
  /** Something in the preview's bar before the device switch: the form's Look button. */
  readonly barAction?: ReactNode;
  /** False leaves out the bar (the Preview label, `barAction` and the device switch), for a page that has its own: pass `device` then. */
  readonly showBar?: boolean;
}

/**
 * The builder's live preview: the real HostedForm inside a browser or phone frame, laid out at the device's width and scaled to
 * fit the column. Switching device eases the frame to its new size (01 card resize) and the form fades in softly (34).
 */
export function HostedFormPreview({ device, defaultDevice = 'desktop', onDeviceChange, address = 'timefix.com/f/form', barAction, showBar = true, ...form }: HostedFormPreviewProps) {
  const [own, setOwn] = useState<PreviewDevice>(defaultDevice);
  const current = device ?? own;
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number>(DEVICES.desktop.width);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    setRoom(el.clientWidth);
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = DEVICES[current];
  // The phone's bezel takes 8px a side; the browser frame only its hairline.
  const scale = Math.min(1, (room - (current === 'phone' ? 18 : 2)) / size.width);
  const pick = (k: string) => { const d: PreviewDevice = k === 'phone' ? 'phone' : 'desktop'; setOwn(d); onDeviceChange?.(d); };
  return (
    <section className="tf-fprev" aria-label="Preview">
      {showBar && (
        <header className="tf-fprev__bar">
          <span className="tf-fprev__label">Preview</span>
          <span className="tf-fprev__end">{barAction}
          <SegmentedControl aria-label="Device" size="sm" selectedKey={current} onSelectionChange={pick} items={[
            { id: 'desktop', icon: <Monitor size={14} strokeWidth={1.75} />, ariaLabel: 'Desktop' },
            { id: 'phone', icon: <Smartphone size={14} strokeWidth={1.75} />, ariaLabel: 'Phone' },
          ]} /></span>
        </header>
      )}
      <div ref={box} className="tf-fprev__room">
        <div className={cx('tf-fprev__frame', `tf-fprev__frame--${current}`)}>
          {current === 'desktop' && (
            <div className="tf-fprev__chrome" aria-hidden="true">
              <span className="tf-fprev__dots"><i /><i /><i /></span>
              <span className="tf-fprev__url"><Lock size={12} strokeWidth={1.75} />{address}</span>
            </div>
          )}
          <div className="tf-fprev__viewport" style={{ width: size.width * scale, height: size.height * scale }}>
            <div key={current} className="tf-fprev__screen" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
              <HostedForm {...form} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
