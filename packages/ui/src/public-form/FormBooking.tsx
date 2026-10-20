import { useEffect, useState, type Ref } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import '../lib/custom-properties.ts';
import styles from './FormBooking.module.css';
import { FormBadge, FormHeadline } from './FormParts.tsx';
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

/**
 * Sent, and on to book (spec 0023 AC-1059): the thank you's check and
 * heading, then "Taking you to book a time in 5…" with the number counting
 * down inside a draining ring, Book now to go at once and Stay here to stop;
 * after Stay here, Book a time stays for later. The sentence is said once,
 * politely; the number itself is never announced. Under reduced motion the
 * ring is gone and only the number changes.
 */
export function FormBooking({ state, mode, heading, url, seconds, text }: FormBookingProps) {
  const { words } = state;
  const [left, setLeft] = useState(seconds);
  const [isStaying, setStaying] = useState(false);
  const isGoing = !isStaying && !state.preview;
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

  // One step a second; at nought, on to the page.
  useEffect(() => {
    if (!isGoing || seconds === 0) return;
    if (left <= 0) {
      state.goTo(url);
      return;
    }
    const step = globalThis.setTimeout(() => {
      setLeft((count) => count - 1);
    }, 1000);
    return () => {
      globalThis.clearTimeout(step);
    };
  }, [isGoing, left, seconds, state, url]);

  return (
    <div className={styles.root}>
      <FormBadge />
      <FormHeadline mode={mode} heading={heading}>
        {words.thanksTitle}
      </FormHeadline>
      {text !== '' && <p className={styles.text}>{text}</p>}
      {/* Said once as it appears, never each second. */}
      <VisuallyHidden>
        <p aria-live="polite">
          {!isSaid || isStaying ? '' : seconds === 0 ? words.bookingNow : words.bookingIn(seconds)}
        </p>
      </VisuallyHidden>
      {!isStaying && (
        <p className={styles.line} aria-hidden="true">
          {seconds === 0 ? (
            words.bookingNow
          ) : (
            <>
              {words.bookingInBefore}{' '}
              <span className={styles.count} style={{ '--countdown': `${String(seconds)}s` }}>
                <svg className={styles.ring} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
                  <circle className={styles.track} cx="18" cy="18" r="16" pathLength="100" />
                  <circle className={styles.drain} cx="18" cy="18" r="16" pathLength="100" />
                </svg>
                <span className={styles.number}>{String(Math.max(left, 0))}</span>
              </span>
              {words.bookingInAfter}
            </>
          )}
        </p>
      )}
      <span className={styles.actions}>
        {isStaying ? (
          <Button variant="primary" size="lg" onPress={() => state.goTo(url)}>
            {words.bookATime}
          </Button>
        ) : (
          <>
            <Button variant="primary" size="lg" onPress={() => state.goTo(url)}>
              {words.bookNow}
            </Button>
            {seconds > 0 && (
              <Button variant="ghost" size="lg" onPress={() => setStaying(true)}>
                {words.stayHere}
              </Button>
            )}
          </>
        )}
      </span>
    </div>
  );
}
