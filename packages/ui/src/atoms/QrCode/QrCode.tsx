import { encode } from 'uqr';
import { Children, useMemo, type ReactNode } from 'react';
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
}

/** The quiet margin around the modules, in modules, as scanners need. */
const QUIET_ZONE = 4;

/**
 * A QR code, drawn as one SVG path: dark modules on a light ground in both
 * themes, since not every scanner reads an inverted code. `uqr` is imported
 * only here. With `children`, a column beside it.
 */
export function QrCode({ value, label, children, size: width = 'md' }: QrCodeProps) {
  const { path, size } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: QUIET_ZONE });
    const runs: string[] = [];
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) runs.push(`M${String(x)} ${String(y)}h1v1h-1z`);
      });
    });
    return { path: runs.join(''), size: data.length };
  }, [value]);
  const code = (
    <svg
      className={styles.root}
      data-size={width}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
    >
      <rect className={styles.ground} width={size} height={size} />
      <path className={styles.modules} d={path} />
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
