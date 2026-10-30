// Linking records from a cell or a record page row (spec 0014, milestone 2),
// and the record picker's search everywhere it shows (the task dialog too).
// One search per picker through the data layer (`records.search`), one open
// at a time; each result says beside its name whether it is linked already
// and who holds it ("At Acme"); a pick or a removed chip goes to the data
// layer as one link delta (`records.editLinks`), a pick marked "At …" moving
// the record from its holder. A picker may also make the record searched for
// ("Create "<typed>"", `useRecordMaking`), linked once it exists.
import type {
  AttributeDefinition,
  LinkChange,
  LinkOutcome,
  ObjectSummary,
  RecordRefDisplay,
  RecordSearch,
  SearchResult,
} from '@crm/data';
import { arraySource, type AttributeEditorProps, type ListSource, type ResultState } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { refsOf } from './details.ts';
import { strings } from './strings.ts';
import { useRecordMaking } from './useRecordMaking.ts';

const keyOf = (display: RecordRefDisplay) => `${display.objectId}:${display.recordId}`;

/** What a picker shows while its search is out: one row still loading, never "No results". */
const LOADING: ListSource<RecordRefDisplay> = { count: 1, getItem: () => undefined, getKey: keyOf };

/**
 * A search of one display shape as the editor takes it: AttributeEditor types its search over every attribute type's
 * display, and each editor reads only its own (a record picker's records, a member picker's members). The one cast
 * for it, so each dialog with a picker (a task's, a booking's Link to a record) doesn't keep its own.
 */
export const editorSearch = <T>(search: (query: string) => ListSource<T>) =>
  search as unknown as NonNullable<AttributeEditorProps['onSearch']>;

/** What one record picker needs: its search, each result's note, and how a pick is sent. */
export interface LinkPicker {
  readonly onSearch: (query: string) => ListSource<RecordRefDisplay>;
  readonly describeResult: (display: RecordRefDisplay) => ResultState | undefined;
  /** "Create "<typed>"": makes the far record and answers its chip; left out where the person may not make one. */
  readonly onCreateRecord?: (label: string) => RecordRefDisplay | undefined;
  /** The far object needs its full form: the row reads "Create deal…" and opens it. */
  readonly createFormNoun?: string;
}

/** A picker's create offer, as ReferencePicker and RelatedRecords take it. */
export interface MakeOffer {
  readonly onCreate: (label: string) => RecordRefDisplay | undefined;
  readonly formNoun?: string;
}

/**
 * Opens the full create form for a far object that needs more than a name,
 * starting from what was typed, and hands over what it made (a screen's
 * `useRecordForm`).
 */
export type OpenRecordForm = (
  object: ObjectSummary,
  label: string,
  onMade: (display: RecordRefDisplay) => void,
) => void;

/** A create offer as an editor's props. */
const editorOffer = (offer: MakeOffer | undefined) =>
  offer === undefined
    ? {}
    : {
        onCreateRecord: offer.onCreate,
        ...(offer.formNoun === undefined ? {} : { createFormNoun: offer.formNoun }),
      };

/** A result's note and chosen state: linked already, or held elsewhere ("At Acme", or hidden). */
export function resultState(result: SearchResult | undefined): ResultState | undefined {
  if (result === undefined) return undefined;
  if (result.linked) return { isLinked: true };
  const holder = result.takenBy;
  if (holder === undefined) return undefined;
  return { note: 'hidden' in holder ? strings.linkedElsewhere : strings.linkedAt(holder.name) };
}

/** Where a search looks, and the side being edited (for `linked` and `takenBy`). */
interface SearchKey {
  readonly objectId: string;
  readonly attributeId?: string;
  readonly recordId?: string;
}

const searchKey = (key: SearchKey) => `${key.objectId}:${key.attributeId ?? ''}:${key.recordId ?? ''}`;

/**
 * The searches a screen's pickers use, one open at a time (opening another
 * lets the last one go), re-rendering the screen as answers land. Let go
 * when the screen goes. A form draws all its pickers at once and each asks
 * as it draws, so there (`isEach`) every key keeps its own search: letting
 * one go for the next would start them over and over, each answer drawing
 * the form again.
 */
