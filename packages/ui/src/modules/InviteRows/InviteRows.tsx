import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import {
  addRowAfter,
  createInviteRow,
  isList,
  pasteInto,
  removeRow,
  splitList,
  type InviteRow,
} from './invite-rows.ts';
import styles from './InviteRows.module.css';
import { strings } from './strings.ts';

/** A role a row can be invited as. */
export interface InviteRole {
  readonly id: string;
  readonly label: string;
}

/** What a screen can do to InviteRows from outside: put focus in a row (the first one that needs fixing). */
export interface InviteRowsHandle {
  readonly focusRow: (id: string) => void;
}

/** Props for InviteRows. */
export interface InviteRowsProps {
  /** The rows, one person each; at least one. Make them with `createInviteRow`. */
  readonly rows: readonly InviteRow[];
  /** Every change to the rows: typed, pasted, a role picked, a row added or removed. */
  readonly onChange: (rows: readonly InviteRow[]) => void;
  /** The roles each row can pick from, most power first. Left out, there is no role column. */
  readonly roles?: readonly InviteRole[] | undefined;
  /** An InfoTip beside the Role column's label: what each role can do. */
  readonly rolesInfo?: ReactNode;
  /** Each row's problem, by row id, shown under its email. */
  readonly errors?: Readonly<Record<string, string>>;
  /** The most rows: the plus goes away, and a longer paste keeps the first ones (`onOverflow` says so). */
  readonly max: number;
  readonly isDisabled?: boolean;
  /** A row's email lost focus (a screen judges a row once it is left). */
  readonly onBlurRow?: (id: string) => void;
  /** Enter in an empty last row: the screen sends. */
  readonly onSubmit?: () => void;
  /** A paste had more addresses than rows left: how many were kept. */
  readonly onOverflow?: (kept: number) => void;
  /** Focus the first row's email as it mounts: a dialog opened to invite starts typing at once. */
  readonly autoFocus?: boolean;
  readonly ref?: Ref<InviteRowsHandle>;
}

/**
 * One person per row: an email Field, the row's role (a compact Select, when
 * `roles` are given) and a remove button once there are two rows; under the
 * rows, "+ Add another" (named "Add another person") adds the next, as
 * Slack, Linear and Vercel's invite forms do. The
 * columns are named once above the rows (Email, and Role with `rolesInfo`
 * beside it); each control keeps its own name for screen readers. Enter in a
 * row goes to the next, adds one after the last, and on an empty last row calls
 * `onSubmit`. A pasted list ("a@x.com, b@y.com", or one per line) fills this
 * row and new ones after it. Adding, removing and pasting move focus to the
 * row that follows from it. Controlled: the screen holds the rows and judges
 * the addresses (`errors`).
 */
