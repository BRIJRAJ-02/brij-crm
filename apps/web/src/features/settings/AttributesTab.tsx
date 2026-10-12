// Brief
// Purpose: an object's attributes in settings: its own by position, the system ones, and the archived ones.
// Main task: owners and admins add, edit, move (drag, or Move up and down), archive and restore attributes.
// Leaves out: options and type settings (spec 0012, milestone 3), groups (#18), and the schema map (#56).
import { isDataError, type AttributeDefinition, type MemberSummary, type ObjectSummary, type Usage } from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  Card,
  Disclosure,
  EmptyState,
  fieldTypeOf,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Meter,
  SettingsStack,
  Skeleton,
  Table,
  typeLabelOf,
  type TableColumn,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { ArchiveAttributeDialog } from './ArchiveAttributeDialog.tsx';
import { AttributeDialog } from './AttributeDialog.tsx';
import { strings } from './attribute-strings.ts';

/** Props for the Attributes tab: what its route loaded through the data layer. */
export interface AttributesTabProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** Every attribute of the object, archived ones too, by position. */
  readonly attributes: readonly AttributeDefinition[];
  /** Every object the person can see (archived ones too), for an archived reference's reason. */
  readonly objects: readonly ObjectSummary[];
  /** The usage, or undefined when it could not be read (the meter stays a skeleton). */
  readonly usage: Usage | undefined;
  readonly members: readonly MemberSummary[];
  /** `?attribute=<id>`: the attribute whose dialog is open (AC-231). */
  readonly selectedId: string | undefined;
  /** Opens an attribute's dialog (sets the param), or closes it (removes it; `replace` for one that names nothing). */
  readonly onSelect: (attributeId: string | undefined, replace?: boolean) => void;
  /** New attribute, from the page's header. */
  readonly isCreating: boolean;
  readonly onCreatingChange: (isCreating: boolean) => void;
  /** A move waits for the server (definition writes are never optimistic): the page's header says so. */
  readonly onMovingChange: (isMoving: boolean) => void;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: strings.titleColumn, isRowHeader: true, isInline: true },
  { id: 'type', label: strings.typeColumn },
  { id: 'rules', label: strings.rulesColumn, isInline: true },
  { id: 'actions', label: strings.actionsColumn, isLabelHidden: true, align: 'end' },
];

/** The system attributes have no rules or actions: their name and type alone. */
const SYSTEM_COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: strings.titleColumn, isRowHeader: true, isInline: true },
  { id: 'type', label: strings.typeColumn },
];

/** The server's words for a failure, or the plain fallback. */
const why = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** Names one or two ends for a toast: "Company" or "Company and Team". */
const titlesOf = (ends: readonly AttributeDefinition[]) => {
  const [first, second] = ends;
  if (first === undefined) return '';
  return second === undefined ? first.title : strings.both(first.title, second.title);
};

/** An attribute's type icon and title. */
function AttributeName({ attribute }: { readonly attribute: AttributeDefinition }) {
  return (
    <>
      <Icon name={fieldTypeOf(attribute.type).icon} size="sm" tone="muted" />
      {attribute.title}
    </>
  );
}

/** Its rules as badges (AC-227): Primary, Required, Unique and Default. */
function AttributeRules({ attribute }: { readonly attribute: AttributeDefinition }) {
  return (
    <>
      {attribute.isPrimary && <Badge text={strings.primary} />}
      {attribute.isRequired && <Badge text={strings.required} />}
      {attribute.isUnique && <Badge text={strings.unique} />}
      {attribute.defaultValue !== undefined && <Badge text={strings.hasDefault} />}
    </>
  );
}

/**
 * The Attributes tab (spec 0012, AC-227): the meter, the object's own
 * attributes by position (moved by drag or the row menu), the system ones
 * read only in a sunken card, and the archived ones with Restore. A row opens
 * the attribute's dialog, and `?attribute=<id>` opens it from a link.
 */
