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
  Checkbox,
  Field,
  LockReason,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  QuestionList,
  Select,
  SubmenuTrigger,
  Tooltip,
  type QuestionListItem,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

/** Props for the questions section. */
export interface QuestionsSectionProps {
  readonly draft: FormDocument;
  readonly onChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** The target object's attributes, the choices for Where it goes. */
  readonly attributes: readonly FormAttributeChoice[];
  readonly objectName: string;
  /** Questions in the live version: their keys stay as they are. */
  readonly liveIds: ReadonlySet<string>;
  readonly newId: () => string;
  readonly toasts: Toasts;
  /** The question a publish refused, and why: kept open, with the error inline. */
  readonly problem?: { readonly questionId: string; readonly message: string };
  readonly isReadOnly: boolean;
}

/** The answer types a question may take now (file questions wait for file attachments). */
const TYPE_ITEMS = ANSWER_TYPES.filter((type) => type !== 'file').map((type) => ({
  id: type,
  label: strings.answerTypes[type],
}));

/** The questions: a header with the count and Add a question, then the cards. */
export function QuestionsSection(props: QuestionsSectionProps) {
  const { draft, onChange, attributes, objectName, liveIds, newId, toasts, problem, isReadOnly } = props;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [justAdded, setJustAdded] = useState<string | undefined>(undefined);

  // A question a publish refused is open, and stays open until it is fixed.
  const openIds = useMemo(
    () => (problem === undefined ? open : new Set([...open, problem.questionId])),
    [open, problem],
  );

  const isFull = draft.questions.length >= FORM_QUESTIONS_MAX;
  const opened = (id: string) => {
    setOpen((before) => new Set([...before, id]));
    setJustAdded(id);
  };

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
    const filed = question.filedOn === undefined ? undefined : filedLine(question, objectName, attributes);
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
    isRequired: question.required,
    ...(CHOICE_TYPES.includes(question.answerType)
      ? { choiceCount: (question.choices ?? []).filter((choice) => choice.trim() !== '').length }
      : {}),
    filed: filedLine(question, objectName, attributes),
    hasProblem: problem?.questionId === question.id,
  }));

  return (
    <QuestionList
      label={strings.questions}
      actions={
        <>
          {!isReadOnly && (
            <>
              <Button icon="plus" onPress={add} isDisabled={isFull}>
                {strings.addQuestion}
              </Button>
              <MenuTrigger>
                <Button variant="ghost" icon="ellipsis" label={strings.questionMenu} />
                <Menu
                  label={strings.questionMenu}
                  onAction={(key) => {
                    if (key === 'close') setOpen(new Set(problem === undefined ? [] : [problem.questionId]));
                  }}
                >
                  <SubmenuTrigger>
                    <MenuItem icon="list-plus" isDisabled={isFull}>
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
            isReadOnly={isReadOnly}
            isJustAdded={justAdded === id}
            {...(problem?.questionId === id ? { problem: problem.message } : {})}
            onChange={(change) => {
              onChange((before) => changeQuestion(before, id, change, liveIds));
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
  readonly isReadOnly: boolean;
  /** Just added: its Question field takes focus, and the card scrolls into view. */
  readonly isJustAdded: boolean;
  readonly problem?: string;
  readonly onChange: (change: QuestionChange) => void;
}

/** One question open: Question, Answer type, Choices, Placeholder, Where it goes, Visitors must answer. */
function QuestionEditor({
  question,
  draft,
  attributes,
  isReadOnly,
  isJustAdded,
  problem,
  onChange,
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
      <Select
        label={strings.whereItGoes}
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
      <Checkbox
        label={strings.mustAnswer}
        isSelected={question.required}
        isReadOnly={isReadOnly}
        onChange={(required) => {
          onChange({ required });
        }}
      />
    </>
  );
}

/** Props for a choice question's choices. */
interface ChoicesEditorProps {
  readonly choices: readonly string[];
  readonly isReadOnly: boolean;
  readonly onChange: (next: readonly string[]) => void;
}

/**
 * One input per choice. Another choice appends one and focuses it; Enter in
 * the last adds the next; Backspace in an empty one removes it and focuses
 * the one before.
 */
function ChoicesEditor({ choices, isReadOnly, onChange }: ChoicesEditorProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // The choice to focus once the list has drawn its change.
  const focusAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (focusAt.current === undefined) return;
    listRef.current?.querySelectorAll('input')[focusAt.current]?.focus();
    focusAt.current = undefined;
  }, [choices]);
  const setFocusAt = (index: number) => {
    focusAt.current = index;
  };

  const append = () => {
    if (choices.length >= FORM_CHOICES_MAX) return;
    onChange([...choices, '']);
    setFocusAt(choices.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Backspace' || !(event.target instanceof HTMLInputElement) || event.target.value !== '') return;
    const inputs = [...(listRef.current?.querySelectorAll('input') ?? [])];
    const index = inputs.indexOf(event.target);
    if (index < 0 || choices.length <= 1) return;
    event.preventDefault();
    onChange(choices.filter((_, at) => at !== index));
    setFocusAt(Math.max(0, index - 1));
  };

  return (
    // The group only hears Backspace from the choice fields inside it; they take every other key.
    <div ref={listRef} role="group" aria-label={strings.choices} onKeyDownCapture={onKeyDown}>
      {choices.length === 0 && <p>{strings.noChoices}</p>}
      {choices.map((choice, index) => (
        <Field
          // Choices have no ids of their own: their place is their identity while editing.
          key={index}
          label={strings.choice(index + 1)}
          isLabelHidden={index > 0}
          size="sm"
          value={choice}
          maxLength={80}
          isReadOnly={isReadOnly}
          onChange={(text) => {
            onChange(choices.map((each, at) => (at === index ? text : each)));
          }}
          onSubmit={() => {
            if (index === choices.length - 1) append();
          }}
          {...(isReadOnly || choices.length <= 1
            ? {}
            : {
                suffix: (
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.removeChoice(index + 1)}
                    onPress={() => {
                      onChange(choices.filter((_, at) => at !== index));
                    }}
                  />
                ),
              })}
        />
      ))}
      {!isReadOnly && (
        <Button variant="ghost" icon="plus" onPress={append} isDisabled={choices.length >= FORM_CHOICES_MAX}>
          {strings.anotherChoice}
        </Button>
      )}
    </div>
  );
}
