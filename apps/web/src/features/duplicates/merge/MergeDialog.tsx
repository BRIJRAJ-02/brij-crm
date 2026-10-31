// Brief
// Purpose: merge two records of one object into one (spec 0049, AC-4910 to AC-4917).
// Main task: see both side by side, pick the value to keep where they differ, read what moves, then Merge.
// Leaves out: finding likely pairs (the duplicates page and banner, spec 0049 tasks 5 to 7, open this same dialog
// with both ids), undo (a merge can't be undone, so this dialog is its confirmation), and any optimistic change.
import {
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type MemberSummary,
  type MergePreview,
  type MergeSide,
  type ObjectSummary,
  type RecordRefDisplay,
  type RecordView,
} from '@crm/data';
import {
  arraySource,
  AttributeDisplay,
  AttributeEditor,
  Button,
  Callout,
  Modal,
  Radio,
  RadioGroup,
  Skeleton,
  type FieldAttribute,
  type ListSource,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { editorSearch, useRecordSearch } from '../../records/links.ts';
import { keptFirst, refOf } from './pair.ts';
import { strings } from './strings.ts';

/** Props for the merge dialog. */
export interface MergeDialogProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The object's attributes, for each row's field display. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /**
   * The records to merge: one (the record page's "Merge with…", which asks for the other first) or two (the
   * duplicates page and banner). Undefined while closed.
   */
  readonly recordIds: readonly string[] | undefined;
  readonly onClose: () => void;
  /** The merge landed: the kept record's id and name, and the merged one's id (gone from every screen now). */
  readonly onMerged?: (merged: {
    readonly keptId: string;
    readonly keptName: string;
    readonly mergedId: string;
  }) => void;
}

/** Where the dialog's read stands. */
type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: MergePreview }
  | { readonly status: 'failed'; readonly message: string };

/** An answer to one read: the pair and attempt it was for, so a newer read shows loading until its own lands. */
type Answer = { readonly key: string } & Exclude<PreviewState, { status: 'loading' }>;

