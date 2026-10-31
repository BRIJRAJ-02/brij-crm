// Brief
// Purpose: merge two records of one object into one (spec 0049, AC-4910 to AC-4917).
// Main task: see both side by side, pick the value to keep where they differ, read what moves, then Merge.
// Leaves out: finding likely pairs (the duplicates page and banner, spec 0049 tasks 5 to 7, open this same dialog
// with both ids), undo (a merge can't be undone, so this dialog is its confirmation), and any optimistic change.
import {
  isDataError,
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
  focusLater,
  Modal,
  Radio,
  RadioGroup,
  Skeleton,
  type FieldAttribute,
  type ListSource,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** The dialog closed without a merge (Cancel, Esc, Close). */
  readonly onCancel?: (() => void) | undefined;
}

/** An answer to one read, keyed by the pair and attempt it was for. */
type Answer =
  | { readonly key: string; readonly status: 'ready'; readonly preview: MergePreview }
  | { readonly key: string; readonly status: 'failed'; readonly message: string; readonly canRetry: boolean };

const PICKER: FieldAttribute = {
  id: 'merge-other-record',
  name: strings.pickerLabel,
  type: 'record_reference',
  allowMultiple: false,
  cardinality: 'one',
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

/** A record's name, or "Unnamed <object>". */
const nameOf = (view: RecordView, unnamed: string) => (view.display.name === '' ? unnamed : view.display.name);

/** A search's results without one record (the one being merged): it can't merge with itself. */
function without(source: ListSource<RecordRefDisplay>, recordId: string): ListSource<RecordRefDisplay> {
  const items = Array.from({ length: source.count }, (_, index) => source.getItem(index));
  if (items.some((item) => item === undefined)) return source;
  return arraySource(
    items.filter((item): item is RecordRefDisplay => item !== undefined && item.recordId !== recordId),
    source.getKey,
  );
}

/** Picks seen from the other side: after Swap, what was kept is merged away, so each choice flips. */
const flipped = (picks: Readonly<Record<string, MergeSide>>): Readonly<Record<string, MergeSide>> =>
  Object.fromEntries(Object.entries(picks).map(([id, side]) => [id, side === 'keep' ? 'merge' : 'keep']));

/** The open dialog's first choice, else its first focusable control in the body: where focus goes once it reads. */
const firstChoice = () =>
  document.querySelector<HTMLElement>('[role="dialog"] input[type="radio"]') ??
  document.querySelector<HTMLElement>('[role="dialog"] [role="alert"], [role="dialog"] [role="status"]');

/**
 * The merge dialog (AC-4910, AC-4916): asks for the other record when it was opened with one, then shows both
 * side by side, a row for each attribute they hold differently that the reader may change, preselected to the
 * kept record's value, with Swap to keep the other. Merge waits for the server (not optimistic, AC-4916), and a
 * refusal stays in the dialog, a changed record reading both again. While a read is out the last answer stays on
 * screen (its choices off), so focus never falls out of the dialog.
 */
export function MergeDialog({
  slug,
  object,
  attributes,
  members,
  recordIds,
  onClose,
  onMerged,
  onCancel,
}: MergeDialogProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [picked, setPicked] = useState<RecordRefDisplay | undefined>(undefined);
  const [pickError, setPickError] = useState<string | undefined>(undefined);
  const [swapped, setSwapped] = useState(false);
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  const [picks, setPicks] = useState<Readonly<Record<string, MergeSide>>>({});
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const search = useRecordSearch(slug, object.id);
  const unnamed = strings.unnamed(object.singularName);

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
        const coded = isDataError(error);
        const message = coded && error.message !== '' ? error.message : strings.loadFailed;
        // A refusal (gone, not allowed, not mergeable) won't change on a retry; the network might.
        const canRetry = !coded || error.code === 'INTERNAL' || error.code === 'API_UNAVAILABLE';
        if (current) setAnswer({ key: readKey, status: 'failed', message, canRetry });
      },
    );
    return () => {
      current = false;
    };
  }, [data, slug, object.id, keepId, mergeId, readKey]);
  // The last answer stays while a newer read is out (Swap, a re-read after a conflict): busy, never blank.
  const shown = pair === undefined ? undefined : answer;
  const isRereading = shown !== undefined && shown.key !== readKey;
  const ready = shown?.status === 'ready' && !isRereading ? shown.preview : undefined;

  // The first answer after the dialog opened or a pick: focus to its first choice (the picker that had it is gone).
  const hasFocused = useRef(false);
  useEffect(() => {
    if (shown === undefined || hasFocused.current) return;
    hasFocused.current = true;
    focusLater(firstChoice);
  }, [shown]);

  const byId = useMemo(() => new Map(attributes.map((definition) => [definition.id, definition])), [attributes]);
  const actors = useMemo(() => toActorDisplays(members), [members]);

  const reset = () => {
    setPicked(undefined);
    setPickError(undefined);
    setSwapped(false);
    setPicks({});
    setRefusal(undefined);
    setAnswer(undefined);
    hasFocused.current = false;
  };
  const close = () => {
    if (pending) return;
    reset();
    onClose();
    onCancel?.();
  };

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
        const keptName = outcome.keptName === '' ? unnamed : outcome.keptName;
        toasts.toast({ tone: 'success', message: strings.merged(keptName) });
        reset();
        onClose();
        onMerged?.({ keptId: pair.keepId, keptName, mergedId: pair.mergeId });
      });
  };

  const displayOf = (definition: AttributeDefinition, value: unknown, preview: MergePreview) => {
    if (definition.type === 'actor_reference') return actors;
    if (definition.type !== 'record_reference') return undefined;
    const ids = (Array.isArray(value) ? (value as readonly unknown[]) : [value]).flatMap((item) => {
      const ref = refOf(item);
      return ref === undefined ? [] : [ref.recordId];
    });
    return preview.displays.filter((display) => ids.includes(display.recordId));
  };

  const valueCard = (definition: AttributeDefinition, view: RecordView, preview: MergePreview) => {
    const value = view.values[definition.id] ?? null;
    const display = displayOf(definition, value, preview);
    return (
      <AttributeDisplay
        attribute={toFieldAttribute(definition)}
        value={value}
        surface="preview"
        {...(display === undefined ? {} : { display })}
      />
    );
  };

  let content;
  if (pair === undefined) {
    content = (
      <AttributeEditor
        attribute={PICKER}
        value={null}
        surface="form"
        autoOpen
        onSearch={editorSearch((query) => without(search.onSearch(query), first ?? ''))}
        onCommit={(value) => {
          const ref = refOf(value);
          if (ref === undefined) return;
          if (ref.recordId === first) {
            setPickError(strings.pickAnother);
            return;
          }
          setPickError(undefined);
          setPicked(search.displayOf(ref.recordId) ?? { ...ref, name: '', kind: 'other' });
        }}
        {...(pickError !== undefined ? { error: pickError } : search.failed ? { error: strings.searchFailed } : {})}
      />
    );
  } else if (shown === undefined) {
    content = <Skeleton shape="text" lines={4} />;
  } else if (shown.status === 'failed') {
    content = (
      <Callout
        tone="danger"
        isAnnounced
        {...(shown.canRetry
          ? {
              actions: (
                <Button
                  onPress={() => {
                    setAttempt((count) => count + 1);
                  }}
                >
                  {strings.tryAgain}
                </Button>
              ),
            }
          : {})}
      >
        {shown.message}
      </Callout>
    );
  } else {
    const { preview } = shown;
    const kept = nameOf(preview.keep, unnamed);
    const merged = nameOf(preview.merge, unnamed);
    const moves = strings.moves({
      links: preview.moved.links,
      notes: preview.moved.notes,
      entries: preview.moved.entries,
      others: preview.moved.items - preview.moved.notes,
    });
    content = (
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
        <Callout tone="warning">
          {[kept === merged ? strings.summarySameName(kept) : strings.summary(merged, kept), moves, strings.cantUndo]
            .filter((part) => part !== '')
            .join(' ')}
        </Callout>
        {preview.rows.length === 0 ? strings.noRows : strings.pickHint}
        {preview.rows.map((row) => {
          const definition = byId.get(row.attributeId);
          if (definition === undefined) return null;
          return (
            <RadioGroup
              key={row.attributeId}
              label={definition.title}
              variant="cards"
              value={picks[row.attributeId] ?? row.preselected}
              isDisabled={pending || isRereading}
              onChange={(value) => {
                setPicks((before) => ({ ...before, [row.attributeId]: value === 'merge' ? 'merge' : 'keep' }));
              }}
            >
              <Radio value="keep" preview={valueCard(definition, preview.keep, preview)}>
                {strings.keptSide(kept)}
              </Radio>
              <Radio value="merge" preview={valueCard(definition, preview.merge, preview)}>
                {strings.mergedSide(merged)}
              </Radio>
            </RadioGroup>
          );
        })}
      </>
    );
  }

  const isLoading = pair !== undefined && (shown === undefined || isRereading);
  return (
    <Modal
      title={strings.title(object.pluralName)}
      variant="window"
      icon="layers"
      isOpen={recordIds !== undefined}
      isBusy={pending}
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      {...(isLoading ? { status: strings.loading } : {})}
      {...(pair === undefined
        ? {}
        : {
            footerStart: (
              <Button
                variant="ghost"
                icon="arrow-left-right"
                label={strings.swapLabel}
                isDisabled={pending}
                onPress={() => {
                  // Held while a read is out, without turning the focused button off (focus would leave the dialog).
                  if (isRereading || shown?.status !== 'ready') return;
                  setSwapped((value) => !value);
                  setPicks(flipped);
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
            icon="layers"
            isPending={pending}
            isDisabled={pair === undefined || shown?.status === 'failed' || (ready?.tooLarge ?? false)}
            onPress={merge}
          >
            {pending ? strings.merging : strings.merge}
          </Button>
        </>
      }
    >
      {content}
    </Modal>
  );
}