export function InviteRows({
  rows,
  onChange,
  roles,
  rolesInfo,
  errors = {},
  max,
  isDisabled = false,
  onBlurRow,
  onSubmit,
  onOverflow,
  autoFocus = false,
  ref,
}: InviteRowsProps) {
  const fields = useRef(new Map<string, HTMLInputElement>());
  // The row to focus once the rows just changed are drawn (a row added, removed, or filled by a paste).
  const focusNext = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (focusNext.current === undefined) return;
    fields.current.get(focusNext.current)?.focus();
    focusNext.current = undefined;
  });
  useImperativeHandle(ref, () => ({ focusRow: (id: string) => fields.current.get(id)?.focus() }), []);

  const isFull = rows.length >= max;
  const roleItems = roles?.map((each) => ({ id: each.id, label: each.label }));
  const make = (roleId?: string, email?: string) => createInviteRow(roleId ?? roles?.at(-1)?.id, email);

  const add = (afterId?: string) => {
    if (isFull) return;
    const next = addRowAfter(rows, afterId, make);
    focusNext.current = next.added.id;
    onChange(next.rows);
  };
  const remove = (id: string) => {
    const next = removeRow(rows, id);
    focusNext.current = next.focus?.id;
    onChange(next.rows);
  };
  const type = (row: InviteRow, value: string) => {
    if (!isList(value, row.email)) {
      // One address pasted the way a mail client copies it ("Ada Lovelace <ada@acme.com>"): the address alone.
      const [only] = value.length - row.email.length > 1 ? splitList(value) : [];
      const email = only !== undefined && splitList(value).length === 1 && value.includes('<') ? only : value;
      onChange(rows.map((each) => (each.id === row.id ? { ...each, email } : each)));
      return;
    }
    const next = pasteInto(rows, row.id, value, max, make);
    focusNext.current = next.last?.id;
    onChange(next.rows);
    if (next.dropped > 0) onOverflow?.(next.kept);
  };

  return (
    <div
      className={styles.root}
      data-roles={roleItems === undefined ? undefined : ''}
      data-removable={rows.length > 1 ? '' : undefined}
    >
      {/* The columns' names, once: every row's controls carry their own (hidden) names. They stay at full strength
          while the rows are disabled, as plain text over the faded controls keeps its contrast. */}
      <span className={styles.head}>
        <FieldLabel label={strings.email} as="text" />
      </span>
      {roleItems !== undefined && (
        <span className={styles.head}>
          <FieldLabel label={strings.role} as="text" info={rolesInfo} />
        </span>
      )}
      {rows.length > 1 && <span className={styles.head} />}
      {rows.map((row, index) => {
        const what = row.email.trim() === '' ? strings.rowName(index + 1) : row.email.trim();
        const error = errors[row.id];
        return (
          <div key={row.id} className={styles.row}>
            <span className={styles.email}>
              <Field
                ref={(element) => {
                  if (element === null) fields.current.delete(row.id);
                  else fields.current.set(row.id, element);
                }}
                label={strings.emailFor(index + 1)}
                isLabelHidden
                // Text, not email: an email input drops the line breaks of a pasted column, which then can't split.
                // Its own name and autocomplete off, so a browser never fills in the signed in person's address.
                type="text"
                inputMode="email"
                name={`invite-${row.id}`}
                autoComplete="off"
                autoFocus={autoFocus && index === 0}
                placeholder={strings.placeholder}
                value={row.email}
                isDisabled={isDisabled}
                {...(error === undefined ? {} : { error })}
                onChange={(value) => {
                  type(row, value);
                }}
                onBlur={() => onBlurRow?.(row.id)}
                // Enter is the rows' own (the next row, a new row, or send), never the browser's submit of a
                // form around them, which would send while a row is being added.
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  const next = rows[index + 1];
                  if (next !== undefined) fields.current.get(next.id)?.focus();
                  // Enter on an empty last row sends, rather than adding empty rows.
                  else if (row.email.trim() === '' || isFull) onSubmit?.();
                  else add(row.id);
                }}
              />
            </span>
            {roleItems !== undefined && (
              <span className={styles.role}>
                <Select
                  label={strings.roleFor(what)}
                  isLabelHidden
                  items={roleItems}
                  value={row.roleId ?? null}
                  isDisabled={isDisabled}
                  onChange={(next) => {
                    if (next !== null)
                      onChange(rows.map((each) => (each.id === row.id ? { ...each, roleId: next } : each)));
                  }}
                />
              </span>
            )}
            {rows.length > 1 && (
              <span className={styles.end}>
                <Button
                  variant="ghost"
                  icon="x"
                  label={strings.removeRow(what)}
                  isDisabled={isDisabled}
                  onPress={() => {
                    remove(row.id);
                  }}
                />
              </span>
            )}
          </div>
        );
      })}
      {isFull ? (
        <span className={styles.limit}>{strings.atMost(max)}</span>
      ) : (
        <span className={styles.add}>
          <Button
            variant="ghost"
            icon="plus"
            label={strings.addAnotherName}
            isDisabled={isDisabled}
            onPress={() => {
              add();
            }}
          >
            {strings.addAnother}
          </Button>
        </span>
      )}
    </div>
  );
}
