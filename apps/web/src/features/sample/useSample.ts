// The workspace's sample data state for a screen that offers it, through the data layer's held copy (read again
// after an add, a remove, its Undo and the job's end). Undefined until the store has loaded, or when `isOffered` is
// false (a member who may not manage it reads nothing).
import type { SampleHeld, SampleSnapshot } from '@crm/data';
import { useSampleData } from '@crm/data/react';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/** A held copy that never reads: what a screen shows before the store loads. */
const WAITING: SampleHeld = {
  subscribe: () => () => undefined,
  getSnapshot: () => ({ status: 'loading' }),
  retain: () => () => undefined,
};

/** The sample data state, `loading` until it is read. */
export function useSample(slug: string, isOffered: boolean): SampleSnapshot {
  const { data } = useRouteContext({ from: '__root__' });
  const [held, setHeld] = useState<SampleHeld>(WAITING);
  useEffect(() => {
    if (!isOffered) return;
    let isLive = true;
    data.sampleData.view(slug).then(
      (found) => {
        if (isLive) setHeld(found);
      },
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, isOffered]);
  return useSampleData(held);
}
