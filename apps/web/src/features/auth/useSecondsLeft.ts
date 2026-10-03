import { useEffect, useState } from 'react';

/** Whole seconds from `now` until `until` (Unix milliseconds), never below zero. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Counts down to `until` (Unix milliseconds) once a second and returns the
 * whole seconds left, stopping at zero. The resend wait on `/verify` reads it.
 */
export function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    // Read the clock at once when `until` moves (a new code was sent), then every second until zero.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(() => {
      tick();
      if (Date.now() >= until) window.clearInterval(timer);
    }, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);
  return secondsLeft(until, now);
}
