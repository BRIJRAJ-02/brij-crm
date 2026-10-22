// A record's details (spec 0003, the record views): a row per attribute, its
// icon and name beside its value, each value drawn and edited in place
// through the field set, in sections. Narrow slots stack name above value.
import type { AttributeType } from '@crm/contracts/values';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FocusScope } from 'react-aria';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { LockReason } from '../../atoms/Tooltip/LockReason.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { AttributeEditor } from '../../fields/AttributeEditor.tsx';
import { fieldTypeOf, iconOf, readOnlyReasonOf } from '../../fields/registry.ts';
import type { EditorProps, FieldAttribute } from '../../fields/types.ts';
import { isEmptyValue } from '../../fields/values.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './AttributeList.module.css';
import { strings } from './strings.ts';

/** One attribute's row: the attribute, its value, and the display shapes for it. */
export interface AttributeItem {
  readonly attribute: FieldAttribute;
  readonly value: unknown;
  /** Record and member names and pictures, from the data layer. */
  readonly display?: unknown;
  /** A refusal from the data layer, shown under the value. */
  readonly error?: string;
}

/** A group of rows (#18). Leave out `title` for a flat list. */
export interface AttributeSection {
  readonly id: string;
  readonly title?: string;
  readonly items: readonly AttributeItem[];
}

/** What reference and file editors need from the screen. */
export type AttributeEditorExtras = Pick<EditorProps<AttributeType>, 'onSearch' | 'onUpload' | 'me' | 'describeResult'>;

/** Props for AttributeList. */
export interface AttributeListProps {
  /** The list's name ("Details"). */
  readonly label: string;
  readonly sections: readonly AttributeSection[];
  /** A value someone changed, already valid for its type. Leave it out for a list nobody can edit. */
  readonly onCommit?: (attributeId: string, value: unknown) => void;
  readonly editorProps?: (attribute: FieldAttribute) => AttributeEditorExtras;
  /** The record is still coming: skeleton rows after the loading delay. */
  readonly isLoading?: boolean;
  /**
   * `show` (the default): every row. `fold`: rows with nothing in them wait behind "Show N empty values" at the
   * list's foot, as Attio's Show all values and HubSpot's View all properties do, so the filled values read first.
   * Required, toggled in place and errored rows always show. Shown empty rows keep their "Set Name…" quiet until
   * the row is under a pointer or holds focus.
   */
  readonly emptyValues?: 'show' | 'fold';
}

/** Whether a row is folded away with the empty values: nothing in it, and nothing that must be seen. */
function isFoldable(item: AttributeItem): boolean {
  return (
    isEmptyValue(item.value) &&
    !item.attribute.isRequired &&
    item.error === undefined &&
    fieldTypeOf(item.attribute.type).togglesInPlace !== true
  );
}

/**
 * A record's details: a row per attribute, the name and its type's icon on
 * the left, the value on the right, the same display as in a table cell. A
 * value that can change edits in place (Enter or a click); one that can't
 * has a small lock after its name that says why. Each name stays level with
 * the first line of its value, however tall the value or its editor grows.
 * Titled sections fold.
 */
export function AttributeList({
  label,
  sections,
  onCommit,
  editorProps,
  isLoading = false,
  emptyValues = 'show',
}: AttributeListProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  const [isShowingEmpty, setShowingEmpty] = useState(false);
  // Folded: empty rows wait behind the foot's button. A row that has shown with a value stays for good (until the
  // list is given a new key), so clearing it, or emptying a list mid edit, never pulls the row out from under the
  // editor and its focus.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const shownNow = sections.flatMap((section) =>
    section.items.filter((item) => !isFoldable(item)).map((item) => item.attribute.id),
  );
  if (emptyValues === 'fold' && shownNow.some((id) => !kept.has(id))) setKept(new Set([...kept, ...shownNow]));
  const isFolded = (item: AttributeItem) => isFoldable(item) && !kept.has(item.attribute.id);
  const isFolding = emptyValues === 'fold' && !isShowingEmpty;
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
        {showSkeleton && (
          <div className={styles.rows}>
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className={styles.row}>
                <Skeleton width="medium" />
                <Skeleton width="long" />
              </div>
            ))}
          </div>
        )}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  const folded = emptyValues === 'fold' ? sections.flatMap((section) => section.items.filter(isFolded)).length : 0;
  const rows = (items: readonly AttributeItem[]): ReactNode => (
    <dl className={styles.rows}>
      {items
        .filter((item) => !isFolding || !isFolded(item))
        .map((item) => (
          <Row
            key={item.attribute.id}
            item={item}
            onCommit={onCommit}
            editorProps={editorProps}
            isQuietEmpty={emptyValues === 'fold'}
          />
        ))}
    </dl>
  );
  return (
    <section className={styles.root} aria-label={label}>
      {sections
        // A titled section with every row folded away draws nothing, rather than a heading over an empty list.
        .filter((section) => !isFolding || section.title === undefined || section.items.some((item) => !isFolded(item)))
        .map((section) =>
          section.title === undefined ? (
            <div key={section.id}>{rows(section.items)}</div>
          ) : (
            <Disclosure key={section.id} title={section.title} variant="label" defaultExpanded>
              {rows(section.items)}
            </Disclosure>
          ),
        )}
      {folded > 0 && (
        <span className={styles.more}>
          <Button
            variant="ghost"
            icon={isShowingEmpty ? 'chevron-up' : 'chevron-down'}
            isExpanded={isShowingEmpty}
            onPress={() => {
              setShowingEmpty((was) => !was);
            }}
          >
            {isShowingEmpty ? strings.hideEmpty : strings.showEmpty(folded)}
          </Button>
        </span>
      )}
    </section>
  );
}

