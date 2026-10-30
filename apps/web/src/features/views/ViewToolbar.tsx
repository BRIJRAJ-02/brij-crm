// Brief
// Purpose: say how the view is shaped (its sorts and filters) and change it, as an unsaved draft until Save.
// Main task: open the sort or filter builder from its chip or button, then Save, Save as new view, or Discard the draft.
// Leaves out: the view switcher, columns and view settings (the view bar).
import {
  CREATED_AT_SLUG,
  FILTER_EDIT_MS,
  searchMembers,
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
  focusLater,
  Menu,
  MenuItem,
  Popover,
  SortBuilder,
  SortChip,
  SplitButton,
  Toolbar,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isDefaultSort } from './query.ts';
import { strings } from './strings.ts';

const NO_FILTER: FilterGroup = { conjunction: 'and', conditions: [] };

/**
 * What a relationship filters by here: is empty and is not empty. Its other operators need record search for their
 * operand (spec 0014), which the view's builder doesn't have yet.
 */
const REFERENCE_OPERATORS = ['is_empty', 'is_not_empty'] as const;
const operatorsOf = (field: { readonly type: string }) =>
  field.type === 'record_reference' ? REFERENCE_OPERATORS : undefined;

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
  /**
   * The object's key (its standard key, else its API name), so a filter's
   * value editor checks a handle as the record editor does: a company's
   * LinkedIn handle is its company page.
   */
  readonly objectKey?: string;
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
  /** Save as new view: the create dialog with the draft. */
  readonly onSaveAsNew: () => void;
  /** What the filter matches, for screen readers ("124 people match"). */
  readonly status?: string;
  /** Asks for focus on the Filter button (after Discard, Save or Replace took the focused control away). A new object each time. */
  readonly focusRequest?: object;
  /** A column's Filter: the builder opens with a new condition on it (none for an empty id). A new object each time it is asked. */
  readonly filterOn?: { readonly attributeId: string };
  /** The view's search at the bar's end (a ToolbarSearch): it narrows the rows and is never saved. */
  readonly search?: ReactNode;
}

