import { useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { useToastClearance } from '../../provider/toast-clearance.ts';
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
  /**
   * Comes and goes at once, with no rise, sink or fade: a bar opened or
   * closed from the keyboard (the house motion rule). `onLeft` follows in
   * the next frame.
   */
  readonly isInstant?: boolean;
  /** Handlers for the whole bar, such as a key handler (the bulk bar's Esc). */
  readonly frameProps?: HTMLAttributes<HTMLDivElement>;
}

// Waits this long for the exit's transition before calling it done anyway (motion off, a hidden tab).
const EXIT_FALLBACK_MS = 400;

/** Props for FloatingBarGroup. */
export interface FloatingBarGroupProps {
  readonly children: ReactNode;
  /** Nothing before it in the bar: no hairline, and it takes the row's spare room. */
  readonly isAlone?: boolean;
  /** At the bar's end, kept whole (the save bar's Discard and Save). */
  readonly isEnd?: boolean;
  readonly ref?: Ref<HTMLSpanElement>;
}

/**
 * A run of actions inside a FloatingBar, after a hairline: the one rule the bulk bar and the save bar both drew, so
 * neither keeps a copy (spec 0072, the folded bars). Not exported from the package: the bars in `modules/` use it.
 */
export function FloatingBarGroup({ children, isAlone = false, isEnd = false, ref }: FloatingBarGroupProps) {
  return (
    <span ref={ref} className={styles.group} data-alone={isAlone || undefined} data-end={isEnd || undefined}>
      {children}
    </span>
  );
}

/**
 * The floating bar's shell, shared by the bulk bar and the save bar: the
 * Timefix prototype's white pill with the large shadow, which rises in as it
 * mounts and drops away when `isLeaving`.
 * Reduced motion fades it; `isInstant` (opened from the keyboard) skips the
 * motion. On a narrow view it spans the width.
 */
export function FloatingBar({
  children,
  placement = 'inline',
  isLeaving = false,
  onLeft,
  isInstant = false,
  frameProps,
}: FloatingBarProps) {
  const surface = useRef<HTMLDivElement>(null);
  // Toasts rise above the bar while it is up (a bulk Delete sat under a toast at the bottom right, trash flow,
  // 13 Nov 2026); a bar on its way out claims nothing.
  const keepToastsOff = useToastClearance();
  useEffect(() => {
    const element = surface.current;
    if (element === null || isLeaving) return undefined;
    return keepToastsOff(element);
  }, [keepToastsOff, isLeaving]);
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
    // No exit plays at once: gone in the next frame, rather than after the fallback's wait.
    if (isInstant) {
      const frame = requestAnimationFrame(done);
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'opacity') done();
    };
    element?.addEventListener('transitionend', onEnd);
    const timer = setTimeout(done, EXIT_FALLBACK_MS);
    return () => {
      element?.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
    };
  }, [isLeaving, isInstant]);
  return (
    <div {...frameProps} className={styles.frame} data-placement={placement}>
      <div
        ref={surface}
        className={styles.surface}
        data-leaving={isLeaving || undefined}
        data-instant={isInstant || undefined}
        inert={isLeaving}
      >
        {children}
      </div>
    </div>
  );
}
