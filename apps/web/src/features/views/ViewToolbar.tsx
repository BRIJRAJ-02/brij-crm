// Brief
// Purpose: say how the view is shaped (its sorts and filters) and change it, as an unsaved draft until Save.
// Main task: open the sort or filter builder from its chip or button, then Save or Discard the draft.
// Leaves out: the view switcher, columns and view settings (the view bar, milestone 2).
import {
  FILTER_EDIT_MS,
  toFieldAttribute,
  type ActorDisplay,
  type AttributeDefinition,
  type DraftQuery,
  type FilterGroup,
} from '@crm/data';
import {
  arraySource,
  Button,
  completeFilters,
  ConditionChip,
  conditionOn,
  FilterBuilder,
  Popover,
  SortBuilder,
  SortChip,
  Toolbar,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { strings } from './strings.ts';

const NO_FILTER: FilterGroup = { conjunction: 'and', conditions: [] };

/** A filter without its operands: two that differ only by what was typed are the same shape. */
function shapeOf(group: FilterGroup): string {
  return JSON.stringify(group, (key, value: unknown) =>
    key === 'value' || key === 'values' || key === 'from' || key === 'to' || key === 'range' ? null : value,
  );
}

/** Props for the view's Toolbar. */
export interface ViewToolbarProps {
  /** The query shown: the draft or the saved one. */
  readonly query: DraftQuery;
  /** The filter that runs (what the chips state). */
  readonly filter: FilterGroup | undefined;
  /** The object's live attributes. */
  readonly attributes: readonly AttributeDefinition[];
  /** The ones a view may sort by. */
  readonly sortable: readonly AttributeDefinition[];
  readonly members: readonly ActorDisplay[];
  /** The person, for "is me". */
  readonly me: ActorDisplay | undefined;
  readonly isDraft: boolean;
  /** False on a locked view the person may not change: the draft stays theirs, unsaved. */
  readonly canSave: boolean;
  readonly isSaving: boolean;
  readonly onChange: (next: DraftQuery, how: 'push' | 'replace') => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
  /** A column's Filter: the builder opens with a new condition on it (none for an empty id). A new object each time it is asked. */
  readonly filterOn?: { readonly attributeId: string };
}

/** The view's Toolbar: the sort chip, a chip per filter, Filter, and while there is a draft Discard and Save. */
export function ViewToolbar({
  query,
  filter,
  attributes,
  sortable,
  members,
  me,
  isDraft,
  canSave,
  isSaving,
  onChange,
  onDiscard,
  onSave,
  filterOn,
}: ViewToolbarProps) {
  const fields = useMemo(() => attributes.map((attribute) => toFieldAttribute(attribute)), [attributes]);
  const sortFields = useMemo(() => sortable.map((attribute) => toFieldAttribute(attribute)), [sortable]);
  const titleOf = (id: string) => attributes.find((attribute) => attribute.id === id)?.title ?? id;
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const sortAnchor = useRef<HTMLButtonElement>(null);
  const [isSortOpen, setSortOpen] = useState(false);
  const [isFilterOpen, setFilterOpen] = useState(false);
  // What the builder holds while it is open: incomplete rows included, which filter nothing until complete.
  const [building, setBuilding] = useState<FilterGroup>(NO_FILTER);
  // The first change of a Popover adds a history entry; the rest replace it, so back steps through Popovers.
  const pushed = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastShape = useRef('');

  const commit = (next: DraftQuery) => {
    onChange(next, pushed.current ? 'replace' : 'push');
    pushed.current = true;
  };
  const commitFilter = (group: FilterGroup) => {
    const complete = completeFilters(group);
    commit({ ...(complete.conditions.length === 0 ? {} : { filter: complete }), sorts: query.sorts });
  };
  const flush = () => {
    if (pending.current === undefined) return;
    clearTimeout(pending.current);
    pending.current = undefined;
    commitFilter(building);
  };
  useEffect(
    () => () => {
      clearTimeout(pending.current);
    },
    [],
  );

  const openFilter = (start: FilterGroup) => {
    pushed.current = false;
    lastShape.current = shapeOf(start);
    setBuilding(start);
    setFilterOpen(true);
  };
  // A column's Filter (spec 0020): the builder opens with a condition on that column, once per request. The
  // request comes from outside the toolbar (the grid's column menu), so it is answered after the render.
  useEffect(() => {
    if (filterOn === undefined) return;
    const current = filter ?? NO_FILTER;
    const field = fields.find((each) => each.id === filterOn.attributeId);
    // No column named (an empty table's Edit filters): the builder opens as it stands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openFilter(field === undefined ? current : { ...current, conditions: [...current.conditions, conditionOn(field)] });
    // Only a new request opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOn]);

  const [first, ...rest] = query.sorts;
  const editorProps = (attribute: { readonly type: string }) =>
    attribute.type === 'actor_reference'
      ? {
          onSearch: () => arraySource(members, (member) => member.id ?? member.name),
          ...(me === undefined ? {} : { me }),
        }
      : {};
  const displayOf = (attributeId: string) =>
    attributes.find((attribute) => attribute.id === attributeId)?.type === 'actor_reference' ? members : undefined;

  return (
    <>
      <Toolbar
        label={strings.toolbar}
        {...(isDraft
          ? {
              end: (
                <>
                  <Button variant="ghost" onPress={onDiscard} isDisabled={isSaving}>
                    {strings.discard}
                  </Button>
                  {canSave && (
                    <Button variant="primary" onPress={onSave} isPending={isSaving}>
                      {isSaving ? strings.saving : strings.save}
                    </Button>
                  )}
                </>
              ),
            }
          : {})}
      >
        {first === undefined ? (
          <Button
            ref={sortAnchor}
            variant="dashed"
            icon="arrow-up-narrow-wide"
            onPress={() => {
              pushed.current = false;
              setSortOpen(true);
            }}
          >
            {strings.sort}
          </Button>
        ) : (
          <SortChip
            ref={sortAnchor}
            attribute={titleOf(first.attributeId)}
            direction={first.direction}
            more={rest.length}
            onPress={() => {
              pushed.current = false;
              setSortOpen(true);
            }}
          />
        )}
        {(filter?.conditions ?? []).map((item, index) => (
          <ConditionChip
            key={`${String(index)}:${shapeOf({ conjunction: 'and', conditions: [item] })}`}
            item={item}
            attributes={fields}
            displayOf={displayOf}
            onPress={() => {
              openFilter(filter ?? NO_FILTER);
            }}
            onRemove={() => {
              const kept = (filter?.conditions ?? []).filter((_, at) => at !== index);
              pushed.current = false;
              commit({
                ...(kept.length === 0 ? {} : { filter: { ...(filter ?? NO_FILTER), conditions: kept } }),
                sorts: query.sorts,
              });
            }}
          />
        ))}
        <Button
          ref={filterAnchor}
          variant="dashed"
          icon="list-filter"
          onPress={() => {
            openFilter(filter ?? NO_FILTER);
          }}
        >
          {strings.filter}
        </Button>
      </Toolbar>
      <Popover triggerRef={sortAnchor} isOpen={isSortOpen} onOpenChange={setSortOpen} label={strings.sorts}>
        <SortBuilder
          attributes={sortFields}
          value={query.sorts}
          onChange={(sorts) => {
            commit({ ...(query.filter === undefined ? {} : { filter: query.filter }), sorts });
          }}
        />
      </Popover>
      <Popover
        triggerRef={filterAnchor}
        isOpen={isFilterOpen}
        onOpenChange={(open) => {
          if (!open) flush();
          setFilterOpen(open);
        }}
        label={strings.filters}
      >
        <FilterBuilder
          attributes={fields}
          value={building}
          onChange={(next) => {
            setBuilding(next);
            clearTimeout(pending.current);
            const shape = shapeOf(next);
            // An attribute, an operator, a group or a removal applies at once; typing an operand waits for a pause.
            if (shape !== lastShape.current) {
              lastShape.current = shape;
              pending.current = undefined;
              commitFilter(next);
              return;
            }
            pending.current = setTimeout(() => {
              pending.current = undefined;
              commitFilter(next);
            }, FILTER_EDIT_MS);
          }}
          editorProps={editorProps}
          displayOf={displayOf}
        />
      </Popover>
    </>
  );
}
