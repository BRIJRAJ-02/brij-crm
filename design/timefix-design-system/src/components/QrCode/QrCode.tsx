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

/** One printable sheet of several drawn codes, three to a row, each with its label and line under it (table tents, a wall of codes). */
export function qrSheet(codes: ReadonlyArray<{ readonly svg: SVGSVGElement; readonly label: string; readonly line?: string }>, title: string): string {
  const cell = 240; const cols = 3; const gap = 24; const head = 72;
  const rows = Math.ceil(codes.length / cols);
  const w = cols * cell + (cols + 1) * gap; const h = head + rows * (cell + 64) + (rows + 1) * gap;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = codes.map((c, i) => {
    const x = gap + (i % cols) * (cell + gap); const y = head + gap + Math.floor(i / cols) * (cell + 64 + gap);
    const inner = standalone(c.svg).replace(/^<svg/, `<svg x="${x}" y="${y}" width="${cell}" height="${cell}"`);
    return `${inner}<text x="${x + cell / 2}" y="${y + cell + 30}" text-anchor="middle" font-family="Geist, Arial, sans-serif" font-size="20" font-weight="600" fill="#111">${esc(c.label)}</text>`
      + (c.line ? `<text x="${x + cell / 2}" y="${y + cell + 52}" text-anchor="middle" font-family="Geist, Arial, sans-serif" font-size="12" fill="#555">${esc(c.line)}</text>` : '');
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><text x="${gap}" y="44" font-family="Geist, Arial, sans-serif" font-size="24" font-weight="600" fill="#111">${esc(title)}</text>${parts}</svg>`;
}

/** A print sheet on A4 pages (595 × 842): `tiles` puts six codes a page (2 × 3) with their label and line; `tents` puts two tent cards a page,
 *  each folded along a dashed line with the code upright on both faces. Pages stack in one SVG, ready to print. */
export function qrPrintSheet(codes: ReadonlyArray<{ readonly svg: SVGSVGElement; readonly label: string; readonly line?: string }>, layout: 'tiles' | 'tents', title: string): string {
  const W = 595; const H = 842; const gapY = 24; const per = layout === 'tiles' ? 6 : 2;
  const pages = Math.max(1, Math.ceil(codes.length / per));
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = (x: number, y: number, size: number, weight: number, fill: string, t: string, rot = '') => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Geist, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"${rot}>${esc(t)}</text>`;
  const code = (svg: SVGSVGElement, x: number, y: number, side: number, rot = '') => `<g${rot}>${standalone(svg).replace(/^<svg/, `<svg x="${x}" y="${y}" width="${side}" height="${side}"`)}</g>`;
  const out: string[] = [];
  for (let p = 0; p < pages; p += 1) {
    const top = p * (H + gapY);
    out.push(`<rect x="0" y="${top}" width="${W}" height="${H}" fill="#fff" stroke="#ddd"/>`, text(W / 2, top + 36, 12, 500, '#555', `${title} · page ${p + 1} of ${pages}`));
    codes.slice(p * per, p * per + per).forEach((c, i) => {
      if (layout === 'tiles') {
        const cw = (W - 3 * 32) / 2; const ch = (H - 64 - 4 * 24) / 3; const x = 32 + (i % 2) * (cw + 32); const y = top + 64 + 24 + Math.floor(i / 2) * (ch + 24);
        const side = Math.min(cw, ch) - 70;
        out.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="none" stroke="#ccc" stroke-dasharray="4 4"/>`, code(c.svg, x + (cw - side) / 2, y + 14, side), text(x + cw / 2, y + side + 40, 18, 600, '#111', c.label), c.line ? text(x + cw / 2, y + side + 58, 11, 400, '#555', c.line) : '');
      } else {
        const ch = (H - 64 - 3 * 24) / 2; const x = 40; const cw = W - 80; const y = top + 64 + 24 + i * (ch + 24); const half = ch / 2; const side = half - 70;
        const cx = x + cw / 2; const upper = y + half / 2;
        out.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="none" stroke="#ccc"/>`, `<line x1="${x}" y1="${y + half}" x2="${x + cw}" y2="${y + half}" stroke="#999" stroke-dasharray="6 6"/>`,
          code(c.svg, cx - side / 2, upper - side / 2 - 10, side, ` transform="rotate(180 ${cx} ${upper})"`), text(cx, upper + side / 2 + 8, 16, 600, '#111', c.label, ` transform="rotate(180 ${cx} ${upper + side / 2 + 2})"`),
          code(c.svg, cx - side / 2, y + half + 16, side), text(cx, y + half + side + 36, 16, 600, '#111', c.label), c.line ? text(cx, y + half + side + 54, 11, 400, '#555', c.line) : '');
      }
    });
  }
  const h = pages * H + (pages - 1) * gapY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${out.join('')}</svg>`;
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