/** The view's Toolbar: the sort chip, a chip per filter, Filter, and while there is a draft Discard and Save. */
export function ViewToolbar({
  query,
  filter,
  attributes,
  objectKey,
  sortable,
  members,
  me,
  isDraft,
  canSave,
  isSaving,
  onChange,
  onDiscard,
  onSave,
  onSaveAsNew,
  filterOn,
  status,
  focusRequest,
  search,
}: ViewToolbarProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const fields = useMemo(
    () => attributes.map((attribute) => toFieldAttribute(attribute, undefined, objectKey)),
    [attributes, objectKey],
  );
  // The builder offers every field; a record reference only as is empty or is not empty (`operatorsOf`).
  const builderFields = fields;
  const sortFields = useMemo(
    () => sortable.map((attribute) => toFieldAttribute(attribute, undefined, objectKey)),
    [sortable, objectKey],
  );
  const titleOf = (id: string) => attributes.find((attribute) => attribute.id === id)?.title ?? id;
  const filterAnchor = useRef<HTMLButtonElement>(null);
  // The sort chip, or the dashed Sort button when the view has no sorts: the sort builder opens from either.
  const sortAnchor = useRef<HTMLElement>(null);
  const [isSortOpen, setSortOpen] = useState(false);
  // The builder opened on the default order shows it empty; once someone edits there, it shows their rows as they
  // are, so a row turned into Created at newest first stays put rather than vanishing under the pointer.
  const [isSortEdited, setSortEdited] = useState(false);
  const [isFilterOpen, setFilterOpen] = useState(false);
  // What the builder holds while it is open: incomplete rows included, which filter nothing until complete.
  const [building, setBuilding] = useState<FilterGroup>(NO_FILTER);
  // The first change of a Popover adds a history entry; the rest replace it, so back steps through Popovers.
  const pushed = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastShape = useRef('');
  // The query as it stands now, for a commit that a pause in typing sends later.
  const current = useRef(query);
  useEffect(() => {
    current.current = query;
  }, [query]);
  useEffect(() => {
    if (focusRequest !== undefined) focusLater(() => filterAnchor.current);
  }, [focusRequest]);

  // A change that asks the same thing (a row still missing its operand) is no change: it neither writes the
  // address nor spends the Popover's one history entry.
  const commit = (next: DraftQuery) => {
    if (data.views.isSameQuery(next, current.current)) return;
    current.current = next;
    onChange(next, pushed.current ? 'replace' : 'push');
    pushed.current = true;
  };
  const commitFilter = (group: FilterGroup) => {
    const complete = completeFilters(group);
    commit({ ...(complete.conditions.length === 0 ? {} : { filter: complete }), sorts: current.current.sorts });
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
    const field = builderFields.find((each) => each.id === filterOn.attributeId);
    // No column named (an empty table's Edit filters): the builder opens as it stands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openFilter(
      field === undefined
        ? current
        : { ...current, conditions: [...current.conditions, conditionOn(field, operatorsOf(field)?.[0])] },
    );
    // Only a new request opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOn]);

  // The default order (Created at, newest first) shows as a muted "Sorted by Created at" with no remove, so the order
  // is never a mystery; another order shows its own chip, and removing it goes back to the default.
  const isDefaultOrder = isDefaultSort(query.sorts, attributes);
  const [first, ...rest] = isDefaultOrder ? [] : query.sorts;
  const createdAt = attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === CREATED_AT_SLUG);
  const openSorts = () => {
    pushed.current = false;
    setSortOpen(true);
  };
  const editorProps = (attribute: { readonly type: string }) =>
    attribute.type === 'actor_reference'
      ? {
          // The typed search narrows by name or email; Me is pinned while it's empty, so never listed twice.
          onSearch: (query: string) =>
            arraySource(searchMembers(members, query, me?.id ?? undefined), (member) => member.id ?? member.name),
          ...(me === undefined ? {} : { me }),
        }
      : {};
  const displayOf = (attributeId: string) =>
    attributes.find((attribute) => attribute.id === attributeId)?.type === 'actor_reference' ? members : undefined;

  return (
    <>
      <Toolbar
        label={strings.toolbar}
        {...(status === undefined ? {} : { status })}
        {...(search === undefined ? {} : { search })}
        {...(isDraft
          ? {
              end: (
                <>
                  <Button variant="ghost" onPress={onDiscard} isDisabled={isSaving}>
                    {strings.discard}
                  </Button>
                  {canSave ? (
                    <SplitButton
                      onPress={onSave}
                      isPending={isSaving}
                      menuLabel={strings.saveMore}
                      menu={
                        <Menu label={strings.saveMore} onAction={onSaveAsNew}>
                          <MenuItem id="save-as-new" icon="plus">
                            {strings.saveAsNew}
                          </MenuItem>
                        </Menu>
                      }
                    >
                      {isSaving ? strings.saving : strings.save}
                    </SplitButton>
                  ) : (
                    // A locked view the person may not change (AC-476): their draft can only become a view of its own.
                    <Button variant="primary" icon="plus" onPress={onSaveAsNew}>
                      {strings.saveAsNew}
                    </Button>
                  )}
                </>
              ),
            }
          : {})}
      >
        {first === undefined && createdAt !== undefined ? (
          <SortChip ref={sortAnchor} attribute={createdAt.title} direction="descending" isDefault onPress={openSorts} />
        ) : first === undefined ? (
          <Button
            ref={(element) => {
              sortAnchor.current = element;
            }}
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
            onRemove={() => {
              pushed.current = false;
              commit({ ...(query.filter === undefined ? {} : { filter: query.filter }), sorts: [] });
              // The chip leaves with its remove part: focus goes to what takes its place, the default order's chip
              // (its first part) or the dashed Sort.
              focusLater(() => sortAnchor.current?.querySelector('button') ?? sortAnchor.current);
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
              // The chip leaves with its remove button: focus goes to the Filter button.
              focusLater(() => filterAnchor.current);
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
      <Popover
        triggerRef={sortAnchor}
        isOpen={isSortOpen}
        onOpenChange={(isOpen) => {
          setSortOpen(isOpen);
          if (!isOpen) setSortEdited(false);
        }}
        label={strings.sorts}
        width="builder"
      >
        <SortBuilder
          attributes={sortFields}
          // The default order opens the builder empty, where it says "Newest records show first." (the order that
          // runs), so Add sort starts a sort of its own rather than adding after a Created at nobody chose.
          value={isDefaultOrder && !isSortEdited ? [] : query.sorts}
          onChange={(sorts) => {
            setSortEdited(true);
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
        width="builder"
      >
        <FilterBuilder
          attributes={builderFields}
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
          operatorsOf={operatorsOf}
        />
      </Popover>
    </>
  );
}
