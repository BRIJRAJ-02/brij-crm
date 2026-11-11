import {
  RadioGroup, Radio, Label, ColorSwatchPicker as AriaColorSwatchPicker, ColorSwatchPickerItem, ColorSwatch, ColorField, Input,
  parseColor, type Color,
} from 'react-aria-components';
import { useId, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import type { Hue } from '../Tag/Tag.tsx';
import { PICKER_FIELD, PICKER_LABEL } from '../Popover/Popover.tsx';
import './ColorPicker.css';

/** The nine data hues in picker order, with the names screen readers hear. */
export const HUE_NAMES: Readonly<Record<Hue, string>> = {
  gray: 'Grey', red: 'Red', orange: 'Orange', yellow: 'Yellow', lime: 'Lime', green: 'Green', sky: 'Sky', blue: 'Blue', purple: 'Purple',
};
const HUES = Object.keys(HUE_NAMES) as ReadonlyArray<Hue>;

/** The check that appears in a chosen swatch (black or white on a brand colour, by its luminance, since a theme token can't know it): it swaps in from small and faded (transitions.dev 09 icon swap). */
function SwatchCheck({ ink }: { readonly ink?: string }) {
  return <span className="tf-swatch__check" style={ink ? { color: ink } : undefined} aria-hidden="true"><Check size={14} strokeWidth={2.5} /></span>;
}

/** Props for ColorSwatchPicker. */
export interface ColorSwatchPickerProps {
  readonly label: string;
  readonly value?: Hue;
  readonly defaultValue?: Hue;
  readonly onChange?: (hue: Hue) => void;
  /** Shows the label and the chosen hue's name above the swatches. */
  readonly isLabelShown?: boolean;
  readonly isDisabled?: boolean;
}

/** One of the nine data hues as round swatches: a select option's colour, an object's tile, a calendar's colour. Arrows move and choose. */
export function ColorSwatchPicker({ label, value, defaultValue = 'blue', onChange, isLabelShown = false, isDisabled }: ColorSwatchPickerProps) {
  const [own, setOwn] = useState<Hue>(defaultValue);
  const hue = value ?? own;
  return (
    <RadioGroup
      className="tf-swatches" aria-label={isLabelShown ? undefined : label} value={hue} orientation="horizontal" isDisabled={isDisabled}
      onChange={(v) => { const h = v as Hue; setOwn(h); onChange?.(h); }}
    >
      {isLabelShown && <Label className={PICKER_LABEL}>{label} <span className="tf-swatches__name">· {HUE_NAMES[hue]}</span></Label>}
      <div className="tf-swatches__row">
        {HUES.map((h) => (
          <Radio key={h} value={h} aria-label={HUE_NAMES[h]} className="tf-swatch" style={{ '--tf-swatch': `var(--dot-${h})` } as CSSProperties}>
            <span className="tf-swatch__dot"><SwatchCheck /></span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}

/** A curated brand colour for booking and link pages. */
export interface AccentSwatch { readonly hex: string; readonly name: string }

/** Timefix's curated accents: each keeps white text readable (4.5:1 or better). */
export const ACCENT_SWATCHES: ReadonlyArray<AccentSwatch> = [
  { hex: '#1F5FD6', name: 'Timefix blue' }, { hex: '#111111', name: 'Ink' }, { hex: '#0F766E', name: 'Teal' }, { hex: '#15803D', name: 'Green' },
  { hex: '#7C3AED', name: 'Violet' }, { hex: '#BE185D', name: 'Raspberry' }, { hex: '#C2410C', name: 'Rust' },
];

/** WCAG relative luminance of a colour. */
function luminance(c: Color): number {
  const rgb = c.toFormat('rgb');
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb.getChannelValue('red')) + 0.7152 * lin(rgb.getChannelValue('green')) + 0.0722 * lin(rgb.getChannelValue('blue'));
}

/** The contrast of white text on a colour, as WCAG's ratio. */
export function contrastOnWhiteText(hex: string): number {
  return 1.05 / (luminance(parseColor(hex)) + 0.05);
}

/** Props for AccentPicker. */
export interface AccentPickerProps {
  readonly label: string;
  /** "#RRGGBB". */
  readonly value: string;
  readonly onChange: (hex: string) => void;
  readonly swatches?: ReadonlyArray<AccentSwatch>;
}

/** A booking page's brand colour: a few curated swatches plus any hex, with a line saying how readable white text is on it. A hex that doesn't parse goes back to the last good colour when you leave the field. */
export function AccentPicker({ label, value, onChange, swatches = ACCENT_SWATCHES }: AccentPickerProps) {
  const color = parseColor(value);
  const ratio = contrastOnWhiteText(value);
  const readable = ratio >= 4.5;
  const labelId = useId();
  return (
    <div className="tf-accent">
      <span className={PICKER_LABEL} id={labelId}>{label}</span>
      <AriaColorSwatchPicker className="tf-swatches__row" aria-labelledby={labelId} value={color} onChange={(c) => onChange(c.toString('hex'))}>
        {swatches.map((s) => (
          <ColorSwatchPickerItem key={s.hex} color={s.hex} className="tf-swatch" style={{ '--tf-swatch': s.hex } as CSSProperties}>
            <ColorSwatch className="tf-swatch__dot" colorName={s.name} />
            <SwatchCheck ink={luminance(parseColor(s.hex)) > 0.4 ? '#111111' : '#FFFFFF'} />
          </ColorSwatchPickerItem>
        ))}
      </AriaColorSwatchPicker>
      <ColorField className="tf-accent__hex" aria-label={`${label} hex`} value={color} onChange={(c) => { if (c) onChange(c.toString('hex')); }}>
        <span className={cx(PICKER_FIELD, 'tf-accent__field')}>
          <ColorSwatch className="tf-accent__preview" color={color} />
          <Input className="tf-accent__input" />
        </span>
      </ColorField>
      <span className={cx('tf-accent__contrast', !readable && 'tf-accent__contrast--low')}>
        White text {ratio.toFixed(1)}:1 · {readable ? 'readable' : 'too faint, pick a darker colour'}
      </span>
    </div>
  );
}
