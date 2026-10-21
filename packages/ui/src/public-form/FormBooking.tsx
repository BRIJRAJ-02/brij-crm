import { useEffect, useRef, useState, type Ref } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import '../lib/custom-properties.ts';
import styles from './FormBooking.module.css';
import { FormConfirmation } from './FormParts.tsx';
import type { HostedFormMode, HostedFormState } from './use-hosted-form.ts';

/** Props for FormBooking. */
export interface FormBookingProps {
  readonly state: HostedFormState;
  readonly mode: HostedFormMode;
  readonly heading: Ref<HTMLHeadingElement>;
  /** Where the visitor goes: the booking page with the signed hand off. */
  readonly url: string;
  /** Seconds before going on; 0 goes at once. */
  readonly seconds: number;
  /** The form's own thank you words, when it has them. */
  readonly text: string;
}

/** How long the page waits, having gone, before offering Book a time again (a browser that blocked the move). */
const STILL_HERE_MS = 3000;

/**
 * Sent, and on to book (spec 0023 AC-1059): the thank you's check and
 * heading, then "Taking you to book a time in 5…" with the number counting
 * down inside a draining ring, Book now to go at once and Stay here to stop.
 * The countdown holds while focus or the pointer is on the buttons, so
 * nobody is taken away while reaching for Stay here. After Stay here, the
 * one button reads Book a time and keeps focus. The sentence is said once,
 * politely; the number itself is never announced. Under reduced motion the
 * ring is gone and only the number changes.
 */
export function FormBooking({ state, mode, heading, url, seconds, text }: FormBookingProps) {
  const { words } = state;
  const [left, setLeft] = useState(seconds);
  const [isStaying, setStaying] = useState(false);
  const [isHeld, setHeld] = useState(false);
  const [hasGone, setGone] = useState(seconds === 0);
  const primary = useRef<HTMLButtonElement>(null);
  // The latest way out, for the timer, which shouldn't restart each time the form redraws.
  const goTo = useRef(state.goTo);
  useEffect(() => {
    goTo.current = state.goTo;
  });
  const isCounting = !isStaying && !hasGone && !isHeld && !state.preview;

  // The sentence goes in a frame after the region exists, so it is said; it never changes after.
  const [isSaid, setSaid] = useState(false);
  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      setSaid(true);
    });
    return () => {
      globalThis.cancelAnimationFrame(frame);
    };
  }, []);

  // One step a second; at nought, on to the page, once.
  useEffect(() => {
    if (!isCounting) return;
    const step = globalThis.setTimeout(() => {
      if (left <= 1) {
        setGone(true);
        goTo.current(url);
      } else setLeft(left - 1);
    }, 1000);
    return () => {
      globalThis.clearTimeout(step);
    };
  }, [isCounting, left, url]);

  // Still here a while after going (a browser that refused the move): the way on comes back.
  useEffect(() => {
    if (!hasGone || isStaying || state.preview) return;
    const still = globalThis.setTimeout(() => {
      setStaying(true);
    }, STILL_HERE_MS);
    return () => {
      globalThis.clearTimeout(still);
    };
  }, [hasGone, isStaying, state.preview]);

  const go = () => {
    setGone(true);
    state.goTo(url);
  };
  const stay = () => {
    setStaying(true);
    globalThis.requestAnimationFrame(() => primary.current?.focus());
  };

  return (
    <FormConfirmation mode={mode} heading={heading} title={words.thanksTitle} text={text}>
      {/* Said once as it appears, never each second. */}
      <VisuallyHidden>
        <p aria-live="polite">
          {!isSaid || isStaying ? '' : seconds === 0 ? words.bookingNow : words.bookingIn(seconds)}
        </p>
      </VisuallyHidden>
      {!isStaying && (
        <p className={styles.line} aria-hidden="true">
          {hasGone ? (
            words.bookingNow
          ) : (
            <>
              <span>{words.bookingInBefore}</span>
              <span
                className={styles.count}
                data-held={isHeld || undefined}
                style={{ '--countdown': `${String(seconds)}s` }}
              >
                <svg className={styles.ring} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
                  <circle className={styles.track} cx="18" cy="18" r="16" pathLength="100" />
                  <circle className={styles.drain} cx="18" cy="18" r="16" pathLength="100" />
                </svg>
                <span className={styles.number}>{String(left)}</span>
              </span>
              <span>{words.bookingInAfter}</span>
            </>
          )}
        </p>
      )}
      <div
        className={styles.actions}
        onFocus={() => {
          setHeld(true);
        }}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
            setHeld(false);
        }}
        onPointerEnter={() => {
          setHeld(true);
        }}
        onPointerLeave={() => {
          setHeld(false);
        }}
      >
        <Button variant="primary" size="lg" ref={primary} onPress={go}>
          {isStaying ? words.bookATime : words.bookNow}
        </Button>
        {!isStaying && !hasGone && (
          <Button variant="ghost" size="lg" onPress={stay}>
            {words.stayHere}
          </Button>
        )}
      </div>
    </FormConfirmation>
  );
}
