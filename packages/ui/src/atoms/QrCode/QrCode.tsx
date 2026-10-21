import { encode } from 'uqr';
import { useMemo } from 'react';
import styles from './QrCode.module.css';

/** Props for QrCode. */
export interface QrCodeProps {
  /** What the code holds (an `otpauth://` address for an authenticator app). */
  readonly value: string;
  /** What it is, for screen readers ("QR code for your authenticator app"). */
  readonly label: string;
}

/** The quiet margin around the modules, in modules, as scanners need. */
const QUIET_ZONE = 4;

/**
 * A QR code, drawn as one SVG path: dark modules on a light ground in both
 * themes, since not every scanner reads an inverted code. `uqr` is imported
 * only here.
 */
export function QrCode({ value, label }: QrCodeProps) {
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
  return (
    <svg
      className={styles.root}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
    >
      <rect className={styles.ground} width={size} height={size} />
      <path className={styles.modules} d={path} />
    </svg>
  );
}
