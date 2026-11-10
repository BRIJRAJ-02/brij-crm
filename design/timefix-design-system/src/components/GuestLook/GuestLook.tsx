import { useEffect, useState, type CSSProperties } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { TileGrid } from '../Card/Card.tsx';
import { AccentPicker, contrastOnWhiteText } from '../ColorPicker/ColorPicker.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { SoftText } from '../Motion/Motion.tsx';
import './GuestLook.css';

/** The faces a guest page can wear. */
export type GuestFont = 'sans' | 'mono';
/** One of the four looks, or Custom once anything is changed by hand. */
export type GuestLookId = 'calm' | 'ink' | 'slate' | 'night' | 'custom';

/** What the guest pages wear: a look, its accent, face and light or dark. */
export interface GuestLookValue {
  readonly look: GuestLookId;
  /** "#RRGGBB". */
  readonly accent: string;
  readonly font: GuestFont;
  readonly scheme: 'light' | 'dark';
}

/** The four looks, simple and familiar; Custom is whatever the owner made. */
export const GUEST_LOOKS: ReadonlyArray<{ readonly id: Exclude<GuestLookId, 'custom'>; readonly title: string; readonly description: string; readonly value: Omit<GuestLookValue, 'look'> }> = [
  { id: 'calm', title: 'Calm', description: 'Light, Timefix blue', value: { accent: '#1F5FD6', font: 'sans', scheme: 'light' } },
  { id: 'ink', title: 'Ink', description: 'Light, black and mono', value: { accent: '#111111', font: 'mono', scheme: 'light' } },
  { id: 'slate', title: 'Slate', description: 'Light, deep teal', value: { accent: '#0F766E', font: 'sans', scheme: 'light' } },
  { id: 'night', title: 'Night', description: 'Dark, Timefix blue', value: { accent: '#3B74E6', font: 'sans', scheme: 'dark' } },
];

const FONTS: Readonly<Record<GuestFont, { readonly label: string; readonly family: string }>> = {
  sans: { label: 'Geist', family: 'var(--font-sans)' },
  mono: { label: 'Geist Mono', family: 'var(--font-mono)' },
};

const lookVars = (v: Omit<GuestLookValue, 'look'>) => ({
  '--tf-look-accent': v.accent,
  '--tf-look-on-accent': contrastOnWhiteText(v.accent) >= 3 ? 'var(--on-accent)' : 'var(--text)',
  '--tf-look-font': FONTS[v.font].family,
}) as CSSProperties;

/** A look as a tiny swatch for its tile: its ground, "Aa" in its face and a bar in its accent. */
function LookSwatch({ value }: { readonly value: Omit<GuestLookValue, 'look'> }) {
  return (
    <span className="tf-look-swatch" data-theme={value.scheme} style={lookVars(value)} aria-hidden="true">
      <span className="tf-look-swatch__aa">Aa</span>
      <span className="tf-look-swatch__bar" />
    </span>
  );
}

/** The live preview: a booking page small, in the chosen look. */
export function GuestLookPreview({ value, host = 'Priya Raman', title = 'Discovery call' }: { readonly value: GuestLookValue; readonly host?: string; readonly title?: string }) {
  const name = value.look === 'custom' ? 'Custom' : GUEST_LOOKS.find((l) => l.id === value.look)?.title ?? '';
  return (
    <figure className="tf-look-preview" aria-label={`Preview: ${name}, ${FONTS[value.font].label}, ${value.scheme}`}>
      <div className="tf-look-preview__page" data-theme={value.scheme} style={lookVars(value)} aria-hidden="true">
        <div className="tf-look-preview__card">
          <Avatar name={host} size={36} />
          <span className="tf-look-preview__host">{host}</span>
          <span className="tf-look-preview__title">{title}</span>
          <span className="tf-look-preview__days">
            {[10, 11, 12, 13, 14].map((d) => <span key={d} className="tf-look-preview__day" data-picked={d === 12 || undefined}>{d}</span>)}
          </span>
          <span className="tf-look-preview__times">
            {['9:30 AM', '10:00 AM'].map((t) => <span key={t} className="tf-look-preview__time">{t}</span>)}
          </span>
          <span className="tf-look-preview__book">Book</span>
        </div>
      </div>
      <figcaption className="tf-look-preview__caption">
        <SoftText>{name}</SoftText> <span aria-hidden="true">·</span> <SoftText>{FONTS[value.font].label}</SoftText> <span aria-hidden="true">·</span> <SoftText>{value.scheme === 'dark' ? 'Dark' : 'Light'}</SoftText>
      </figcaption>
    </figure>
  );
}

/** Props for GuestLook. */
export interface GuestLookProps {
  readonly value: GuestLookValue;
  readonly onChange: (value: GuestLookValue) => void;
  /** Whose page the preview draws. */
  readonly host?: string;
  readonly title?: string;
}

/** The guest pages' look picker: four looks and Custom as choice cards, then accent, face and light or dark, beside a live preview. Changing anything by hand makes it Custom. */
export function GuestLook({ value, onChange, host, title }: GuestLookProps) {
  // Custom keeps the last look made by hand, so going to a preset and back loses nothing.
  const [custom, setCustom] = useState<Omit<GuestLookValue, 'look'>>(value);
  useEffect(() => { if (value.look === 'custom') setCustom(value); }, [value]);
  const pick = (id: string) => {
    const preset = GUEST_LOOKS.find((l) => l.id === id);
    onChange(preset ? { look: preset.id, ...preset.value } : { look: 'custom', ...custom });
  };
  const tweak = (patch: Partial<GuestLookValue>) => onChange({ ...value, ...patch, look: 'custom' });
  const items = [
    ...GUEST_LOOKS.map((l) => ({ id: l.id, title: l.title, description: l.description, icon: <LookSwatch value={l.value} /> })),
    { id: 'custom', title: 'Custom', description: 'Your colour and face', icon: <LookSwatch value={custom} /> },
  ];
  return (
    <div className="tf-look">
      <div className="tf-look__grid">
      <div className="tf-look__controls">
        <TileGrid label="Look" items={items} value={value.look} onChange={pick} columns={3} />
        <AccentPicker label="Accent" value={value.accent} onChange={(accent) => tweak({ accent })} />
        <div className="tf-look__row">
          <span className="tf-look__label">Font</span>
          <SegmentedControl aria-label="Font" selectedKey={value.font} onSelectionChange={(k) => tweak({ font: k as GuestFont })}
            items={(Object.keys(FONTS) as GuestFont[]).map((f) => ({ id: f, label: FONTS[f].label }))} />
        </div>
        <div className="tf-look__row">
          <span className="tf-look__label">Appearance</span>
          <SegmentedControl aria-label="Appearance" selectedKey={value.scheme} onSelectionChange={(k) => tweak({ scheme: k as 'light' | 'dark' })}
            items={[{ id: 'light', label: 'Light', icon: <Sun size={14} strokeWidth={1.75} /> }, { id: 'dark', label: 'Dark', icon: <Moon size={14} strokeWidth={1.75} /> }]} />
        </div>
      </div>
      <GuestLookPreview value={value} host={host} title={title} />
      </div>
    </div>
  );
}
