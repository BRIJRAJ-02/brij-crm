// A record picker's "Create "<typed>"" (owner flow pass, 30 Oct 2026): what
// the person may make of each far object, read once through the data layer's
// cached `objects.list` and `attributes.list`, and the record made from the
// typed name through the data layer's optimistic create, so its chip shows at
// once and a link to it waits for it.
import type { AttributeDefinition, ObjectSummary, RecordRefDisplay } from '@crm/data';
import { refusalSummary, isDataError } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { makeModeOf, nameValueOf, type MakeMode } from './make.ts';
import { strings } from './strings.ts';

/** What a picker may make of a far object, once its definitions are in. */
export interface MakeChoice {
  readonly mode: MakeMode;
  readonly object: ObjectSummary;
}

/** The chip a record made from a name shows: its name as typed, and the kind its object draws. */
function displayOf(object: ObjectSummary, recordId: string, label: string): RecordRefDisplay {
  const key = object.standardKey;
  return {
    objectId: object.id,
    recordId,
    name: label.trim(),
    kind: key === 'people' ? 'person' : key === 'companies' ? 'company' : 'other',
  };
}

/**
 * The making side of a screen's pickers: `choiceFor` says how a far object's
 * records can be made (nothing until its definitions are in, or when the
 * person may not), `makeByName` makes one from the typed name and answers
 * its chip at once, and `madeHere` says whether a record was made here (its
 * link's toast says so), once.
 */
export function useRecordMaking(slug: string) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [objects, setObjects] = useState<readonly ObjectSummary[]>();
  const [definitions, setDefinitions] = useState<ReadonlyMap<string, readonly AttributeDefinition[]>>(new Map());
  // The far objects asked for, so each is read once; a failed read is asked again on the next draw.
  const asked = useRef(new Set<string>());
  const [wanted, setWanted] = useState<readonly string[]>([]);
  const made = useRef(new Map<string, RecordRefDisplay>());
  useEffect(() => {
    let isLive = true;
    void data.objects.list(slug).then(
      (list) => {
        if (isLive) setObjects(list);
      },
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data, slug]);
  useEffect(() => {
    let isLive = true;
    for (const objectId of wanted) {
      if (asked.current.has(objectId)) continue;
      asked.current.add(objectId);
      void data.attributes.list(slug, objectId).then(
        (list) => {
          if (isLive) setDefinitions((held) => new Map(held).set(objectId, list));
        },
        () => {
          asked.current.delete(objectId);
        },
      );
    }
    return () => {
      isLive = false;
    };
  }, [data, slug, wanted]);

  const choiceFor = (objectId: string): MakeChoice | undefined => {
    const object = objects?.find((each) => each.id === objectId);
    const list = definitions.get(objectId);
    if (list === undefined) {
      // Read after this draw, never during it.
      if (!wanted.includes(objectId)) queueMicrotask(() => setWanted((held) => [...new Set([...held, objectId])]));
      return undefined;
    }
    if (object === undefined) return undefined;
    const mode = makeModeOf(object, list);
    return mode === undefined ? undefined : { mode, object };
  };

  /** Makes a record of `object` named `label` (optimistic: its chip shows at once); a refusal says why in a toast. */
  const makeByName = (object: ObjectSummary, label: string): RecordRefDisplay | undefined => {
    const primary = definitions.get(object.id)?.find((each) => each.id === object.primaryAttributeId);
    const value = nameValueOf(primary, label);
    if (primary === undefined || value === undefined) return undefined;
    const id = data.records.newId();
    const display = displayOf(object, id, label);
    made.current.set(id, display);
    data.records.create(slug, object.id, id, { [primary.id]: value }).catch((error: unknown) => {
      made.current.delete(id);
      toasts.toast({
        tone: 'danger',
        message: strings.notCreated(display.name, isDataError(error) ? refusalSummary(error) : strings.tryAgain),
      });
    });
    return display;
  };

  const madeHere = useCallback((recordId: string): RecordRefDisplay | undefined => made.current.get(recordId), []);
  const forget = useCallback((recordId: string) => {
    made.current.delete(recordId);
  }, []);

  return { choiceFor, makeByName, madeHere, forget };
}
