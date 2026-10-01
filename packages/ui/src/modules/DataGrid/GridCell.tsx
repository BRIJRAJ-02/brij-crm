// One body cell of the grid: the value through the field set, its editor when
// open (in the cell, as an open list, or in a popover anchored to it), a
// skeleton while its row loads, and the reason in a tooltip when it can't be
// edited or was refused.
import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { FocusScope } from 'react-aria';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { AttributeEditor } from '../../fields/AttributeEditor.tsx';
import { fieldTypeOf, readOnlyReasonOf } from '../../fields/registry.ts';
import type { AttributeType } from '@crm/contracts/values';
import type { EditorProps, FieldAttribute } from '../../fields/types.ts';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import styles from './GridCell.module.css';
import { strings } from './strings.ts';

/** What reference and file editors need from the screen: search, uploads and the signed in member. */
export type GridEditorProps = Pick<EditorProps<AttributeType>, 'onSearch' | 'onUpload' | 'me'>;

/** Where a cell sits: its drawn column, and its offset when it is pinned. */
export interface CellPlace {
  readonly col: number;
  readonly width: number;
  /** Set for a pinned cell (and the checkbox column): its distance from the start edge. */
  readonly stickyOffset?: number;
  readonly isLastPinned?: boolean;
}

/**
 * How a type edits in a cell: typed in the cell, an open list in the cell (a
 * select, a status), or a popover on the cell (a date, a reference, a name).
 */
export type EditMode = 'cell' | 'list' | 'popover';

/** How `attribute` edits in a grid cell, or `undefined` when it never does. */
export function editModeOf(attribute: FieldAttribute): EditMode | undefined {
  const definition = fieldTypeOf(attribute.type);
  if (readOnlyReasonOf(attribute) !== undefined || definition.editIn === 'none' || definition.togglesInPlace === true) {
    return undefined;
  }
  if (definition.editIn === 'cell') return 'cell';
  return definition.isListEditor === true ? 'list' : 'popover';
}

/** Props for GridCell. */
export interface GridCellProps {
  readonly row: number;
  readonly place: CellPlace;
  readonly attribute: FieldAttribute;
  /** `undefined` while the row loads. */
  readonly value: unknown;
  readonly display?: unknown;
  readonly isLoaded: boolean;
  readonly isRowHeader: boolean;
  readonly isFocused: boolean;
  readonly isInRange: boolean;
  /** Keyboard focus is on this cell and the reason wasn't dismissed with Esc, so its tooltip shows at once. */
  readonly isTipShown: boolean;
  readonly editing?: { readonly startText?: string };
  readonly error?: string;
  /** What reference and file editors need from the screen. */
  readonly editorProps: GridEditorProps;
  readonly onCommit: (value: unknown) => void;
  readonly onCancel: () => void;
  readonly onPopoverClose: () => void;
  /** A double click opens the editor. */
  readonly onDoubleClick: () => void;
  /** On the row header: a click on the name opens the record. */
  readonly onOpen?: () => void;
  /** A checkbox value: a click on the mark toggles it. */
  readonly onToggle?: () => void;
}

/**
 * A body cell. Its value draws through `AttributeDisplay`, a checkbox value
 * as its mark, which a click toggles; on the row header a click on the name
 * opens the record. A reason (read only, or refused) is the cell's
 * description, and shows in a tooltip on hover or keyboard focus.
 */
export function GridCell({
  row,
  place,
  attribute,
  value,
  display,
  isLoaded,
  isRowHeader,
  isFocused,
  isInRange,
  isTipShown,
  editing,
  error,
  editorProps,
  onCommit,
  onCancel,
  onPopoverClose,
  onDoubleClick,
  onOpen,
  onToggle,
}: GridCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const [isHoverOpen, setHoverOpen] = useState(false);
  const definition = fieldTypeOf(attribute.type);
  const reason = readOnlyReasonOf(attribute);
  const mode = editing === undefined ? undefined : editModeOf(attribute);
  const editor = (
    <AttributeEditor
      attribute={attribute}
      value={value ?? null}
      surface="cell"
      onCommit={onCommit}
      onCancel={onCancel}
      autoOpen
      {...editorProps}
      {...(display === undefined ? {} : { display: display as never })}
      {...(error === undefined ? {} : { error })}
      {...(editing?.startText === undefined ? {} : { startText: editing.startText })}
    />
  );
  const shown = (
    <AttributeDisplay
      attribute={attribute}
      value={value ?? null}
      surface="cell"
      {...(display === undefined ? {} : { display: display as never })}
    />
  );
  // What a click acts on: the name on the row header, the mark on a checkbox.
  const toggle = reason === undefined ? onToggle : undefined;
  const action = editing === undefined ? (toggle ?? onOpen) : undefined;
  let content: ReactNode = shown;
  if (!isLoaded) {
    content = (
      <>
        <Skeleton width="medium" />
        {isRowHeader && <VisuallyHidden>{strings.loadingRow}</VisuallyHidden>}
      </>
    );
  } else if (mode === 'cell' || mode === 'list') content = editor;
  else if (action !== undefined) {
    content = (
      <span className={styles.hit} data-hit="" data-kind={toggle === undefined ? 'open' : 'toggle'}>
        {content}
      </span>
    );
  }

  const tip = isLoaded ? (error ?? reason) : undefined;
  const wrapped =
    tip === undefined || mode === 'cell' || mode === 'list' ? (
      content
    ) : (
      <Tooltip
        content={tip}
        isTextTrigger
        isOpen={isHoverOpen || (isFocused && isTipShown)}
        onOpenChange={setHoverOpen}
      >
        <span className={styles.value}>{content}</span>
      </Tooltip>
    );
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (action !== undefined && (event.target as HTMLElement).closest('[data-hit]') !== null) action();
  };

  return (
    <div
      ref={ref}
      role={isRowHeader ? 'rowheader' : 'gridcell'}
      aria-colindex={place.col + 1}
      aria-readonly={reason === undefined ? undefined : true}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={tip === undefined ? undefined : tipId}
      className={styles.root}
      data-cell={`${String(row)}:${String(place.col)}`}
      data-align={definition.align}
      data-focused={isFocused || undefined}
      data-in-range={isInRange || undefined}
      data-editing={mode}
      data-invalid={error === undefined ? undefined : ''}
      data-sticky={place.stickyOffset === undefined ? undefined : ''}
      data-last-pinned={place.isLastPinned === true ? '' : undefined}
      tabIndex={isFocused ? 0 : -1}
      onDoubleClick={onDoubleClick}
      {...(action === undefined ? {} : { onClick })}
      style={{ '--col-width': `${String(place.width)}px`, '--col-offset': `${String(place.stickyOffset ?? 0)}px` }}
    >
      {wrapped}
      {tip !== undefined && (
        <span id={tipId} hidden>
          {tip}
        </span>
      )}
      {mode === 'popover' && (
        <Popover
          label={attribute.name}
          triggerRef={ref}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) onPopoverClose();
          }}
        >
          {/* The first control takes focus, so keys reach the editor at once. */}
          {/* eslint-disable-next-line jsx-a11y-x/no-autofocus -- the editor was opened on purpose, from the cell */}
          <FocusScope autoFocus>{editor}</FocusScope>
        </Popover>
      )}
    </div>
  );
}
