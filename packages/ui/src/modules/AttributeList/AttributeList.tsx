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
import { fieldTypeOf, readOnlyReasonOf } from '../../fields/registry.ts';
import type { EditorProps, FieldAttribute } from '../../fields/types.ts';
import { isEmptyValue } from '../../fields/values.ts';
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
export type AttributeEditorExtras = Pick<EditorProps<AttributeType>, 'onSearch' | 'onUpload' | 'me'>;

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
}

/**
 * A record's details: a row per attribute, the name and its type's icon on
 * the left, the value on the right, the same display as in a table cell. A
 * value that can change edits in place (Enter or a click); one that can't
 * shows a lock, and says why. Titled sections fold.
 */
export function AttributeList({ label, sections, onCommit, editorProps, isLoading = false }: AttributeListProps) {
  const showSkeleton = useDelayedLoading(isLoading);
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
  const rows = (items: readonly AttributeItem[]): ReactNode => (
    <dl className={styles.rows}>
      {items.map((item) => (
        <Row key={item.attribute.id} item={item} onCommit={onCommit} editorProps={editorProps} />
      ))}
    </dl>
  );
  return (
    <section className={styles.root} aria-label={label}>
      {sections.map((section) =>
        section.title === undefined ? (
          <div key={section.id}>{rows(section.items)}</div>
        ) : (
          <Disclosure key={section.id} title={section.title} variant="label" defaultExpanded>
            {rows(section.items)}
          </Disclosure>
        ),
      )}
    </section>
  );
}

interface RowProps {
  readonly item: AttributeItem;
  readonly onCommit: AttributeListProps['onCommit'];
  readonly editorProps: AttributeListProps['editorProps'];
}

/** One attribute: its name, then its value, shown or being edited. */
function Row({ item, onCommit, editorProps }: RowProps) {
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
    pencil.current?.focus();
  }, [isEditing]);
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  const definition = fieldTypeOf(attribute.type);
  const reason = readOnlyReasonOf(attribute);
  const canEdit = onCommit !== undefined && reason === undefined && definition.editIn !== 'none';
  const closesOnCommit = definition.editIn === 'cell' || definition.closesOnCommit === true;
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
          onClick={(event) => {
            if (!(event.target instanceof Element) || event.target.closest('a, button') === null) open();
          }}
        >
          {isEmpty ? <span className={styles.placeholder}>{strings.set(attribute.name)}</span> : shown}
        </span>
        <span className={styles.action}>
          <Button variant="ghost" icon="pencil" label={strings.edit(attribute.name)} onPress={open} ref={pencil} />
        </span>
      </span>
    );
  } else {
    body = (
      <span className={styles.value} data-readonly="">
        {shown}
        {reason !== undefined && <LockReason reason={reason} />}
      </span>
    );
  }
  return (
    <div className={styles.row} data-editing={isEditing || undefined}>
      <dt id={nameId} className={styles.label}>
        <Icon name={definition.icon} size="sm" tone="muted" />
        <span className={styles.name}>{attribute.name}</span>
      </dt>
      <dd className={styles.cell}>
        {body}
        {error !== undefined && !isEditing && <span className={styles.error}>{error}</span>}
      </dd>
    </div>
  );
}