function useSearches(slug: string, isEach = false) {
  const { data } = useRouteContext({ from: '__root__' });
  const searches = useRef(new Map<string, RecordSearch>());
  // Every result any of them answered, by record id: a chip picked in one search keeps its name after the next.
  const seen = useRef(new Map<string, SearchResult>());
  const [, answered] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const held = searches.current;
    return () => {
      for (const search of held.values()) search.dispose();
      held.clear();
    };
  }, []);
  const searchFor = useCallback(
    (key: SearchKey): RecordSearch => {
      const id = searchKey(key);
      const found = searches.current.get(id);
      if (found !== undefined) return found;
      if (!isEach) {
        for (const other of searches.current.values()) other.dispose();
        searches.current.clear();
      }
      const made = data.records.search(slug, {
        objectId: key.objectId,
        ...(key.attributeId === undefined ? {} : { forAttributeId: key.attributeId }),
        ...(key.recordId === undefined ? {} : { forRecordId: key.recordId }),
      });
      // Answers land later (never while the picker draws), and draw it again.
      made.subscribe(() => {
        for (const result of made.getSnapshot().results) seen.current.set(result.ref.recordId, result);
        answered();
      });
      searches.current.set(id, made);
      return made;
    },
    [data, slug, isEach],
  );
  const peek = useCallback((key: SearchKey) => searches.current.get(searchKey(key)), []);
  const seenResult = useCallback((recordId: string) => seen.current.get(recordId), []);
  return { searchFor, peek, seenResult };
}

/** A search as a picker's results: the answer once in, one loading row while it is out, nothing once it failed. */
function sourceOf(search: RecordSearch, query: string): ListSource<RecordRefDisplay> {
  search.ask(query);
  const now = search.getSnapshot();
  if (now.query !== query.trim() || now.status === 'loading' || now.status === 'idle') return LOADING;
  return arraySource(
    now.results.map((result) => result.ref),
    keyOf,
  );
}

/**
 * Linking from a screen's reference cells or rows (spec 0014): `pickerFor`
 * gives a reference attribute's editor on one record its search and notes,
 * and `commit` sends what the editor committed as link deltas. A side whose
 * relationship lists no object the person can see has no picker (it shows
 * read only).
 */