export function AttributesTab({
  slug,
  object,
  attributes,
  objects,
  usage,
  members,
  selectedId,
  onSelect,
  isCreating,
  onCreatingChange,
  onMovingChange,
}: AttributesTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // Only owners and admins change the schema (spec 0009, AC-136); the server refuses anyone else on its own.
  const canManage = useCan('schema.manage');
  const { own, live, archived, system } = useMemo(() => {
    const ordered = [...attributes].sort((a, b) => a.position - b.position);
    const mine = ordered.filter((attribute) => !attribute.isSystem);
    return {
      own: mine,
      live: mine.filter((attribute) => !attribute.isArchived),
      archived: mine.filter((attribute) => attribute.isArchived),
      system: ordered.filter((attribute) => attribute.isSystem),
    };
  }, [attributes]);
  // By id, read from the attributes held: one archived or changed elsewhere meanwhile shows as it is now.
  const [archivingId, setArchiving] = useState<string | undefined>(undefined);
  const archiving = live.find((attribute) => attribute.id === archivingId);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [isMoving, setMovingHere] = useState(false);
  // The page's header says a move is under way, so nothing above the table shifts while it waits.
  const setMoving = (moving: boolean) => {
    setMovingHere(moving);
    onMovingChange(moving);
  };

  // `?attribute=<id>`: an attribute of this object the person can see, live or system, opens its dialog; anything
  // else clears the param and opens nothing (AC-231).
  const selected = attributes.find((attribute) => attribute.id === selectedId && !attribute.isArchived);
  useEffect(() => {
    if (selectedId !== undefined && selected === undefined) onSelect(undefined, true);
  }, [selectedId, selected, onSelect]);

  /** Moves an attribute to `index` among the object's own attributes (archived ones keep their places). */
  const moveTo = (attribute: AttributeDefinition, index: number) => {
    if (isMoving || index === own.indexOf(attribute)) return;
    setMoving(true);
    data.attributes.reorder(slug, attribute.id, index).then(
      (next) => {
        setMoving(false);
        const order = next.filter((each) => !each.isSystem && !each.isArchived);
        const place = order.findIndex((each) => each.id === attribute.id) + 1;
        toasts.toast({ tone: 'success', message: strings.moved(attribute.title, place, order.length) });
      },
      (error: unknown) => {
        setMoving(false);
        toasts.toast({ tone: 'danger', message: strings.moveFailed(attribute.title, why(error)) });
      },
    );
  };

  /** Move up or down past the next live attribute, which is where the row visibly goes. */
  const step = (attribute: AttributeDefinition, direction: -1 | 1) => {
    const neighbour = live[live.indexOf(attribute) + direction];
    if (neighbour !== undefined) moveTo(attribute, own.indexOf(neighbour));
  };

  const restore = (attribute: AttributeDefinition) => {
    if (restoring !== undefined) return;
    setRestoring(attribute.id);
    data.attributes.restore(slug, attribute.id).then(
      (ends) => {
        setRestoring(undefined);
        toasts.toast({ tone: 'success', message: strings.restored(titlesOf(ends)) });
        focusTitle();
      },
      (error: unknown) => {
        setRestoring(undefined);
        toasts.toast({ tone: 'danger', message: strings.restoreFailed(attribute.title, why(error)) });
      },
    );
  };

  const liveCell = (attribute: AttributeDefinition, column: string) => {
    switch (column) {
      case 'title':
        return <AttributeName attribute={attribute} />;
      case 'type':
        return typeLabelOf(attribute.type);
      case 'rules':
        return <AttributeRules attribute={attribute} />;
      default: {
        // Members get the row and its badges only; the row opens the attribute read only (spec 0012, screens).
        if (!canManage) return null;
        const at = live.indexOf(attribute);
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.rowActions(attribute.title)} />
            <Menu
              label={strings.rowActions(attribute.title)}
              onAction={(key) => {
                if (key === 'edit') onSelect(attribute.id);
                if (key === 'up') step(attribute, -1);
                if (key === 'down') step(attribute, 1);
                if (key === 'archive') setArchiving(attribute.id);
              }}
            >
              <MenuItem id="edit" icon="pencil">
                {strings.edit}
              </MenuItem>
              <MenuItem id="up" icon="chevron-up" isDisabled={at <= 0 || isMoving}>
                {strings.moveUp}
              </MenuItem>
              <MenuItem id="down" icon="chevron-down" isDisabled={at >= live.length - 1 || isMoving}>
                {strings.moveDown}
              </MenuItem>
              {/* The name every record goes by never archives. */}
              {!attribute.isPrimary && (
                <>
                  <MenuSeparator />
                  <MenuItem id="archive" icon="archive" isDanger>
                    {strings.archive}
                  </MenuItem>
                </>
              )}
            </Menu>
          </MenuTrigger>
        );
      }
    }
  };

  /** Why an attribute archived by its object can't be restored on its own (AC-226). */
  const archivedByReason = (attribute: AttributeDefinition) => {
    const far = objects.find((each) => each.id === attribute.archivedBy?.objectId);
    return far === undefined ? strings.archivedByHidden : strings.archivedBy(far.pluralName);
  };

  const archivedCell = (attribute: AttributeDefinition, column: string) => {
    switch (column) {
      case 'title':
        return <AttributeName attribute={attribute} />;
      case 'type':
        return typeLabelOf(attribute.type);
      case 'rules':
        // Archived because the object at its relationship's other end is: the reason, and no Restore of its own.
        return isOwnArchive(attribute) ? <AttributeRules attribute={attribute} /> : archivedByReason(attribute);
      default:
        return canManage && isOwnArchive(attribute) ? (
          <Button
            variant="ghost"
            icon="archive-restore"
            isPending={restoring === attribute.id}
            onPress={() => {
              restore(attribute);
            }}
          >
            {restoring === attribute.id ? strings.restoring : strings.restore}
          </Button>
        ) : null;
    }
  };

  const systemCell = (attribute: AttributeDefinition, column: string) => {
    switch (column) {
      case 'title':
        return <AttributeName attribute={attribute} />;
      case 'type':
        return typeLabelOf(attribute.type);
      default:
        return null;
    }
  };

  const liveTable = {
    label: strings.attributes,
    columns: COLUMNS,
    rows: live,
    getRowId: (attribute: AttributeDefinition) => attribute.id,
    renderCell: liveCell,
    onRowAction: (id: string) => {
      onSelect(id);
    },
    emptyState: (
      <EmptyState title={strings.noAttributes}>
        {canManage ? strings.noAttributesText : strings.noAttributesMemberText}
      </EmptyState>
    ),
  };
  const meter = usage?.attributes[object.id];
  return (
    <SettingsStack>
      {canManage &&
        (meter === undefined ? (
          <Skeleton width="long" />
        ) : (
          <Meter label={strings.attributeLimit} value={meter.used} maxValue={meter.limit} />
        ))}
      {!canManage && <Callout>{strings.readOnlyNote}</Callout>}
      {canManage ? (
        <Table
          {...liveTable}
          getRowLabel={(attribute) => attribute.title}
          onReorder={(id, targetId, position) => {
            const attribute = own.find((each) => each.id === id);
            const target = own.find((each) => each.id === targetId);
            if (attribute === undefined || target === undefined) return;
            const rest = own.filter((each) => each.id !== id);
            moveTo(attribute, rest.indexOf(target) + (position === 'after' ? 1 : 0));
          }}
        />
      ) : (
        <Table {...liveTable} />
      )}
      <Card title={strings.system} tone="sunken">
        <Table
          label={strings.system}
          columns={SYSTEM_COLUMNS}
          rows={system}
          getRowId={(attribute) => attribute.id}
          renderCell={systemCell}
          onRowAction={(id) => {
            onSelect(id);
          }}
        />
      </Card>
      <Disclosure title={strings.archived} count={archived.length}>
        {archived.length === 0 ? (
          <EmptyState title={strings.noArchived}>{strings.noArchivedText}</EmptyState>
        ) : (
          <Table
            label={strings.archivedAttributes}
            columns={COLUMNS}
            rows={archived}
            getRowId={(attribute) => attribute.id}
            renderCell={archivedCell}
          />
        )}
      </Disclosure>
      <AttributeDialog
        slug={slug}
        objectId={object.id}
        isOpen={isCreating || selected !== undefined}
        attribute={isCreating ? undefined : selected}
        members={members}
        canManage={canManage}
        onClose={() => {
          if (isCreating) onCreatingChange(false);
          else onSelect(undefined);
        }}
        onSaved={(saved, isNew) => {
          if (isNew) onCreatingChange(false);
          else onSelect(undefined);
          toasts.toast({ tone: 'success', message: isNew ? strings.created(saved.title) : strings.saved(saved.title) });
        }}
      />
      <ArchiveAttributeDialog
        slug={slug}
        attribute={archiving}
        onClose={() => {
          setArchiving(undefined);
        }}
        onArchived={(ends) => {
          setArchiving(undefined);
          toasts.toast({ tone: 'success', message: strings.archivedToast(titlesOf(ends)) });
          // Its row left the live table, and the menu that opened the confirm with it.
          focusTitle();
        }}
      />
    </SettingsStack>
  );
}

/** Archived by its own row (it has Restore), not only because the object at its other end is archived. */
function isOwnArchive(attribute: AttributeDefinition): boolean {
  return attribute.isArchived && attribute.archivedBy === undefined;
}
