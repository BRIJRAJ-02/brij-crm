// Brief
// Purpose: who and what is linked to this record on each side that holds many (a company's people and deals).
// Main task: scan a side's records and open one, add one, or remove one, from the record itself.
// Leaves out: editing the related records' own values, sorting or filtering a side, removing several at once.
import { RELATED_PREVIEW, type LinkChange, type LinkSection } from '@crm/data';
import { useLinkSection } from '@crm/data/react';
import { Button, Card, Modal, RelatedRecords, type RelatedRecord, type RelatedRecordsHandle } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState, type Ref } from 'react';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import type { RelatedSide } from './details.ts';
import { useLinkEditing } from './links.ts';
import { strings } from './strings.ts';
import type { RecordLink } from './timeline.ts';

/** One related side with its section source, as the route loaded it. */
export interface RelatedSource extends RelatedSide {
  readonly section: LinkSection;
}

/** A section's rows as the library takes them: each with its record page. */
function rowsOf(items: ReturnType<typeof useLinkSection>['items'], link: RecordLink): readonly RelatedRecord[] {
  return items.map((display) => {
    const href = link(display.objectId, display.recordId);
    return { display, ...(href === undefined ? {} : { href }) };
  });
}

/** The library's load status for a section's. */
const statusOf = (status: ReturnType<typeof useLinkSection>['status']) => (status === 'unavailable' ? 'ready' : status);

/** Props for the sidebar's related sections. */
export interface RelatedSectionsProps {
  readonly slug: string;
  readonly recordId: string;
  /** The record's name, for Remove's confirm ("only its link to Northwind Traders goes"). */
  readonly recordName: string;
  readonly related: readonly RelatedSource[];
  /** Whether the person may change this record's links (the object at `write`, the record live). */
  readonly canChange: boolean;
  readonly link: RecordLink;
  /** Each section's handle, by attribute id, so Overview's "View all" can move focus to it. */
  readonly handleRef?: (attributeId: string) => Ref<RelatedRecordsHandle>;
}

/**
 * The record page's related sections (spec 0017, AC-375), after Details: one
 * per side that holds many, with Show more, Add and Remove. Remove asks
 * first; once it lands a toast says so with Undo (one click, or Cmd+Z).
 */
export function RelatedSections({
  slug,
  recordId,
  recordName,
  related,
  canChange,
  link,
  handleRef,
}: RelatedSectionsProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const links = useLinkEditing(slug);
  const [asking, setAsking] = useState<{ readonly side: RelatedSide; readonly record: RelatedRecord }>();
  const nameOf = (record: RelatedRecord) => (record.display.name === '' ? strings.unnamedRelated : record.display.name);

  const send = (change: LinkChange, done?: (undoId: string | undefined) => void) => {
    data.links.change(slug, change).then(
      (outcome) => {
        // A refusal already said why, in the data layer's toast with Retry.
        if (outcome.kind === 'done' && outcome.changed) done?.(outcome.undoId);
      },
      () => {
        toasts.toast({ tone: 'danger', message: workspaceStrings.somethingWrong });
      },
    );
  };

  const remove = (side: RelatedSide, record: RelatedRecord) => {
    const paired = side.attribute.relationship?.pairedAttributeId;
    const name = nameOf(record);
    send(
      {
        kind: 'remove',
        recordId,
        attributeId: side.attribute.id,
        target: { objectId: record.display.objectId, recordId: record.display.recordId },
        isMulti: true,
        ...(paired === undefined ? {} : { pairedAttributeId: paired }),
      },
      (undoId) => {
        toasts.toast({
          tone: 'success',
          message: strings.removed(name, side.attribute.title),
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
    );
  };

  return (
    <>
      {related.map((side) => {
        const editable = canChange && side.attribute.readOnly === undefined;
        const picker = editable ? links.pickerFor(side.attribute, recordId) : undefined;
        return (
          <RelatedSection
            key={side.attribute.id}
            side={side}
            link={link}
            {...(handleRef === undefined ? {} : { handle: handleRef(side.attribute.id) })}
            {...(picker === undefined
              ? {}
              : {
                  picker: {
                    ...picker,
                    onPick: (display) => {
                      send(links.addFor(side.attribute, recordId, display));
                    },
                  },
                })}
            {...(editable
              ? {
                  onRemove: (record: RelatedRecord) => {
                    setAsking({ side, record });
                  },
                }
              : {})}
          />
        );
      })}
      <Modal
        title={asking === undefined ? '' : strings.removeTitle(nameOf(asking.record), asking.side.attribute.title)}
        tone="danger"
        isOpen={asking !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAsking(undefined);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              icon="x"
              onPress={() => {
                const confirmed = asking;
                setAsking(undefined);
                if (confirmed !== undefined) remove(confirmed.side, confirmed.record);
              }}
            >
              {strings.removeAction}
            </Button>
          </>
        }
      >
        {asking === undefined ? '' : strings.removeText(nameOf(asking.record), recordName)}
      </Modal>
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
  readonly picker?: Parameters<typeof RelatedRecords>[0]['picker'];
  readonly onRemove?: (record: RelatedRecord) => void;
}) {
  const state = useLinkSection(side.section);
  if (state.status === 'unavailable') return null;
  return (
    <RelatedRecords
      id={`related-${side.attribute.id}`}
      {...(handle === undefined ? {} : { ref: handle })}
      title={side.attribute.title}
      noun={strings.relatedNoun(side.farObject.pluralName)}
      records={rowsOf(state.items, link)}
      {...(state.total === undefined ? {} : { total: state.total })}
      status={statusOf(state.status)}
      onRetry={side.section.retry}
      hasMore={state.hasMore}
      isLoadingMore={state.isLoadingMore}
      isMoreFailed={state.status === 'ready' && state.error !== undefined}
      onShowMore={side.section.showMore}
      {...(picker === undefined ? {} : { picker })}
      {...(onRemove === undefined ? {} : { onRemove })}
    />
  );
}

/** Props for Overview's Related cards. */
export interface RelatedCardsProps {
  readonly related: readonly RelatedSource[];
  readonly link: RecordLink;
  /** "View all <N>": moves focus to that side's section in the sidebar. */
  readonly onViewAll: (attributeId: string) => void;
}

/**
 * Overview's Related cards (spec 0017, AC-383): one Card per side that holds
 * many, its first five records and "View all <N>", sharing the sidebar
 * section's source (one read). Each has its own loading and failed state.
 */
export function RelatedCards({ related, link, onViewAll }: RelatedCardsProps) {
  return related.map((side) => (
    <RelatedCard
      key={side.attribute.id}
      side={side}
      link={link}
      onViewAll={() => {
        onViewAll(side.attribute.id);
      }}
    />
  ));
}

function RelatedCard({
  side,
  link,
  onViewAll,
}: {
  readonly side: RelatedSource;
  readonly link: RecordLink;
  readonly onViewAll: () => void;
}) {
  const state = useLinkSection(side.section);
  if (state.status === 'unavailable') return null;
  return (
    <Card title={side.attribute.title} isBusy={state.status === 'loading'}>
      <RelatedRecords
        title={side.attribute.title}
        noun={strings.relatedNoun(side.farObject.pluralName)}
        records={rowsOf(state.items, link)}
        {...(state.total === undefined ? {} : { total: state.total })}
        status={statusOf(state.status)}
        onRetry={side.section.retry}
        limit={RELATED_PREVIEW}
        onViewAll={onViewAll}
      />
    </Card>
  );
}