const PICKER: FieldAttribute = {
  id: 'merge-other-record',
  name: strings.mergeWith,
  type: 'record_reference',
  allowMultiple: false,
  cardinality: 'one',
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

/** A record's name, or "Unnamed record". */
const nameOf = (view: RecordView) => (view.display.name === '' ? strings.unnamed : view.display.name);

/** A search's results without one record (the one being merged): it can't merge with itself. */
function without(source: ListSource<RecordRefDisplay>, recordId: string): ListSource<RecordRefDisplay> {
  const items = Array.from({ length: source.count }, (_, index) => source.getItem(index));
  if (items.some((item) => item === undefined)) return source;
  return arraySource(
    items.filter((item): item is RecordRefDisplay => item !== undefined && item.recordId !== recordId),
    source.getKey,
  );
}

/**
 * The merge dialog (AC-4910, AC-4916): asks for the other record when it was opened with one, then shows both
 * side by side, a row for each attribute they hold differently that the reader may change, preselected to the
 * kept record's value, with Swap to keep the other. Merge waits for the server (not optimistic, AC-4916), and a
 * refusal stays in the dialog, a changed record reading both again.
 */
export function MergeDialog({ slug, object, attributes, members, recordIds, onClose, onMerged }: MergeDialogProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [picked, setPicked] = useState<RecordRefDisplay | undefined>(undefined);
  const [swapped, setSwapped] = useState(false);
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  const [picks, setPicks] = useState<Readonly<Record<string, MergeSide>>>({});
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const search = useRecordSearch(slug, object.id);

  const [first] = recordIds ?? [];
  const second = recordIds?.[1] ?? picked?.recordId;
  // The newer record (the greater uuid v7) is merged away by default (AC-4910); Swap keeps it instead.
  const pair = first === undefined || second === undefined ? undefined : keptFirst(first, second, swapped);

  const keepId = pair?.keepId;
  const mergeId = pair?.mergeId;
  const readKey = keepId === undefined || mergeId === undefined ? undefined : `${keepId}:${mergeId}:${String(attempt)}`;
  useEffect(() => {
    if (keepId === undefined || mergeId === undefined || readKey === undefined) return;
    let current = true;
    data.records.mergePreview(slug, { objectId: object.id, keepId, mergeId }).then(
      (preview) => {
        if (current) setAnswer({ key: readKey, status: 'ready', preview });
      },
      (error: unknown) => {
        const message = error instanceof Error && error.message !== '' ? error.message : strings.loadFailed;
        if (current) setAnswer({ key: readKey, status: 'failed', message });
      },
    );
    return () => {
      current = false;
    };
  }, [data, slug, object.id, keepId, mergeId, readKey]);
  const state: PreviewState = answer !== undefined && answer.key === readKey ? answer : { status: 'loading' };

  const byId = useMemo(() => new Map(attributes.map((definition) => [definition.id, definition])), [attributes]);
  const actors = useMemo(() => toActorDisplays(members), [members]);

  const close = () => {
    if (pending) return;
    setPicked(undefined);
    setSwapped(false);
    setPicks({});
    setRefusal(undefined);
    setAnswer(undefined);
    onClose();
  };

  const ready = state.status === 'ready' ? state.preview : undefined;
  const merge = () => {
    if (ready === undefined || pair === undefined || pending || ready.tooLarge) return;
    setPending(true);
    setRefusal(undefined);
    const chosen = Object.fromEntries(
      ready.rows.map((row) => [row.attributeId, picks[row.attributeId] ?? row.preselected]),
    );
    void data.records
      .merge(slug, {
        objectId: object.id,
        keepId: pair.keepId,
        mergeId: pair.mergeId,
        picks: chosen,
        revisions: { keep: ready.keep.revision, merge: ready.merge.revision },
      })
      .then((outcome) => {
        setPending(false);
        if (outcome.kind === 'failed') {
          setRefusal(outcome.error.message === '' ? strings.loadFailed : outcome.error.message);
          // A record that changed meanwhile: both are read again, so the rows show what is there now.
          if (outcome.error.code === 'CONFLICT') setAttempt((count) => count + 1);
          return;
        }
        toasts.toast({ tone: 'success', message: strings.merged(outcome.keptName) });
        onMerged?.({ keptId: pair.keepId, keptName: outcome.keptName, mergedId: pair.mergeId });
        setPicked(undefined);
        setSwapped(false);
        setPicks({});
        onClose();
      });
  };

  const displayOf = (definition: AttributeDefinition, value: unknown) => {
    if (definition.type === 'actor_reference') return actors;
    if (definition.type !== 'record_reference' || ready === undefined) return undefined;
    const ids = (Array.isArray(value) ? (value as readonly unknown[]) : [value]).flatMap((item) => {
      const ref = refOf(item);
      return ref === undefined ? [] : [ref.recordId];
    });
    return ready.displays.filter((display) => ids.includes(display.recordId));
  };

  const valueCard = (definition: AttributeDefinition, view: RecordView) => {
    const value = view.values[definition.id] ?? null;
    const display = displayOf(definition, value);
    return (
      <AttributeDisplay
        attribute={toFieldAttribute(definition)}
        value={value}
        surface="preview"
        {...(display === undefined ? {} : { display })}
      />
    );
  };

  let body;
  if (pair === undefined) {
    body = (
      <AttributeEditor
        attribute={PICKER}
        value={null}
        surface="form"
        autoOpen
        onSearch={editorSearch((query) => without(search.onSearch(query), first ?? ''))}
        onCommit={(value) => {
          const ref = refOf(value);
          if (ref === undefined || ref.recordId === first) return;
          setPicked(search.displayOf(ref.recordId) ?? { ...ref, name: '', kind: 'other' });
        }}
        {...(search.failed ? { error: strings.loadFailed } : {})}
      />
    );
  } else if (state.status === 'loading') {
    body = <Skeleton shape="text" lines={4} />;
  } else if (state.status === 'failed') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button
            onPress={() => {
              setAttempt((count) => count + 1);
            }}
          >
            {strings.tryAgain}
          </Button>
        }
      >
        {state.message}
      </Callout>
    );
  } else {
    const { preview } = state;
    const kept = nameOf(preview.keep);
    const merged = nameOf(preview.merge);
    const moves = strings.moves({
      links: preview.moved.links,
      notes: preview.moved.notes,
      entries: preview.moved.entries,
      others: preview.moved.items - preview.moved.notes,
    });
    body = (
      <>
        {refusal !== undefined && (
          <Callout tone="danger" isAnnounced>
            {refusal}
          </Callout>
        )}
        {preview.tooLarge && (
          <Callout tone="warning" isAnnounced>
            {strings.tooLarge}
          </Callout>
        )}
        {[strings.summary(merged, kept), moves, strings.cantUndo].filter((part) => part !== '').join(' ')}
        {preview.rows.length === 0
          ? strings.noRows
          : preview.rows.map((row) => {
              const definition = byId.get(row.attributeId);
              if (definition === undefined) return null;
              return (
                <RadioGroup
                  key={row.attributeId}
                  label={definition.title}
                  variant="cards"
                  value={picks[row.attributeId] ?? row.preselected}
                  isDisabled={pending}
                  onChange={(value) => {
                    setPicks((before) => ({ ...before, [row.attributeId]: value === 'merge' ? 'merge' : 'keep' }));
                  }}
                >
                  <Radio value="keep" preview={valueCard(definition, preview.keep)}>
                    {kept}
                  </Radio>
                  <Radio value="merge" preview={valueCard(definition, preview.merge)}>
                    {merged}
                  </Radio>
                </RadioGroup>
              );
            })}
      </>
    );
  }

  return (
    <Modal
      title={strings.title(object.singularName)}
      variant="form"
      isOpen={recordIds !== undefined}
      isBusy={pending}
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      {...(ready !== undefined && ready.rows.length > 0 ? { hint: strings.pickHint } : {})}
      {...(pair === undefined
        ? {}
        : {
            footerStart: (
              <Button
                variant="ghost"
                icon="arrow-left-right"
                aria-label={strings.swapLabel}
                isDisabled={pending || state.status !== 'ready'}
                onPress={() => {
                  setSwapped((value) => !value);
                  setPicks({});
                  setRefusal(undefined);
                }}
              >
                {strings.swap}
              </Button>
            ),
          })}
      actions={
        <>
          <Button slot="close" isDisabled={pending}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            icon="merge"
            isPending={pending}
            isDisabled={ready === undefined || ready.tooLarge}
            onPress={merge}
          >
            {pending ? strings.merging : strings.merge}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
