// OptionsEditor (spec 0012, AC-236): a select's options or a status
// attribute's stages, in order. Each live option has a label, a colour (the
// compact HuePicker) and, for a stage, an outcome and a target in days; they
// move by drag, by keyboard on the handle, or from the row's menu; archived
// ones sit muted in a closed "Archived" group with Restore. Presentational:
// the options come in, each change goes out, and the dialog or the screen
// decides what a change does (a draft before create, a write after).
import { nextHue } from '@crm/contracts/picker';
import { useRef, useState, type KeyboardEvent } from 'react';
import { GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { reorder } from '../../lib/reorder.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { HuePicker } from '../../molecules/HuePicker/HuePicker.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import styles from './OptionsEditor.module.css';
import { strings } from './strings.ts';

/** What a status stage means: still open, won or lost. */
export type OptionOutcome = 'open' | 'won' | 'lost';

/** One option (or stage) as the editor shows it. */
export interface OptionsEditorOption {
  readonly id: string;
  readonly label: string;
  readonly hue: Hue;
  /** Muted in the Archived group: still on the values that hold it, never chosen for new ones. */
  readonly isArchived: boolean;
  /** A stage's outcome. */
  readonly outcome?: OptionOutcome;
  /** A stage's target time in stage, in whole days from 1 to 365. */
  readonly targetDays?: number;
}

/** What a change to an option asks for; `targetDays: null` clears a stage's target. */
export interface OptionsEditorChange {
  readonly label?: string;
  readonly hue?: Hue;
  readonly outcome?: OptionOutcome;
  readonly targetDays?: number | null;
}

/** Props for OptionsEditor. */
export interface OptionsEditorProps {
  /** The group's name ("Options", "Stages"). */
  readonly label: string;
  /**
   * `status` adds each stage's outcome and target days. `choice` is a list of
   * plain words (a form question's choices): no colour (an option's `hue` is
   * ignored), shown as text when read only, and a quiet remove button in
   * place of the row's menu (it needs `onRemove`).
   */
  readonly kind: 'select' | 'status' | 'choice';
  /** Every option in the attribute's order, archived ones included. */
  readonly options: readonly OptionsEditorOption[];
  /** The live options an attribute may hold: shows "N of 500", and Add stops there. */
  readonly limit?: number;
  /** A new option's id (a UUID v7 the screen mints). */
  readonly newId: () => string;
  /** A new option, its label typed, its hue the next after the last option's, a stage open. */
  readonly onAdd: (option: OptionsEditorOption) => void;
  readonly onChange: (id: string, change: OptionsEditorChange) => void;
  /** Moves an option to `position` in the whole order, archived options counted. */
  readonly onMove: (id: string, position: number) => void;
  /** After create: the row menu's Archive. */
  readonly onArchive?: (id: string) => void;
  /** After create: the Archived group's Restore. */
  readonly onRestore?: (id: string) => void;
  /** Before create: the row menu's Remove (a draft option leaves the list). */
  readonly onRemove?: (id: string) => void;
  /** Options whose change is with the server: a spinner shows on the row. */
  readonly pending?: ReadonlySet<string>;
  /** A refusal per option, by id (`new` for the row being added): shown on its label. */
  readonly errors?: Readonly<Partial<Record<string, string>>>;
  /** Shows the options with nothing to change (a member, a read only dialog). */
  readonly isReadOnly?: boolean;
  /** The longest label a row takes (100 when left out): a form's choices take 80, as their contract does. */
  readonly labelMaxLength?: number;
  /** Opens with one blank row, ready to type in (a new select). */
  readonly startsWithBlank?: boolean;
  /** A line under the group's label: how changes are kept ("Changes to options save as you make them."). */
  readonly hint?: string;
  /**
   * Told whenever a row's own check refuses what was typed or clears it (a
   * label taken, days out of range): a dialog keeps its submit back while
   * one is refused, so a create never goes without an option the person typed.
   */
  readonly onInvalidChange?: (isInvalid: boolean) => void;
}

/** The row being added: its id, the label typed so far, and the hue it will take. */
interface Draft {
  readonly id: string;
  readonly label: string;
  readonly hue: Hue;
  /** Asked for (Add option, or Enter on the last one): its field takes focus as it appears. */
  readonly isAsked: boolean;
}

/** The blank row's key in the list, whichever option it is about to become. */
const DRAFT_ROW = 'options-editor-draft';

const OUTCOMES: readonly { readonly id: OptionOutcome; readonly label: string }[] = [
  { id: 'open', label: strings.open },
  { id: 'won', label: strings.won },
  { id: 'lost', label: strings.lost },
];

/** Whole days from 1 to 365, `null` for empty, or `undefined` when it isn't one. */
function daysOf(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days >= 1 && days <= 365 ? days : undefined;
}

/**
 * OptionsEditor: a React Aria GridList of an attribute's live options, each
 * a label field, a colour, and for a stage an outcome and target days, moved
 * by drag or by keyboard on the handle (or Move up and Move down in the row's
 * menu); "Add option" below; archived options in a closed "Archived" group
 * with Restore. Tab moves through a row's controls; the arrow keys stay in
 * the field being typed in.
 */
export function OptionsEditor({
  label,
  kind,
  options,
  limit,
  newId,
  onAdd,
  onChange,
  onMove,
  onArchive,
  onRestore,
  onRemove,
  pending = new Set(),
  errors = {},
  isReadOnly = false,
  startsWithBlank = false,
  labelMaxLength = 100,
  hint,
  onInvalidChange,
}: OptionsEditorProps) {
  const isStatus = kind === 'status';
  const isChoice = kind === 'choice';
  const rootRef = useRef<HTMLDivElement>(null);
  const live = options.filter((option) => !option.isArchived);
  const archived = options.filter((option) => option.isArchived);
  const [draft, setDraft] = useState<Draft | undefined>(() =>
    // The blank row a new select opens with waits for Tab: focus stays where the person was (the type picker).
    startsWithBlank && !isReadOnly ? { id: newId(), label: '', hue: nextHue(options), isAsked: false } : undefined,
  );
  // What was typed in a row's label or days, with what the option held as typing began: shown while the option
  // still holds that (the change sent and waiting, or refused), and let go once it changes (landed, or changed
  // by someone else), so a stale draft never hides a newer name.
  const [typed, setTyped] = useState<Readonly<Record<string, { readonly text: string; readonly base: string }>>>({});
  const [local, setLocal] = useState<Readonly<Partial<Record<string, string>>>>({});
  const [said, setSaid] = useState('');
  const isFull = limit !== undefined && live.length >= limit;

  const baseOf = (option: OptionsEditorOption, field: 'label' | 'days') =>
    field === 'label' ? option.label : String(option.targetDays ?? '');
  const typedOf = (option: OptionsEditorOption, field: 'label' | 'days'): string | undefined => {
    const entry = typed[`${option.id}:${field}`];
    return entry !== undefined && entry.base === baseOf(option, field) ? entry.text : undefined;
  };
  const type = (option: OptionsEditorOption, field: 'label' | 'days', text: string | undefined) => {
    const key = `${option.id}:${field}`;
    setTyped((before) => {
      const { [key]: _gone, ...rest } = before;
      return text === undefined ? rest : { ...rest, [key]: { text, base: baseOf(option, field) } };
    });
  };

  /** Sets or clears a refusal made here (a label taken, days out of range), by key, and says whether any is left. */
  const setOne = (key: string, message: string | undefined) => {
    if (local[key] === message) return;
    const { [key]: _gone, ...rest } = local;
    const next = message === undefined ? rest : { ...rest, [key]: message };
    setLocal(next);
    onInvalidChange?.(Object.keys(next).length > 0);
  };

  /** Whether a live option other than `except` holds `text` as its label, ignoring case. */
  const isTaken = (text: string, except?: string) =>
    live.some((option) => option.id !== except && option.label.trim().toLowerCase() === text.trim().toLowerCase());

  const focusIn = (pick: (root: HTMLElement) => HTMLElement | null) => {
    focusLater(() => (rootRef.current === null ? null : pick(rootRef.current)));
  };
  const rowControl = (id: string, selector: string) => (root: HTMLElement) =>
    root.querySelector<HTMLElement>(`[data-key="${CSS.escape(id)}"] ${selector}`);

  const startDraft = (after?: Hue) => {
    setDraft({
      id: newId(),
      label: '',
      hue: after === undefined ? nextHue(options) : nextHue([{ hue: after }]),
      isAsked: true,
    });
  };

  /**
   * Adds the draft when its label is given and free. On Enter (`again`) the
   * next blank row opens, or at the limit focus goes to Add option; as focus
   * leaves (a blur) it stays wherever the person put it.
   */
  const commitDraft = (again: boolean) => {
    if (draft === undefined) return;
    const text = draft.label.trim();
    if (text === '') {
      setDraft(undefined);
      setOne('new', undefined);
      return;
    }
    if (isTaken(text)) {
      setOne('new', isChoice ? strings.choiceTaken : strings.labelTaken);
      return;
    }
    setOne('new', undefined);
    onAdd({
      id: draft.id,
      label: text,
      hue: draft.hue,
      isArchived: false,
      ...(isStatus ? { outcome: 'open' as const } : {}),
    });
    if (again && !(limit !== undefined && live.length + 1 >= limit)) startDraft(draft.hue);
    else {
      setDraft(undefined);
      if (again) focusIn((root) => root.querySelector<HTMLElement>('[data-adder] button'));
    }
  };

  const commitLabel = (option: OptionsEditorOption) => {
    const text = typedOf(option, 'label')?.trim();
    if (text === undefined) return;
    if (text === '' || text === option.label) {
      type(option, 'label', undefined);
      setOne(option.id, undefined);
      return;
    }
    if (isTaken(text, option.id)) {
      setOne(option.id, isChoice ? strings.choiceTaken : strings.labelTaken);
      return;
    }
    setOne(option.id, undefined);
    onChange(option.id, { label: text });
  };

  const commitDays = (option: OptionsEditorOption) => {
    const text = typedOf(option, 'days');
    if (text === undefined) return;
    const next = daysOf(text);
    if (next === undefined) {
      setOne(`${option.id}:days`, strings.daysInvalid);
      return;
    }
    setOne(`${option.id}:days`, undefined);
    if (next === (option.targetDays ?? null)) {
      type(option, 'days', undefined);
      return;
    }
    onChange(option.id, { targetDays: next });
  };

  /** Moves `id` before or after `target` (both live), and says where it landed. */
  const moveTo = (id: string, target: string, position: 'before' | 'after') => {
    const next = reorder(options, (option) => option.id, new Set([id]), target, position);
    const at = next.findIndex((option) => option.id === id);
    if (at < 0 || next === options) return;
    onMove(id, at);
    const liveOrder = next.filter((option) => !option.isArchived);
    const moved = liveOrder.findIndex((option) => option.id === id);
    const name = options.find((option) => option.id === id)?.label ?? '';
    setSaid(strings.moved(name, moved + 1, liveOrder.length));
  };

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder: (event) => {
      const [moving] = [...event.keys].map(String);
      if (moving === undefined) return;
      moveTo(moving, String(event.target.key), event.target.dropPosition === 'after' ? 'after' : 'before');
    },
  });

  // Enter in a row's field commits that field: it never submits the form the editor sits in.
  const keepEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  const placeName = (index: number) =>
    isStatus
      ? strings.stageLabel(index + 1)
      : isChoice
        ? strings.choiceLabel(index + 1)
        : strings.optionLabel(index + 1);
  const newName = isStatus ? strings.newStage : isChoice ? strings.newChoice : strings.newOption;

  /** Removes a row and puts focus on the next row's field, or the one before, or Add when it was the last. */
  const removeRow = (index: number, id: string) => {
    const next = live[index + 1] ?? live[index - 1];
    onRemove?.(id);
    focusIn(
      next === undefined
        ? (root) => root.querySelector<HTMLElement>('[data-adder] button')
        : rowControl(next.id, 'input'),
    );
  };

  const rows = [
    ...live.map((option, index) => ({ id: option.id, option, index })),
    // The blank row keeps one key whatever it holds, so after Enter adds what it held, the same row (and its
    // focused field) stays to take the next: no remount, so the list never pulls focus back to the row just added.
    ...(draft === undefined ? [] : [{ id: DRAFT_ROW, option: undefined, index: live.length }]),
  ];

  return (
    // The wrapper only stops Enter in a field from submitting the surrounding form; the controls inside take the keys.
    <div ref={rootRef} className={styles.root} onKeyDownCapture={keepEnter}>
      <div className={styles.head}>
        <span className={styles.title}>{label}</span>
        {limit !== undefined && !isReadOnly && (
          <span className={styles.usage}>{strings.usage(live.length, limit)}</span>
        )}
      </div>
      {hint !== undefined && !isReadOnly && <span className={styles.note}>{hint}</span>}
      {isStatus && !isReadOnly && <span className={styles.note}>{strings.daysNote}</span>}
      {rows.length === 0 && (
        <p className={styles.empty}>{isStatus ? strings.noStages : isChoice ? strings.noChoices : strings.noOptions}</p>
      )}
      {rows.length > 0 && (
        <GridList
          aria-label={label}
          items={rows}
          className={styles.list}
          keyboardNavigationBehavior="tab"
          {...(isReadOnly ? {} : { dragAndDropHooks })}
        >
          {({ id, option, index }) => {
            if (option === undefined) {
              // The row being added: its label alone; colour and outcome follow once it exists.
              return (
                <GridListItem id={id} textValue={newName} className={styles.row} data-draft="">
                  <DragHandle label={strings.move(newName)} isDisabled />
                  <span className={styles.label}>
                    <Field
                      label={newName}
                      isLabelHidden
                      {...(isChoice ? { placeholder: strings.typeChoice } : {})}
                      size="sm"
                      maxLength={labelMaxLength}
                      autoComplete="off"
                      // A row asked for takes focus as it appears, to type in.

                      autoFocus={draft?.isAsked === true}
                      value={draft?.label ?? ''}
                      onChange={(text) => {
                        setDraft((before) => (before === undefined ? before : { ...before, label: text }));
                        setOne('new', undefined);
                      }}
                      onSubmit={() => {
                        commitDraft(true);
                      }}
                      onEscape={() => {
                        setDraft(undefined);
                        setOne('new', undefined);
                        focusIn((root) => root.querySelector<HTMLElement>('[data-adder] button'));
                      }}
                      onBlur={() => {
                        commitDraft(false);
                      }}
                      isErrorFloating
                      {...((local.new ?? errors.new) ? { error: local.new ?? errors.new } : {})}
                    />
                  </span>
                </GridListItem>
              );
            }
            const name = option.label;
            const isPending = pending.has(option.id);
            const error = local[option.id] ?? errors[option.id];
            const daysError = local[`${option.id}:days`];
            return (
              <GridListItem id={id} textValue={name} className={styles.row}>
                {!isReadOnly && <DragHandle label={strings.move(name)} />}
                {!isChoice && (
                  <HuePicker
                    label={strings.colourOf(name)}
                    value={option.hue}
                    isCompact
                    isReadOnly={isReadOnly}
                    onChange={(hue) => {
                      if (hue !== option.hue) onChange(option.id, { hue });
                    }}
                  />
                )}
                <span className={styles.label} data-static={isReadOnly || undefined}>
                  {isReadOnly && isChoice ? (
                    <span className={styles.text}>{name}</span>
                  ) : isReadOnly ? (
                    <Tag hue={option.hue}>{name}</Tag>
                  ) : (
                    <Field
                      label={placeName(index)}
                      isLabelHidden
                      size="sm"
                      maxLength={labelMaxLength}
                      autoComplete="off"
                      value={typedOf(option, 'label') ?? name}
                      onChange={(text) => {
                        type(option, 'label', text);
                        setOne(option.id, undefined);
                      }}
                      onSubmit={() => {
                        commitLabel(option);
                      }}
                      // Esc puts back a label being typed; with none, it reaches the dialog, which closes.
                      {...(typedOf(option, 'label') === undefined
                        ? {}
                        : {
                            onEscape: () => {
                              type(option, 'label', undefined);
                              setOne(option.id, undefined);
                            },
                          })}
                      onBlur={() => {
                        commitLabel(option);
                      }}
                      isErrorFloating
                      {...(error === undefined ? {} : { error })}
                    />
                  )}
                </span>
                {isStatus &&
                  (isReadOnly ? (
                    <span className={styles.meta}>
                      {OUTCOMES.find((each) => each.id === (option.outcome ?? 'open'))?.label}
                      {option.targetDays === undefined ? '' : strings.targetShown(option.targetDays)}
                    </span>
                  ) : (
                    <>
                      <span className={styles.outcome}>
                        <Select
                          label={strings.outcomeOf(name)}
                          isLabelHidden
                          size="sm"
                          items={OUTCOMES}
                          value={option.outcome ?? 'open'}
                          onChange={(next) => {
                            const outcome = OUTCOMES.find((each) => each.id === next)?.id;
                            if (outcome !== undefined && outcome !== option.outcome) onChange(option.id, { outcome });
                          }}
                        />
                      </span>
                      <span className={styles.days}>
                        <Field
                          label={strings.daysOf(name)}
                          isLabelHidden
                          size="sm"
                          inputMode="numeric"
                          autoComplete="off"
                          align="end"
                          suffix={strings.daysUnit}
                          value={typedOf(option, 'days') ?? baseOf(option, 'days')}
                          onChange={(text) => {
                            type(option, 'days', text);
                            setOne(`${option.id}:days`, undefined);
                          }}
                          onSubmit={() => {
                            commitDays(option);
                          }}
                          {...(typedOf(option, 'days') === undefined
                            ? {}
                            : {
                                onEscape: () => {
                                  type(option, 'days', undefined);
                                  setOne(`${option.id}:days`, undefined);
                                },
                              })}
                          onBlur={() => {
                            commitDays(option);
                          }}
                          isErrorFloating
                          {...(daysError === undefined ? {} : { error: daysError })}
                        />
                      </span>
                    </>
                  ))}
                {/* Choices are saved with their form, so no row waits on the server. */}
                {!isReadOnly && !isChoice && (
                  <span className={styles.pending}>{isPending && <Spinner label={strings.saving} />}</span>
                )}
                {!isReadOnly && isChoice && onRemove !== undefined && (
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.removeOf(name)}
                    onPress={() => {
                      removeRow(index, option.id);
                    }}
                  />
                )}
                {!isReadOnly && !isChoice && (
                  <MenuTrigger>
                    <Button variant="ghost" icon="ellipsis" label={strings.actionsFor(name)} />
                    <Menu
                      label={strings.actionsFor(name)}
                      onAction={(key) => {
                        const before = live[index - 1];
                        const after = live[index + 1];
                        if (key === 'up' && before !== undefined) moveTo(option.id, before.id, 'before');
                        else if (key === 'down' && after !== undefined) moveTo(option.id, after.id, 'after');
                        else if (key === 'remove') {
                          removeRow(index, option.id);
                          return;
                        } else if (key === 'archive') {
                          const next = after ?? before;
                          onArchive?.(option.id);
                          focusIn(
                            next === undefined
                              ? (root) => root.querySelector<HTMLElement>('[data-adder] button')
                              : rowControl(next.id, 'input'),
                          );
                          return;
                        }
                        focusIn(rowControl(option.id, 'button[aria-haspopup]'));
                      }}
                    >
                      <MenuItem id="up" icon="chevron-up" isDisabled={index === 0}>
                        {strings.moveUp}
                      </MenuItem>
                      <MenuItem id="down" icon="chevron-down" isDisabled={index === live.length - 1}>
                        {strings.moveDown}
                      </MenuItem>
                      {(onArchive !== undefined || onRemove !== undefined) && <MenuSeparator />}
                      {onArchive !== undefined && (
                        <MenuItem id="archive" icon="archive" isDanger>
                          {strings.archive}
                        </MenuItem>
                      )}
                      {onRemove !== undefined && (
                        <MenuItem id="remove" icon="trash" isDanger>
                          {strings.remove}
                        </MenuItem>
                      )}
                    </Menu>
                  </MenuTrigger>
                )}
              </GridListItem>
            );
          }}
        </GridList>
      )}
      {!isReadOnly && (
        <span className={styles.adder} data-adder="">
          <Button
            variant="dashed"
            icon="plus"
            isDisabled={isFull || draft !== undefined}
            onPress={() => {
              startDraft();
            }}
          >
            {isStatus ? strings.addStage : isChoice ? strings.addChoice : strings.addOption}
          </Button>
          {isFull && <span className={styles.note}>{isChoice ? strings.fullChoices(limit) : strings.full(limit)}</span>}
          {/* A refused add (its row gone with it) says why here, unless a blank row is open to show it. */}
          {draft === undefined && errors.new !== undefined && (
            <span className={styles.error} role="alert">
              {errors.new}
            </span>
          )}
        </span>
      )}
      {archived.length > 0 && (
        <Disclosure title={strings.archived} count={archived.length}>
          <ul className={styles.archived}>
            {archived.map((option) => (
              <li key={option.id} className={styles.archivedRow} data-archived={option.id}>
                <Tag hue={option.hue} isArchived>
                  {option.label}
                </Tag>
                {pending.has(option.id) && <Spinner label={strings.saving} />}
                {errors[option.id] !== undefined && <span className={styles.error}>{errors[option.id]}</span>}
                {!isReadOnly && onRestore !== undefined && (
                  <Button
                    variant="ghost"
                    icon="archive-restore"
                    isDisabled={isFull}
                    onPress={() => {
                      onRestore(option.id);
                      // Its button leaves with it: focus goes to the next archived option's, else Add option.
                      const at = archived.findIndex((each) => each.id === option.id);
                      const next = archived[at + 1] ?? archived[at - 1];
                      focusIn((root) =>
                        next === undefined
                          ? root.querySelector<HTMLElement>('[data-adder] button')
                          : root.querySelector<HTMLElement>(`[data-archived="${CSS.escape(next.id)}"] button`),
                      );
                    }}
                  >
                    {strings.restore}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </div>
  );
}
