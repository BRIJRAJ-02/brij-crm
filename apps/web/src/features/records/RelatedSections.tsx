// Brief
// Purpose: who and what is linked to this record on each side that holds many (a company's people and deals).
// Main task: scan a side's records and open one, add one (or create it when the search finds none), or remove one.
// Leaves out: editing the related records' own values, sorting or filtering a side, removing several at once.
import { type LinkChange, type LinkSection, type LinkSectionState, type RecordRefDisplay } from '@crm/data';
import { useLinkSection } from '@crm/data/react';
import {
  type RelatedRecord,
  RelatedRecords,
  type RelatedRecordsHandle,
  type RelatedRecordsPicker,
  sharedStrings,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, type Ref } from 'react';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import type { RelatedSide } from './details.ts';
import { useLinkEditing } from './links.ts';
import { useRecordForm } from './RecordForm.tsx';
import { strings } from './strings.ts';
import type { RecordLink } from './timeline.ts';

/** One related side with its section source, as the route loaded it. */
export interface RelatedSource extends RelatedSide {
  readonly section: LinkSection;
}

/** A section's rows as the library takes them: each with its record page. */
function rowsOf(items: LinkSectionState['items'], link: RecordLink): readonly RelatedRecord[] {
  return items.map((display) => {
    const href = link(display.objectId, display.recordId);
    return { display, ...(href === undefined ? {} : { href }) };
  });
}

/** The library's load status for a section's (an unavailable one draws nothing at all). */
const statusOf = (status: LinkSectionState['status']) => (status === 'unavailable' ? 'ready' : status);

/** A related record's name in a toast: "Unnamed person" for one with none. */
const nameOf = (side: RelatedSide, record: RelatedRecord) =>
  record.display.name === '' ? strings.unnamed(side.farObject.singularName) : record.display.name;

/** Props for the sidebar's related sections. */
export interface RelatedSectionsProps {
  readonly slug: string;
  readonly recordId: string;
  readonly related: readonly RelatedSource[];
  /** Whether the person may change this record's links (the object at `write`, the record live). */
  readonly canChange: boolean;
  readonly link: RecordLink;
  /** Each section's handle, by attribute id, so Overview's "View all" can move focus to it. */
  readonly handleRef?: (attributeId: string) => Ref<RelatedRecordsHandle>;
}

/** What a Remove takes out: one record from one side. */
interface Removing {
  readonly side: RelatedSide;
  readonly record: RelatedRecord;
}

/**
 * The record page's related sections (spec 0017, AC-375), after Details: one
 * per side that holds many, with Show more, Add and Remove. Remove acts at
 * once (only a link goes; the record stays), and once a Remove or an Add
 * lands, a toast says so with Undo (one click, or Cmd+Z): no confirm (owner,
 * 30 Oct: Undo over confirm).
 */
export function RelatedSections({ slug, recordId, related, canChange, link, handleRef }: RelatedSectionsProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // A far object that needs more than a name is made through its full form, opened from the picker.
  const recordForm = useRecordForm(slug);
  const links = useLinkEditing(slug, recordForm.open);

  /** Sends one delta; once it lands (and changed something) its toast says what happened, with Undo. */
  const send = (change: LinkChange, message: string): void => {
    data.links.change(slug, change).then(
      (outcome) => {
        // A refusal already said why, in the data layer's toast with Retry.
        if (outcome.kind !== 'done' || !outcome.changed) return;
        const { undoId } = outcome;
        toasts.toast({
          tone: 'success',
          message,
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
      },
      () => {
        toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
      },
    );
  };

  const remove = ({ side, record }: Removing) => {
    const paired = side.attribute.relationship?.pairedAttributeId;
    send(
      {
        kind: 'remove',
        recordId,
        attributeId: side.attribute.id,
        target: { objectId: record.display.objectId, recordId: record.display.recordId },
        isMulti: true,
        ...(paired === undefined ? {} : { pairedAttributeId: paired }),
      },
      strings.removed(nameOf(side, record), side.attribute.title),
    );
  };

  return (
    <>
      {related.map((side) => {
        const editable = canChange && side.attribute.readOnly === undefined;
        const search = editable ? links.pickerFor(side.attribute, recordId) : undefined;
        // "Create "<typed>"": made, then linked as an Add (its link waits for the record); one toast says both.
        const addMade = (display: RecordRefDisplay) => {
          const { change } = links.addFor(side.attribute, recordId, display);
          send(change, strings.createdLinked(nameOf(side, { display })));
        };
        const offer = search === undefined ? undefined : links.offerFor(side.attribute, addMade);
        const picker: RelatedRecordsPicker | undefined =
          search === undefined
            ? undefined
            : {
                onSearch: search.onSearch,
                describeResult: search.describeResult,
                ...(offer === undefined
                  ? {}
                  : {
                      onCreate: (label: string) => {
                        const made = offer.onCreate(label);
                        if (made !== undefined) addMade(made);
                      },
                      ...(offer.formNoun === undefined ? {} : { createFormNoun: offer.formNoun }),
                    }),
                onPick: (display) => {
                  const { change, movedFromName } = links.addFor(side.attribute, recordId, display);
                  const name = nameOf(side, { display });
                  send(
                    change,
                    movedFromName === undefined
                      ? strings.added(name, side.attribute.title)
                      : strings.moved(name, side.attribute.title, movedFromName),
                  );
                },
              };
        return (
          <RelatedSection
            key={side.attribute.id}
            side={side}
            link={link}
            {...(handleRef === undefined ? {} : { handle: handleRef(side.attribute.id) })}
            {...(picker === undefined ? {} : { picker })}
            {...(editable
              ? {
                  onRemove: (record: RelatedRecord) => {
                    remove({ side, record });
                  },
                }
              : {})}
          />
        );
      })}
      {recordForm.dialog}
    </>
  );
}

/** One side's section: absent once the side is out of reach (hidden means absent). */
function RelatedSection({
  side,
  link,
  handle,
  picker,
  onRemove,
}: {
  readonly side: RelatedSource;
  readonly link: RecordLink;
  readonly handle?: Ref<RelatedRecordsHandle>;
  readonly picker?: RelatedRecordsPicker;
  readonly onRemove?: (record: RelatedRecord) => void;
}) {
  const state = useLinkSection(side.section);
  // The same rows until the section changes, so the list draws (and keeps track of focus) only then.
  const records = useMemo(() => rowsOf(state.items, link), [state.items, link]);
  if (state.status === 'unavailable') return null;
  const reason = side.attribute.readOnly?.reason;
  return (
    <RelatedRecords
      id={`related-${side.attribute.id}`}
      {...(handle === undefined ? {} : { ref: handle })}
      title={side.attribute.title}
      noun={strings.relatedNoun(side.farObject.pluralName)}
      records={records}
      {...(state.total === undefined ? {} : { total: state.total })}
      status={statusOf(state.status)}
      onRetry={side.section.retry}
      hasMore={state.hasMore}
      isLoadingMore={state.isLoadingMore}
      isMoreFailed={state.status === 'ready' && state.error !== undefined}
      onShowMore={side.section.showMore}
      {...(picker === undefined ? {} : { picker })}
      {...(onRemove === undefined ? {} : { onRemove })}
      {...(reason === undefined ? {} : { readOnlyReason: reason })}
    />
  );
}
