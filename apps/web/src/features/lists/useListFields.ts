// A list's own fields for a screen that doesn't load them in its route (a record page's cards, the Add dialog).
// Read through the data layer, which caches them until a definition changes; nothing is fetched here.
import type { AttributeDefinition, DataLayer, ListView } from '@crm/data';
import { useEffect, useState } from 'react';

/** What a hook that reads a list's fields holds. */
interface Held {
  readonly listId: string;
  readonly fields: readonly AttributeDefinition[];
}

/**
 * The list's live fields (Added and Added by first), or undefined while they load or when they can't be read.
 * `list` undefined holds nothing.
 */
export function useListFields(
  data: DataLayer,
  slug: string,
  list: Pick<ListView, 'id' | 'objectId'> | undefined,
): readonly AttributeDefinition[] | undefined {
  const [held, setHeld] = useState<Held | undefined>(undefined);
  const listId = list?.id;
  const objectId = list?.objectId;
  useEffect(() => {
    if (listId === undefined || objectId === undefined) return undefined;
    let isCurrent = true;
    data.lists.fields(slug, { id: listId, objectId }).then(
      (fields) => {
        if (isCurrent) setHeld({ listId, fields });
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, listId, objectId]);
  return held?.listId === listId ? held?.fields : undefined;
}
