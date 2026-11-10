import { saveFile, type SaveOutcome } from '../../lib/saveFile.ts';
import { Children, useMemo, type ReactNode, type Ref } from 'react';
import { cx } from '../../lib/cx.ts';
import { LogoMark } from '../Logo/Logo.tsx';
import { encodeQr } from './qr.ts';
import './QrCode.css';

export { encodeQr, type QrEcc } from './qr.ts';

/** The quiet margin scanners need, in modules. */
const QUIET = 4;
/** The most of the code's side a centre logo may take. */
const LOGO_SHARE = 0.2;
/** The band under a framed code that holds its label, in modules. */
const LABEL_BAND = 5;
/** How far outside the quiet zone the frame runs, in modules. */
const FRAME_OUT = 2;
const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

/** The module colour to draw: a checked `#rrggbb` that keeps 4.5 to 1 against white, else undefined (the default ink), so a code always scans. */
export function qrModuleColour(colour: string | undefined): string | undefined {
  if (colour === undefined || !HEX.test(colour)) return undefined;
  return 1.05 / (luminance(colour) + 0.05) >= 4.5 ? colour.toLowerCase() : undefined;
}

/** Where a centre logo sits for a code `count` modules a side: an odd square of at most a fifth of the code, and the hole cleared one module wider. */
export function qrLogoBox(count: number): { readonly at: number; readonly side: number; readonly hole: readonly [number, number] } {
  let side = Math.floor((count - QUIET * 2) * LOGO_SHARE);
  if (side % 2 === 0) side -= 1;
  const at = (count - side) / 2;
  return { at, side, hole: [at - 1, at + side + 1] };
}

/** A rounded-square module at (x, y), as one subpath. */
const dot = (x: number, y: number) => `M${x + 0.3} ${y}h0.4a0.3 0.3 0 0 1 0.3 0.3v0.4a0.3 0.3 0 0 1-0.3 0.3h-0.4a0.3 0.3 0 0 1-0.3-0.3v-0.4a0.3 0.3 0 0 1 0.3-0.3z`;
/** A rounded rectangle subpath. */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}z`;

/** Props for QrCode. */
export interface QrCodeProps {
  /** What the code opens: a booking page, a link page, a table's menu, an `otpauth://` secret. */
  readonly value: string;
  /** What it is, for screen readers: "QR code for priya's link page". */
  readonly label: string;
  /** `sm` 120 in a card among others, `md` 240 (default), `fill` its slot's width for print and across-the-table scans. */
  readonly size?: 'sm' | 'md' | 'fill';
  /** The Timefix mark in the centre; switches to the highest error correction to carry it. */
  readonly withLogo?: boolean;
  /** A `#rrggbb` for the modules, drawn only when it keeps 4.5 to 1 on white. */
  readonly colour?: string;
  /** A rounded frame with this label under the code: "Scan for the menu". */
  readonly frameLabel?: string;
  /** `drawn` (default) paints its light ground, `paper` keeps it white in a dark app (print), `clear` paints none (the caller's tile is the ground). */
  readonly ground?: 'drawn' | 'clear' | 'paper';
  /** The SVG itself, for `downloadQr`. */
  readonly ref?: Ref<SVGSVGElement>;
  /** A column beside the code (steps, the setup key), wrapping under it on a narrow slot. */
  readonly children?: ReactNode;
}

