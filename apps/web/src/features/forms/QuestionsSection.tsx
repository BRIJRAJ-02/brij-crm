// Brief
// Purpose: the Form tab's questions (spec 0023, 0023-experience.md, Questions): cards closed until opened, each with its editor.
// Main task: add, word, type, file, require, duplicate, delete (with Undo) and reorder the questions of the draft.
// Leaves out: saving (the editor saves the draft quietly), the look and the words around the questions (Settings).
import type { AnswerType, FormAttributeChoice, FormDocument, FormQuestion } from '@crm/data';
import {
  ANSWER_TYPES,
  CHOICE_TYPES,
  FORM_CHOICES_MAX,
  FORM_QUESTIONS_MAX,
  NO_PLACEHOLDER_TYPES,
  QUESTION_PRESETS,
} from '@crm/data/forms';
import {
  Button,
  Callout,
  Checkbox,
  Field,
  InfoTip,
  focusLater,
  LockReason,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  OptionsEditor,
  QuestionList,
  Select,
  SettingsRow,
  SettingsSection,
  SubmenuTrigger,
  Tooltip,
  type IconName,
  type OptionsEditorOption,
  type QuestionListItem,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addPreset,
  addQuestion,
  changeQuestion,
  duplicateQuestion,
  filedLine,
  fittingAttributes,
  isMatchQuestion,
  moveQuestion,
  removeQuestion,
  restoreQuestion,
  type QuestionChange,
} from './draft.ts';
import { strings } from './strings.ts';
import { ConditionsEditor, firstConditions } from '../routing/ConditionsEditor.tsx';
import { conditionsLine, questionFacts, storedShowWhen } from '../routing/facts.ts';
import { strings as routingStrings } from '../routing/strings.ts';

/** Each answer type's icon, on the tile that starts its question's row. */
const TYPE_ICONS = {
  short_text: 'type',
  long_text: 'file-text',
  email: 'mail',
  phone: 'phone',
  website: 'link',
  number: 'hash',
  dropdown: 'chevrons-up-down',
  choice: 'circle-dot',
  checkbox: 'square-check',
  yes_no: 'toggle-right',
  country: 'globe',
  file: 'upload',
} as const satisfies Record<AnswerType, IconName>;

/** Props for the questions section. */
export interface QuestionsSectionProps {
  readonly draft: FormDocument;
  readonly onChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** The target object's attributes, the choices for Where it goes. */
  readonly attributes: readonly FormAttributeChoice[];
  /** The target object's name; absent while the form keeps its submissions only, when no answer is filed. */
  readonly objectName?: string;
  /** Questions in the live version: their keys stay as they are. */
  readonly liveIds: ReadonlySet<string>;
  readonly newId: () => string;
  readonly toasts: Toasts;
  /** The question a publish refused, and why: kept open, with the error inline. */
  readonly problem?: { readonly questionId: string; readonly message: string };
  /** A question to open and bring into view as the screen shows (a link from Settings' map of where answers go). */
  readonly focusQuestionId?: string;
  readonly isReadOnly: boolean;
}

/** The answer types a question may take now (file questions wait for file attachments). */
const TYPE_ITEMS = ANSWER_TYPES.map((type) => ({
  id: type,
  label: strings.answerTypes[type],
  icon: TYPE_ICONS[type],
}));

