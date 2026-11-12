import type { SVGProps } from 'react';

/** The six status shapes. Each keeps its meaning without colour. */
export type StatusShape = 'draft' | 'progress' | 'review' | 'done' | 'failed' | 'waiting';

/** A status shape at 16px (or `size`), drawn in currentColor so it takes the tag's hue. */
export function StatusIcon({ shape, size = 16, ...rest }: { readonly shape: StatusShape; readonly size?: number } & SVGProps<SVGSVGElement>) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest };
  switch (shape) {
    case 'draft':
      return <svg {...common}><circle cx="12" cy="12" r="9" strokeDasharray="3.4 3.1" /></svg>;
    case 'progress':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 6.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" /></svg>;
    case 'review':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5H12z" fill="currentColor" stroke="none" /></svg>;
    case 'done':
      return <svg {...common}><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="m8 12.5 2.6 2.6L16 9.5" stroke="var(--surface)" strokeWidth="2.4" /></svg>;
    case 'failed':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>;
    case 'waiting':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>;
  }
}