export function useLinkEditing(slug: string, openForm?: OpenRecordForm) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { searchFor, peek } = useSearches(slug);
  // The create form's pickers, all drawn at once: a search for each.
  const inForm = useSearches(slug, true);
  const making = useRecordMaking(slug);
  const keyFor = (definition: AttributeDefinition, recordId?: string): SearchKey | undefined => {
    const objectId = definition.relationship?.targetObjectIds[0];
    if (objectId === undefined) return undefined;
    return { objectId, attributeId: definition.id, ...(recordId === undefined ? {} : { recordId }) };
  };

  /** Says a made record landed and was linked, with Undo for the link (the record stays; ⌘Z again bins it). */
  const toastMade = (outcome: LinkOutcome | undefined, display: RecordRefDisplay) => {
    making.forget(display.recordId);
    if (outcome?.kind !== 'done' || !outcome.changed) return;
    const { undoId } = outcome;
    toasts.toast({
      tone: 'success',
      message: strings.createdLinked(display.name),
      ...(undoId === undefined
        ? {}
        : {
            action: {
              label: strings.undo,
              onAction: () => {
                runUndo(data, toasts, slug, undoId);
              },
            },
          }),
    });
  };

  /**
   * "Create "<typed>"" on a side (owner flow pass, 30 Oct 2026): for someone
   * who may make records of the far object, from the name alone, or (when it
   * needs more) through the screen's full form, whose record `onMade` links.
   */
  const offerFor = (
    definition: AttributeDefinition,
    onMade: (display: RecordRefDisplay) => void,
  ): MakeOffer | undefined => {
    const objectId = definition.relationship?.targetObjectIds[0];
    if (objectId === undefined || definition.type !== 'record_reference' || definition.readOnly !== undefined) {
      return undefined;
    }
    const choice = making.choiceFor(objectId);
    if (choice === undefined) return undefined;
    if (choice.mode === 'name') return { onCreate: (label) => making.makeByName(choice.object, label) };
    if (openForm === undefined) return undefined;
    return {
      onCreate: (label) => {
        openForm(choice.object, label, onMade);
        return undefined;
      },
      formNoun: choice.object.singularName.toLowerCase(),
    };
  };

  /** A record the full form made for a cell or a row: linked as one add, with its toast. */
  const linkMade = (definition: AttributeDefinition, recordId: string, display: RecordRefDisplay) => {
    const { change } = addFor(definition, recordId, display);
    data.records.changeLink(slug, change).then(
      (outcome) => {
        toastMade(outcome, display);
      },
      () => undefined,
    );
  };

  const pickerFor = (definition: AttributeDefinition, recordId: string): LinkPicker | undefined => {
    const key = keyFor(definition, recordId);
    if (key === undefined || definition.type !== 'record_reference') return undefined;
    return {
      onSearch: (query) => sourceOf(searchFor(key), query),
      describeResult: (display) => resultState(peek(key)?.resultOf(display.recordId)),
      ...editorOffer(
        offerFor(definition, (display) => {
          linkMade(definition, recordId, display);
        }),
      ),
    };
  };

  /**
   * A reference in the create form (NewRecordDialog): the same search, with
   * no record yet (so nothing reads as linked, and a record held elsewhere
   * still says where), the chips' names, and "Create "<typed>"" by name only:
   * a form never opens over the form.
   */
  const formPickerFor = (definition: AttributeDefinition) => {
    const key = keyFor(definition);
    if (key === undefined || definition.type !== 'record_reference') return undefined;
    const offer = offerFor(definition, () => undefined);
    return {
      editor: {
        onSearch: editorSearch((query: string) => sourceOf(inForm.searchFor(key), query)),
        describeResult: (display: RecordRefDisplay) => resultState(inForm.peek(key)?.resultOf(display.recordId)),
        ...(offer?.formNoun === undefined ? editorOffer(offer) : {}),
      },
      displayOf: (recordId: string): RecordRefDisplay | undefined =>
        making.madeHere(recordId) ?? inForm.seenResult(recordId)?.ref,
    };
  };

  const commit = (definition: AttributeDefinition, recordId: string, value: unknown) => {
    const key = keyFor(definition, recordId);
    const search = key === undefined ? undefined : peek(key);
    const paired = definition.relationship?.pairedAttributeId;
    // A record just made here ("Create …"): its toast follows the link.
    const madeNow = refsOf(value).flatMap((ref) => {
      const display = making.madeHere(ref.recordId);
      return display === undefined ? [] : [display];
    });
    const sent = data.records.editLinks(slug, {
      recordId,
      attributeId: definition.id,
      value,
      isMulti: definition.isMulti,
      ...(paired === undefined ? {} : { pairedAttributeId: paired }),
      pickOf: (pickedId) => {
        const result = search?.resultOf(pickedId);
        if (result === undefined) {
          const display = making.madeHere(pickedId);
          return display === undefined ? undefined : { display };
        }
        const holder = result.linked ? undefined : result.takenBy;
        return {
          display: result.ref,
          // The marker is the warning (spec 0014): a pick marked "At …" moves the record in one save.
          ...(holder === undefined ? {} : { move: true }),
          ...(holder === undefined || 'hidden' in holder
            ? {}
            : { movedFrom: { objectId: holder.objectId, recordId: holder.recordId } }),
        };
      },
    });
    const [first] = madeNow;
    if (first !== undefined) {
      void sent.then(
        (outcomes) => {
          toastMade(outcomes[0], first);
        },
        () => undefined,
      );
    }
    return sent;
  };
  /**
   * A related section's Add (spec 0017, AC-375): the record picked on a side
   * that holds many, as one link delta, moved from its holder when the search
   * marked it "At …" (the marker is the warning, as in a cell).
   */
  const addFor = (
    definition: AttributeDefinition,
    recordId: string,
    display: RecordRefDisplay,
  ): { readonly change: LinkChange; readonly movedFromName?: string } => {
    const key = keyFor(definition, recordId);
    const result = key === undefined ? undefined : peek(key)?.resultOf(display.recordId);
    const holder = result === undefined || result.linked ? undefined : result.takenBy;
    const paired = definition.relationship?.pairedAttributeId;
    const change: LinkChange = {
      kind: 'add',
      recordId,
      attributeId: definition.id,
      target: { objectId: display.objectId, recordId: display.recordId },
      isMulti: definition.isMulti,
      display,
      ...(paired === undefined ? {} : { pairedAttributeId: paired }),
      ...(holder === undefined ? {} : { move: true }),
      ...(holder === undefined || 'hidden' in holder
        ? {}
        : { movedFrom: { objectId: holder.objectId, recordId: holder.recordId } }),
    };
    // The holder by name for the toast ("Moved … from Acme"); one the person can't see is never named.
    return holder === undefined || 'hidden' in holder ? { change } : { change, movedFromName: holder.name };
  };
  return { pickerFor, formPickerFor, offerFor, commit, addFor };
}

/**
 * The task dialog's record picker search (spec 0019, through spec 0014's
 * `records.search`): what the person types, in the object the switcher
 * names, and every record display it has answered (to show a picked one at
 * once). `failed` says the last search failed; typing on asks again.
 */
export function useRecordSearch(slug: string, objectId: string) {
  const { searchFor, peek, seenResult } = useSearches(slug);
  const onSearch = useCallback(
    (query: string): ListSource<RecordRefDisplay> => sourceOf(searchFor({ objectId }), query),
    [searchFor, objectId],
  );
  const displayOf = useCallback((recordId: string) => seenResult(recordId)?.ref, [seenResult]);
  const failed = peek({ objectId })?.getSnapshot().status === 'error';
  return { onSearch, displayOf, failed };
}