/** A QR code drawn as one SVG: rounded modules and finder eyes, dark on a light ground in either theme, optional centre mark and frame. */
export function QrCode({ value, label, size = 'md', withLogo = false, colour, frameLabel, ground = 'drawn', ref, children }: QrCodeProps) {
  const { modules, finders, count, box } = useMemo(() => {
    const data = encodeQr(value, withLogo ? 'H' : 'M', QUIET);
    const n = data.length;
    const place = withLogo ? qrLogoBox(n) : undefined;
    const eyes: ReadonlyArray<readonly [number, number]> = [[QUIET, QUIET], [n - QUIET - 7, QUIET], [QUIET, n - QUIET - 7]];
    const inEye = (x: number, y: number) => eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7);
    const inHole = (x: number, y: number) => place !== undefined && x >= place.hole[0] && x < place.hole[1] && y >= place.hole[0] && y < place.hole[1];
    const parts: string[] = [];
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark && !inEye(x, y) && !inHole(x, y)) parts.push(dot(x, y)); }));
    const eyePath = eyes.map(([x, y]) => rr(x, y, 7, 7, 2) + rr(x + 1, y + 1, 5, 5, 1.4) + rr(x + 2, y + 2, 3, 3, 0.9)).join('');
    return { modules: parts.join(''), finders: eyePath, count: n, box: place };
  }, [value, withLogo]);
  const ink = qrModuleColour(colour);
  const named = frameLabel?.trim() ?? '';
  const framed = named !== '';
  const out = framed ? FRAME_OUT : 0;
  const height = framed ? count + LABEL_BAND : count;
  const code = (
    <svg
      ref={ref}
      className={cx('tf-qr', `tf-qr--${size}`, `tf-qr--ground-${ground}`)}
      data-theme="light"
      role="img"
      aria-label={label}
      viewBox={`${-out} ${-out} ${count + out * 2} ${height + out * 2}`}
      style={ink ? ({ '--tf-qr-ink': ink } as React.CSSProperties) : undefined}
    >
      <rect className="tf-qr__ground" x={-out} y={-out} width={count + out * 2} height={height + out * 2} rx={framed ? 3 : 2} />
      <path className="tf-qr__ink" d={modules} />
      <path className="tf-qr__ink" d={finders} fillRule="evenodd" />
      {box && (
        <g transform={`translate(${box.at} ${box.at})`}>
          <LogoMark size={box.side} />
        </g>
      )}
      {framed && (
        <>
          <rect className="tf-qr__frame" x={0.5 - out} y={0.5 - out} width={count + out * 2 - 1} height={height + out * 2 - 1} rx={2.5} fill="none" strokeWidth={1} />
          <text className="tf-qr__label" x={count / 2} y={count + LABEL_BAND / 2 - 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={3} fontWeight={500}
            {...(named.length * 1.8 > count - 2 ? { textLength: count - 2, lengthAdjust: 'spacingAndGlyphs' } : {})}>
            {named}
          </text>
        </>
      )}
    </svg>
  );
  if (Children.toArray(children).length === 0) return code;
  return <div className="tf-qr-layout">{code}<div className="tf-qr-layout__aside">{children}</div></div>;
}

/** Inlines the computed colours of `svg` into a standalone copy on a white ground, so a saved file looks as drawn and prints white. */
function standalone(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const target = to[i];
    if (!target) return;
    const cs = getComputedStyle(el);
    if (cs.fill && cs.fill !== 'none') target.setAttribute('fill', cs.fill);
    if (cs.stroke && cs.stroke !== 'none') target.setAttribute('stroke', cs.stroke);
    if (el instanceof SVGTextElement) target.setAttribute('font-family', cs.fontFamily);
    target.removeAttribute('class');
  });
  const paper = getComputedStyle(svg).getPropertyValue('--surface').trim();
  copy.querySelector('rect')?.setAttribute('fill', paper || 'white');
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.removeAttribute('style');
  return new XMLSerializer().serializeToString(copy);
}

/** Saves a drawn QrCode as `name.svg`, or `name.png` at `px` pixels wide (default 1024), always on white. */
export async function downloadQr(svg: SVGSVGElement, name: string, format: 'svg' | 'png', px = 1024): Promise<SaveOutcome> {
  const text = standalone(svg);
  if (format === 'svg') return saveFile(`${name}.svg`, new Blob([text], { type: 'image/svg+xml' }));
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const vb = svg.viewBox.baseVal;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round((px * vb.height) / vb.width);
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'failed';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? saveFile(`${name}.png`, blob) : 'failed';
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