/** The questions: a header with the count and Add a question, then the cards. */
export function QuestionsSection(props: QuestionsSectionProps) {
  const { draft, onChange, attributes, objectName, liveIds, newId, toasts, problem, isReadOnly } = props;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [justAdded, setJustAdded] = useState<string | undefined>(undefined);
  // Questions whose choices list holds a refused edit (a repeated choice): marked, and kept open, until it is put right.
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const markRefused = (id: string, isRefused: boolean) => {
    setRefused((before) => {
      if (before.has(id) === isRefused) return before;
      const next = new Set(before);
      if (isRefused) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // A question a publish refused is open, and stays open until it is fixed.
  const openIds = useMemo(
    () => new Set([...open, ...refused, ...(problem === undefined ? [] : [problem.questionId])]),
    [open, refused, problem],
  );

  const isFull = draft.questions.length >= FORM_QUESTIONS_MAX;
  const opened = (id: string) => {
    setOpen((before) => new Set([...before, id]));
    setJustAdded(id);
  };

  // A link to one question opens it and brings it into view, once per question it names: only a new link opens
  // one, so edits to the draft never reopen it.
  const { focusQuestionId } = props;
  const [focused, setFocused] = useState<string | undefined>(undefined);
  if (focusQuestionId !== focused) {
    setFocused(focusQuestionId);
    if (focusQuestionId !== undefined && draft.questions.some((question) => question.id === focusQuestionId)) {
      setOpen((before) => new Set([...before, focusQuestionId]));
      setJustAdded(focusQuestionId);
    }
  }

  const add = () => {
    if (isFull) return;
    const id = newId();
    onChange((before) => addQuestion(before, id));
    opened(id);
  };

  const remove = (question: FormQuestion) => {
    onChange((before) => removeQuestion(before, question.id).document);
    const index = draft.questions.findIndex((each) => each.id === question.id);
    const name = question.label === '' ? strings.untitledQuestion : question.label;
    const filed =
      question.filedOn === undefined || objectName === undefined
        ? undefined
        : filedLine(question, objectName, attributes);
    toasts.toast({
      tone: 'info',
      message: filed === undefined ? strings.questionDeleted(name) : strings.questionDeletedFiled(name, filed),
      action: {
        label: strings.undo,
        onAction: () => {
          onChange((before) => restoreQuestion(before, question, index));
        },
      },
    });
  };

  const items: readonly QuestionListItem[] = draft.questions.map((question) => ({
    id: question.id,
    label: question.label,
    typeLabel: strings.answerTypes[question.answerType],
    typeIcon: TYPE_ICONS[question.answerType],
    isRequired: question.required,
    ...(CHOICE_TYPES.includes(question.answerType)
      ? { choiceCount: (question.choices ?? []).filter((choice) => choice.trim() !== '').length }
      : {}),
    // The card's line is a list split by " · ": unfiled says so in two words, the full sentence lives in Where it goes.
    // A form that keeps its submissions only files nothing, so its cards say nothing about it.
    ...(objectName === undefined
      ? {}
      : {
          filed: question.filedOn === undefined ? strings.notFiledShort : filedLine(question, objectName, attributes),
        }),
    ...(question.showWhen === undefined
      ? {}
      : {
          condition: routingStrings.shownWhen(
            conditionsLine(
              question.showWhen,
              questionFacts(draft.questions.slice(0, draft.questions.indexOf(question))),
            ),
          ),
        }),
    hasProblem: problem?.questionId === question.id || refused.has(question.id),
  }));

  return (
    <QuestionList
      label={strings.questions}
      actions={
        <>
          {!isReadOnly && (
            <>
              {isFull ? (
                // Off at the most a form holds, and says so on hover and focus.
                <Tooltip content={strings.tooManyQuestions}>
                  <Button icon="plus" isDisabled>
                    {strings.addQuestion}
                  </Button>
                </Tooltip>
              ) : (
                <Button icon="plus" onPress={add}>
                  {strings.addQuestion}
                </Button>
              )}
              <MenuTrigger>
                <Button variant="ghost" icon="ellipsis" label={strings.questionMenu} />
                <Menu
                  label={strings.questionMenu}
                  onAction={(key) => {
                    if (key === 'close') setOpen(new Set(problem === undefined ? [] : [problem.questionId]));
                  }}
                >
                  <SubmenuTrigger>
                    <MenuItem
                      icon="list-plus"
                      isDisabled={isFull}
                      {...(isFull ? { description: strings.tooManyQuestions } : {})}
                    >
                      {strings.addFromPresets}
                    </MenuItem>
                    <Menu
                      label={strings.addFromPresets}
                      onAction={(key) => {
                        const preset = QUESTION_PRESETS.find((each) => each.key === key);
                        if (preset === undefined || isFull) return;
                        const id = newId();
                        onChange((before) => addPreset(before, preset, id));
                        opened(id);
                      }}
                    >
                      {QUESTION_PRESETS.map((preset) => (
                        <MenuItem key={preset.key} id={preset.key}>
                          {preset.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  </SubmenuTrigger>
                  <MenuSeparator />
                  <MenuItem id="close" icon="chevron-up">
                    {strings.closeAll}
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </>
          )}
        </>
      }
      items={items}
      openIds={openIds}
      onOpenChange={(id, isOpen) => {
        // The question a publish refused stays open until it is fixed.
        if (!isOpen && problem?.questionId === id) return;
        setOpen((before) => {
          const next = new Set(before);
          if (isOpen) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      renderOpen={(id) => {
        const question = draft.questions.find((each) => each.id === id);
        if (question === undefined) return null;
        return (
          <QuestionEditor
            question={question}
            draft={draft}
            attributes={attributes}
            isFiling={objectName !== undefined}
            isReadOnly={isReadOnly}
            // A question just added, or one a publish refused, takes focus and comes into view.
            isJustAdded={justAdded === id || problem?.questionId === id}
            {...(problem?.questionId === id ? { problem: problem.message } : {})}
            onChange={(change) => {
              onChange((before) => changeQuestion(before, id, change, liveIds));
            }}
            onChoicesInvalid={(isInvalid) => {
              markRefused(id, isInvalid);
            }}
          />
        );
      }}
      renderFooterStart={(id) => {
        const question = draft.questions.find((each) => each.id === id);
        if (question === undefined) return null;
        return (
          <Checkbox
            label={strings.mustAnswer}
            isSelected={question.required}
            isReadOnly={isReadOnly}
            onChange={(required) => {
              onChange((before) => changeQuestion(before, id, { required }, liveIds));
            }}
          />
        );
      }}
      renderFooter={(id) => {
        const question = draft.questions.find((each) => each.id === id);
        if (question === undefined || isReadOnly) return null;
        return (
          <>
            <Tooltip content={strings.duplicateQuestion}>
              <Button
                variant="ghost"
                size="lg"
                icon="copy"
                label={strings.duplicateQuestion}
                onPress={() => {
                  const copy = newId();
                  onChange((before) => duplicateQuestion(before, id, copy));
                  opened(copy);
                }}
              />
            </Tooltip>
            {isMatchQuestion(draft, question) ? (
              <LockReason reason={strings.emailStays} />
            ) : (
              <Tooltip content={strings.deleteQuestion}>
                <Button
                  variant="ghost-danger"
                  size="lg"
                  icon="trash"
                  label={strings.deleteQuestion}
                  onPress={() => {
                    remove(question);
                  }}
                />
              </Tooltip>
            )}
          </>
        );
      }}
      {...(isReadOnly
        ? {}
        : {
            onMove: (id: string, index: number) => {
              onChange((before) => moveQuestion(before, id, index));
            },
          })}
    />
  );
}

/** Props for one open question. */
interface QuestionEditorProps {
  readonly question: FormQuestion;
  readonly draft: FormDocument;
  readonly attributes: readonly FormAttributeChoice[];
  /** The form adds submissions to the CRM, so Where it goes shows; a form that keeps them only files nothing. */
  readonly isFiling: boolean;
  readonly isReadOnly: boolean;
  /** Just added: its Question field takes focus, and the card scrolls into view. */
  readonly isJustAdded: boolean;
  readonly problem?: string;
  readonly onChange: (change: QuestionChange) => void;
  /** The choices list holds a refused edit, or no longer does. */
  readonly onChoicesInvalid: (isInvalid: boolean) => void;
}

/** One question open: Question, Answer type, Choices, Placeholder, Where it goes, Visitors must answer. */
function QuestionEditor({
  question,
  draft,
  attributes,
  isFiling,
  isReadOnly,
  isJustAdded,
  problem,
  onChange,
  onChoicesInvalid,
}: QuestionEditorProps) {
  const labelRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // A question just added takes focus without jumping, then glides into view (at once with reduced motion).
  useEffect(() => {
    if (!isJustAdded) return;
    const input = labelRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    input.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }, [isJustAdded]);

  const isChoice = CHOICE_TYPES.includes(question.answerType);
  const choices = question.choices ?? [];
  const fitting = fittingAttributes(attributes, question.answerType);
  const usedBy = new Map(
    draft.questions
      .filter((each) => each.id !== question.id && each.filedOn !== undefined)
      .map((each) => [each.filedOn?.attributeId ?? '', each.label === '' ? strings.untitledQuestion : each.label]),
  );
  const isLocked = isMatchQuestion(draft, question);

  return (
    <>
      <Field
        ref={labelRef}
        label={strings.question}
        placeholder={strings.questionPlaceholder}
        value={question.label}
        maxLength={200}
        isReadOnly={isReadOnly}
        onChange={(label) => {
          onChange({ label });
        }}
        {...(problem === undefined ? {} : { error: problem })}
      />
      <Select
        label={strings.answerType}
        items={TYPE_ITEMS}
        value={question.answerType}
        isReadOnly={isReadOnly || isLocked}
        onChange={(type) => {
          if (type !== null) onChange({ answerType: type as AnswerType });
        }}
      />
      {isChoice && (
        <ChoicesEditor
          choices={choices}
          isReadOnly={isReadOnly}
          onInvalidChange={onChoicesInvalid}
          onChange={(next) => {
            onChange({ choices: next });
          }}
        />
      )}
      {!NO_PLACEHOLDER_TYPES.includes(question.answerType) && (
        <Field
          label={strings.placeholder}
          hint={strings.placeholderHint}
          value={question.placeholder ?? ''}
          maxLength={80}
          isReadOnly={isReadOnly}
          onChange={(placeholder) => {
            onChange({ placeholder });
          }}
        />
      )}
      {!isLocked && <ShowWhenEditor question={question} draft={draft} isReadOnly={isReadOnly} onChange={onChange} />}
      {isFiling && (
        <Select
          label={strings.whereItGoes}
          info={
            <InfoTip label={strings.whereItGoes} example={strings.whereItGoesExample}>
              {strings.whereItGoesHelp}
            </InfoTip>
          }
          items={[
            { id: 'none', label: strings.notFiled },
            ...fitting.map((attribute) => {
              const holder = usedBy.get(attribute.attributeId);
              return {
                id: attribute.attributeId,
                label: attribute.title,
                ...(holder === undefined ? {} : { description: strings.takenBy(holder) }),
                ...(attribute.canWrite ? {} : { description: strings.cantWrite, isArchived: true }),
              };
            }),
          ]}
          value={question.filedOn?.attributeId ?? 'none'}
          isReadOnly={isReadOnly || isLocked}
          onChange={(id) => {
            onChange({ filedOn: id === null || id === 'none' ? null : id });
          }}
        />
      )}
    </>
  );
}

/** Props for a choice question's choices. */
interface ChoicesEditorProps {
  readonly choices: readonly string[];
  readonly isReadOnly: boolean;
  readonly onChange: (next: readonly string[]) => void;
  /** Whether a row holds a refused edit (a repeated choice), so the question can say it needs a fix. */
  readonly onInvalidChange: (isInvalid: boolean) => void;
}

/** The longest choice the form contract takes (`document.ts`: "Keep a choice to 80 characters."). */
const FORM_CHOICE_LENGTH_MAX = 80;

/** A row id the editor keys its rows by, for this session only: choices are plain words with no ids of their own. */
function mintChoiceId(): string {
  return crypto.randomUUID();
}

/**
 * The choices as the library's options list (its `choice` kind): reorder by
 * the handle, rename in place, a quiet remove on each, and Add choice opens a
 * blank row where Enter adds it and stays for the next.
 */
function ChoicesEditor({ choices, isReadOnly, onChange, onInvalidChange }: ChoicesEditorProps) {
  // A refused edit leaves with the list (the answer type changed): the question no longer needs a fix for it.
  const tellInvalid = useRef(onInvalidChange);
  useEffect(() => {
    tellInvalid.current = onInvalidChange;
  });
  useEffect(
    () => () => {
      tellInvalid.current(false);
    },
    [],
  );
  // Each choice's row id, by place. Kept in step with the choices: an outside
  // change of length (Undo, a duplicate) mints fresh ids for the rows it adds.
  const [ids, setIds] = useState<readonly string[]>(() => choices.map(mintChoiceId));
  const rowIds =
    ids.length === choices.length
      ? ids
      : [...ids.slice(0, choices.length), ...choices.slice(ids.length).map(mintChoiceId)];
  if (rowIds !== ids) setIds(rowIds);
  const options: readonly OptionsEditorOption[] = choices.map((label, index) => ({
    id: rowIds[index] ?? String(index),
    label,
    hue: 'gray',
    isArchived: false,
  }));
  const commit = (nextIds: readonly string[], next: readonly string[]) => {
    setIds(nextIds);
    onChange(next);
  };

  return (
    <OptionsEditor
      label={strings.choices}
      kind="choice"
      options={options}
      limit={FORM_CHOICES_MAX}
      labelMaxLength={FORM_CHOICE_LENGTH_MAX}
      // A new choice question opens with the editor's blank row, which waits for Tab.
      startsWithBlank={choices.length === 0}
      newId={mintChoiceId}
      isReadOnly={isReadOnly}
      onInvalidChange={onInvalidChange}
      onAdd={(option) => {
        commit([...rowIds, option.id], [...choices, option.label]);
      }}
      onChange={(id, change) => {
        if (change.label === undefined) return;
        const label = change.label;
        onChange(choices.map((each, at) => (rowIds[at] === id ? label : each)));
      }}
      onRemove={(id) => {
        const at = rowIds.indexOf(id);
        commit(
          rowIds.filter((_, place) => place !== at),
          choices.filter((_, place) => place !== at),
        );
      }}
      onMove={(id, position) => {
        const from = rowIds.indexOf(id);
        if (from < 0) return;
        const moveOne = <T,>(list: readonly T[]): readonly T[] => {
          const rest = list.filter((_, place) => place !== from);
          const moving = list[from];
          return moving === undefined ? list : [...rest.slice(0, position), moving, ...rest.slice(position)];
        };
        commit(moveOne(rowIds), moveOne(choices));
      }}
    />
  );
}

/** Props for a question's Show when. */
interface ShowWhenEditorProps {
  readonly question: FormQuestion;
  readonly draft: FormDocument;
  readonly isReadOnly: boolean;
  readonly onChange: (change: QuestionChange) => void;
}

/**
 * Show when (spec 0043, AC-1615): off, a line saying the question always shows and Add a condition; on, its
 * conditions over the questions before it, and Always show it. A form's first question has nothing to read.
 */
function ShowWhenEditor({ question, draft, isReadOnly, onChange }: ShowWhenEditorProps) {
  const earlier = questionFacts(
    draft.questions.slice(
      0,
      draft.questions.findIndex((each) => each.id === question.id),
    ),
  );
  const { showWhen } = question;
  // Turning Show when on or off swaps what is drawn: focus follows to the first condition, or to Add a condition.
  const addRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  if (showWhen === undefined) {
    return (
      <SettingsRow
        title={routingStrings.showWhen}
        description={earlier.length === 0 ? routingStrings.noEarlier : routingStrings.alwaysShown}
      >
        {!isReadOnly && (
          <Button
            ref={addRef}
            variant="dashed"
            icon="plus"
            isDisabled={earlier.length === 0}
            onPress={() => {
              onChange({ showWhen: storedShowWhen(firstConditions(earlier)) });
              focusLater(() => firstRef.current);
            }}
          >
            {routingStrings.addShowWhen}
          </Button>
        )}
      </SettingsRow>
    );
  }
  // A question moved above one its Show when reads: said here, as publish would refuse it.
  const readsLater = showWhen.rules.some((condition) => !earlier.some((fact) => fact.key === condition.key));
  return (
    <SettingsSection title={routingStrings.showWhen} description={routingStrings.showWhenHint}>
      {readsLater && <Callout tone="danger">{routingStrings.readsLater}</Callout>}
      <ConditionsEditor
        value={showWhen}
        facts={earlier}
        factLabel={routingStrings.question}
        isReadOnly={isReadOnly}
        firstRef={firstRef}
        onChange={(next) => onChange({ showWhen: storedShowWhen(next) })}
      />
      {!isReadOnly && (
        <Button
          variant="ghost"
          icon="x"
          onPress={() => {
            onChange({ showWhen: null });
            focusLater(() => addRef.current);
          }}
        >
          {routingStrings.clearShowWhen}
        </Button>
      )}
    </SettingsSection>
  );
}
