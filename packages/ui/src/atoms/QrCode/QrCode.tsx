import { encode } from 'uqr';
import { Children, useId, useMemo, type ReactNode, type Ref } from 'react';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './QrCode.module.css';

/** Props for QrCode. */
export interface QrCodeProps {
  /** What the code holds (an `otpauth://` address for an authenticator app). */
  readonly value: string;
  /** What it is, for screen readers ("QR code for your authenticator app"). */
  readonly label: string;
  /**
   * A column beside the code: what to do with it (numbered steps, the setup key to type instead). Side by side
   * where the slot has room, under the code where it doesn't (a phone). Its items stack a `space-12` apart.
   */
  readonly children?: ReactNode;
  /**
   * `md` (the default) is `size-menu` wide (`size-column` with `children`); `sm` is `size-column-narrow`, a code
   * that sits in a card among others (Home's link page card) and still scans from a phone; `fill` takes its slot's
   * whole width, for a code shown to be scanned from across a table or saved to print (the link page's QR Modal).
   */
  readonly size?: 'sm' | 'md' | 'fill';
  /** The code's own SVG, for a caller that saves it as an image (the link page's Download PNG). */
  readonly ref?: Ref<SVGSVGElement>;
  /**
   * The modules' colour (spec 0061, AC-6124): a `#rrggbb` the owner picked. Drawn only when it keeps 4.5 to 1 against
   * the white ground (the server refuses anything less with a hint); otherwise the code stays black. The ground is
   * always white, because not every scanner reads an inverted code.
   */
  readonly colour?: string;
  /**
   * A picture in the code's centre (AC-6124): the person's own or an upload, from our origin only. It takes at most
   * a fifth of the code's side, on a white pad, and the code switches to the highest error correction to carry it.
   */
  readonly picture?: string;
  /** A frame around the code with this label under it (AC-6124), up to 20 characters: "Scan me". */
  readonly frameLabel?: string;
}

/** The quiet margin around the modules, in modules, as scanners need. */
const QUIET_ZONE = 4;

/** The most of the code's side a centre picture may take (AC-6124). */
const PICTURE_SHARE = 0.2;

/** The contrast a module colour needs against the white ground (AC-6124, `QR_CONTRAST_MIN` in the contracts). */
const CONTRAST_MIN = 4.5;

/** The band under the code that holds the frame's label, in modules. */
const LABEL_BAND = 5;

/** About how wide one character of the label is, in modules, at its size of 3: a wide face's 0.6 em. */
const LABEL_CHAR = 1.8;

/** How far outside the quiet zone the frame's line runs, in modules, so the code keeps its whole quiet margin. */
const FRAME_OUT = 2;

/** A checked `#rrggbb`. */
const HEX = /^#[0-9a-f]{6}$/i;

/** A colour's relative luminance (WCAG 2), from `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The module colour to draw, or undefined for the default black: only a checked hex that keeps 4.5 to 1 against white
 * (the same rule the server holds a saved style to), so a code drawn here always scans.
 */
export function qrModuleColour(colour: string | undefined): string | undefined {
  if (colour === undefined || !HEX.test(colour)) return undefined;
  return 1.05 / (luminance(colour) + 0.05) >= CONTRAST_MIN ? colour.toLowerCase() : undefined;
}

/**
 * Where a centre picture sits, in modules, for a code `count` modules a side (the quiet zone included): a square of at
 * most a fifth of the side, odd so it centres on a module, and the hole cleared for it, one module wider each way.
 */
export function qrPictureBox(count: number): {
  readonly at: number;
  readonly side: number;
  readonly hole: readonly [number, number];
} {
  const inner = count - QUIET_ZONE * 2;
  let side = Math.floor(inner * PICTURE_SHARE);
  if (side % 2 === 0) side -= 1;
  const at = (count - side) / 2;
  return { at, side, hole: [at - 1, at + side + 1] };
}

