// A read a route's loader starts but doesn't wait for (load time, bookings redesign step 1): the page draws without
// it, and with it once it lands, at once when it already had by the time the page drew (a cached read).
import { useEffect, useState } from 'react';

/** A read still landing, and what it answered once it has. */
export interface Settling<T> {
  readonly promise: Promise<T>;
  /** What it answered, once it has: a page drawing after it landed shows it in its first frame, not its second. */
  readonly settled: () => T | undefined;
}

/** `promise`, with what it answered kept for a synchronous look. Give it one that never rejects. */
export function settling<T>(promise: Promise<T>): Settling<T> {
  const answer: { value?: T } = {};
  void promise.then((value) => {
    answer.value = value;
  });
  return { promise, settled: () => answer.value };
}

/** What a `Settling` read answered, or undefined while it is out (or when there is none); draws again when it lands. */
export function useSettled<T>(read: Settling<T> | undefined): T | undefined {
  const [landed, setLanded] = useState<{ readonly read: Settling<T>; readonly value: T } | undefined>(undefined);
  useEffect(() => {
    if (read === undefined || read.settled() !== undefined) return;
    let isCurrent = true;
    void read.promise.then((value) => {
      if (isCurrent) setLanded({ read, value });
    });
    return () => {
      isCurrent = false;
    };
  }, [read]);
  if (read === undefined) return undefined;
  return landed?.read === read ? landed.value : read.settled();
}
