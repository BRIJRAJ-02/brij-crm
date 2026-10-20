import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './FloatingBar.module.css';

/** Props for FloatingBar. */
export interface FloatingBarProps {
  readonly children: ReactNode;
  /**
   * `inline` (the default) sits where it is put; `footer` centres it in a
   * page's sticky footer (PageColumn's, PreviewLayout's); `floating` floats it
   * centred over the bottom of its nearest positioned container (the DataGrid's
   * frame). Centred, only the bar takes the pointer.
   */
  readonly placement?: 'inline' | 'footer' | 'floating';
  /** Plays the exit (it fades and sinks, in the exit duration), inert meanwhile; then `onLeft`. */
  readonly isLeaving?: boolean;
  /** Called once the exit has played, so the owner can unmount it. */
  readonly onLeft?: () => void;
  /** Handlers for the whole bar, such as a key handler (the bulk bar's Esc). */
  readonly frameProps?: HTMLAttributes<HTMLDivElement>;
}

// Waits this long for the exit's transition before calling it done anyway (motion off, a hidden tab).
const EXIT_FALLBACK_MS = 400;

/**
 * The floating bar's shell, shared by the bulk bar and the save bar: a
 * toolbar tall bar on the raised surface with the popover shadow and large
 * corners, which rises in as it mounts and sinks out when `isLeaving`.
 * Reduced motion fades it. On a narrow view it spans the width.
 */
export function FloatingBar({
  children,
  placement = 'inline',
  isLeaving = false,
  onLeft,
  frameProps,
}: FloatingBarProps) {
  const surface = useRef<HTMLDivElement>(null);
  const left = useRef(onLeft);
  useEffect(() => {
    left.current = onLeft;
  }, [onLeft]);
  useEffect(() => {
    if (!isLeaving) return;
    const element = surface.current;
    let isDone = false;
    const done = () => {
      if (isDone) return;
      isDone = true;
      left.current?.();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'opacity') done();
    };
    element?.addEventListener('transitionend', onEnd);
    const timer = setTimeout(done, EXIT_FALLBACK_MS);
    return () => {
      element?.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
    };
  }, [isLeaving]);
  return (
    <div {...frameProps} className={styles.frame} data-placement={placement}>
      <div ref={surface} className={styles.surface} data-leaving={isLeaving || undefined} inert={isLeaving}>
        {children}
      </div>
    </div>
  );
}