/**
 * A QR code, drawn as one SVG path: dark modules on a white ground in both
 * themes (the light theme's tokens, scoped to the code), since not every
 * scanner reads an inverted code. `uqr` is imported
 * only here. With `children`, a column beside it. With spec 0061's style
 * (`colour`, `picture`, `frameLabel`), the same code in the owner's colour,
 * with their picture in the middle and a labelled frame, all inside the one SVG
 * so a saved copy carries them.
 */
export function QrCode({ value, label, children, size: width = 'md', ref, colour, picture, frameLabel }: QrCodeProps) {
  const clipId = useId();
  const centre = safeImageSrc(picture);
  const hasPicture = centre !== undefined;
  const { path, size, box } = useMemo(() => {
    const { data } = encode(value, { ecc: hasPicture ? 'H' : 'M', border: QUIET_ZONE });
    const count = data.length;
    const place = hasPicture ? qrPictureBox(count) : undefined;
    const runs: string[] = [];
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        // Under the picture the modules are left out: the highest error correction reads past them.
        const isUnder =
          place !== undefined && x >= place.hole[0] && x < place.hole[1] && y >= place.hole[0] && y < place.hole[1];
        if (dark && !isUnder) runs.push(`M${String(x)} ${String(y)}h1v1h-1z`);
      });
    });
    return { path: runs.join(''), size: count, box: place };
  }, [value, hasPicture]);
  const modules = qrModuleColour(colour);
  const named = frameLabel?.trim() ?? '';
  const isFramed = named !== '';
  const height = isFramed ? size + LABEL_BAND : size;
  const out = isFramed ? FRAME_OUT : 0;
  const code = (
    <svg
      ref={ref}
      className={styles.root}
      // The light theme's tokens inside the code in either theme: a white ground and dark modules, on screen and in
      // a saved PNG (AC-5122), since not every scanner reads an inverted or grey grounded code.
      data-theme="light"
      data-size={width}
      data-framed={isFramed || undefined}
      role="img"
      aria-label={label}
      viewBox={`${String(-out)} ${String(-out)} ${String(size + out * 2)} ${String(height + out * 2)}`}
      shapeRendering="crispEdges"
      {...(modules === undefined ? {} : { style: { '--qr-modules': modules } })}
    >
      <rect className={styles.ground} x={-out} y={-out} width={size + out * 2} height={height + out * 2} />
      <path className={styles.modules} d={path} />
      {box !== undefined && centre !== undefined && (
        <>
          <clipPath id={clipId}>
            <rect x={box.at} y={box.at} width={box.side} height={box.side} rx={1} />
          </clipPath>
          <image
            href={centre}
            x={box.at}
            y={box.at}
            width={box.side}
            height={box.side}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      )}
      {isFramed && (
        <>
          {/* The frame: a rounded line outside the whole quiet zone, and the label centred in the band under the code. */}
          <rect
            className={styles.frame}
            x={0.5 - out}
            y={0.5 - out}
            width={size + out * 2 - 1}
            height={height + out * 2 - 1}
            rx={2}
            fill="none"
            strokeWidth={1}
            shapeRendering="geometricPrecision"
          />
          <text
            className={styles.frameLabel}
            x={size / 2}
            y={size + LABEL_BAND / 2 - 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={3}
            fontWeight={600}
            // A long label on a small code is fitted to the code's width rather than running past the frame.
            {...(named.length * LABEL_CHAR > size - 2
              ? { textLength: size - 2, lengthAdjust: 'spacingAndGlyphs' }
              : {})}
          >
            {named}
          </text>
        </>
      )}
    </svg>
  );
  // Only real content gets the column: nothing, `false` from `{cond && …}` or an empty list keeps the plain code.
  if (Children.toArray(children).length === 0) return code;
  return (
    <div className={styles.layout}>
      {code}
      <div className={styles.aside}>{children}</div>
    </div>
  );
}
