// The task dialog's record picker search (spec 0019): what the person types,
// searched in the object the switcher names through the data layer
// (`tasks.findRecords`, until spec 0014's `records.search`), 200 ms after the
// last key, each answer kept per object and query for the dialog's life. The
// picker asks in render; the answer arrives later and draws the menu again.
import type { RecordRefDisplay } from '@crm/data';
import { arraySource, type ListSource } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing must pause before the search is sent. */
const SEARCH_DELAY_MS = 200;

const keyOf = (display: RecordRefDisplay) => `${display.objectId}:${display.recordId}`;

/** The search for the picker, and every record display it has answered (to show a picked one at once). */
export function useRecordSearch(slug: string, objectId: string) {
  const { data } = useRouteContext({ from: '__root__' });
  const answers = useRef(new Map<string, readonly RecordRefDisplay[]>());
  const seen = useRef(new Map<string, RecordRefDisplay>());
  const pending = useRef<{ readonly key: string; readonly timer: ReturnType<typeof setTimeout> } | undefined>(
    undefined,
  );
  // Moves when an answer lands, so the picker asks again and finds it.
  const [version, setVersion] = useState(0);
  useEffect(
    () => () => {
      clearTimeout(pending.current?.timer);
    },
    [],
  );
  const onSearch = useCallback(
    (query: string): ListSource<RecordRefDisplay> => {
      const key = `${objectId}\u0000${query.trim()}`;
      const answered = answers.current.get(key);
      if (answered !== undefined) return arraySource(answered, keyOf);
      if (pending.current?.key !== key) {
        clearTimeout(pending.current?.timer);
        pending.current = {
          key,
          timer: setTimeout(() => {
            void data.tasks.findRecords(slug, objectId, query).then(
              (found) => {
                answers.current.set(key, found);
                for (const display of found) seen.current.set(display.recordId, display);
                setVersion((at) => at + 1);
              },
              () => {
                // Nothing offered; the next key asks again.
                pending.current = undefined;
              },
            );
          }, SEARCH_DELAY_MS),
        };
      }
      // While it is out, one row still loading (the menu draws it as loading, never "No results").
      return { count: 1, getItem: () => undefined, getKey: keyOf };
    },
    // `version` draws the picker again once an answer lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, slug, objectId, version],
  );
  const displayOf = useCallback((recordId: string) => seen.current.get(recordId), []);
  return { onSearch, displayOf };
}