interface RowProps {
  readonly item: AttributeItem;
  readonly onCommit: AttributeListProps['onCommit'];
  readonly editorProps: AttributeListProps['editorProps'];
  /** An empty value's "Set Name…" shows only under a pointer or with focus in the row. */
  readonly isQuietEmpty: boolean;
}

/** One attribute: its name, then its value, shown or being edited. */
function Row({ item, onCommit, editorProps, isQuietEmpty }: RowProps) {
  const { attribute, value, display, error } = item;
  const [isEditing, setEditing] = useState(false);
  const nameId = useId();
  // Focus that moves into the editor's own popover (a portal) still counts as
  // inside: React's focus events bubble through portals, so a blur is only
  // final when no focus lands back in the row before the next frame.
  const focusInside = useRef(false);
  // Enter or Esc in the editor hands focus back to the pencil; a click away leaves it where it went.
  const pencil = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (isEditing || !refocus.current) return;
    refocus.current = false;
    // After the key that committed is done: a commit whose save re-renders at once (a data layer's store, in the
    // same event) runs this effect while Enter is still going down, and the browser would then press the pencil
    // with it, opening the editor again.
    focusLater(() => pencil.current);
  }, [isEditing]);
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  const definition = fieldTypeOf(attribute.type);
  const reason = readOnlyReasonOf(attribute);
  const canEdit = onCommit !== undefined && reason === undefined && definition.editIn !== 'none';
  const closesOnCommit = definition.editIn === 'cell' || definition.closesOnCommit === true;
  // The list turned read only under an open editor (the record was deleted elsewhere): the editor goes with its
  // draft, and focus lands on the value it was editing rather than on the page.
  const readOnlyValue = useRef<HTMLSpanElement>(null);
  const isEditorLost = isEditing && !canEdit;
  useEffect(() => {
    if (!isEditorLost) return;
    focusLater(() => (document.activeElement === document.body ? readOnlyValue.current : undefined));
  }, [isEditorLost]);
  const extras = {
    ...(editorProps?.(attribute) ?? {}),
    ...(display === undefined ? {} : { display: display as never }),
    ...(error === undefined ? {} : { error }),
  };
  const isEmpty = isEmptyValue(value);
  const shown = (
    <AttributeDisplay
      attribute={attribute}
      value={value ?? null}
      surface="panel"
      {...(display === undefined ? {} : { display: display as never })}
    />
  );
  let body: ReactNode;
  if (canEdit && definition.togglesInPlace === true) {
    body = (
      <span className={styles.toggle}>
        <AttributeEditor
          attribute={attribute}
          value={value ?? null}
          surface="panel"
          onCommit={(next) => {
            onCommit(attribute.id, next);
          }}
          {...extras}
        />
      </span>
    );
  } else if (isEditing && canEdit) {
    body = (
      <div
        className={styles.editor}
        onFocus={() => {
          focusInside.current = true;
        }}
        onBlur={() => {
          focusInside.current = false;
          requestAnimationFrame(() => {
            if (!focusInside.current) setEditing(false);
          });
        }}
      >
        {/* eslint-disable-next-line jsx-a11y-x/no-autofocus -- the editor was opened on purpose, from its value */}
        <FocusScope autoFocus>
          <AttributeEditor
            attribute={attribute}
            value={value ?? null}
            surface="panel"
            autoOpen
            onCommit={(next) => {
              onCommit(attribute.id, next);
              if (closesOnCommit) close();
            }}
            onCancel={close}
            {...extras}
          />
        </FocusScope>
      </div>
    );
  } else if (canEdit) {
    const open = () => {
      setEditing(true);
    };
    body = (
      <span className={styles.editable}>
        {/* A click on the value (not on a link inside it) opens the editor;
            the pencil button beside it is the keyboard's way in. */}
        {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- the pencil button is the keyboard path */}
        <span
          className={styles.value}
          data-editable=""
          data-pressable=""
          onClick={(event) => {
            if (!(event.target instanceof Element) || event.target.closest('a, button') === null) open();
          }}
        >
          {isEmpty ? (
            <span className={styles.placeholder} data-quiet={isQuietEmpty || undefined}>
              {strings.set(attribute.name)}
            </span>
          ) : (
            shown
          )}
        </span>
        <span className={styles.action}>
          <Button variant="ghost" icon="pencil" label={strings.edit(attribute.name)} onPress={open} ref={pencil} />
        </span>
      </span>
    );
  } else {
    body = (
      // Focusable by script only: where focus goes when an open editor is taken away.
      <span ref={readOnlyValue} className={styles.value} data-readonly="" tabIndex={-1}>
        {/* Nothing here and nothing to set: said in words, quietly, never a lone dash. */}
        {isEmpty ? <span className={styles.placeholder}>{strings.notSet}</span> : shown}
      </span>
    );
  }
  return (
    <div className={styles.row} data-editing={isEditing || undefined}>
      <dt id={nameId} className={styles.label}>
        <Icon name={iconOf(attribute)} tile="gray" />
        <span className={styles.name}>{attribute.name}</span>
        {/* Why it can't change sits with its name: a small lock, the reason in its tooltip. */}
        {!canEdit && reason !== undefined && <LockReason reason={reason} size="sm" />}
      </dt>
      <dd className={styles.cell}>
        {body}
        {error !== undefined && !isEditing && <span className={styles.error}>{error}</span>}
      </dd>
    </div>
  );
}
