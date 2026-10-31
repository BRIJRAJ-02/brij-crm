// Brief
// Purpose: a list of questions (spec 0023, 0023-experience.md, Questions), shared by a form's Form tab and a booking page's editor (spec 0057): cards closed until opened, each with its editor.
// Main task: add, word, type, file, require, duplicate, delete (with Undo) and reorder the questions.
// Leaves out: saving (each editor saves as it goes), the look and the words around the questions.
import type { AnswerType, FormAttributeChoice, FormQuestion } from '@crm/data';
import {
  ANSWER_TYPES,
  CHOICE_TYPES,
  FORM_CHOICES_MAX,
  FORM_STEP_TITLE_MAX,
  NO_PLACEHOLDER_TYPES,
  QUESTION_PRESETS,
  type FormLayout,
  type FormStep,
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
  typeChange,
  planNewAttributes,
  moveQuestion,
  removeQuestion,
  restoreQuestion,
  type QuestionChange,
  type Questions,
} from './questions.ts';
import {
  addStep,
  changeStep,
  itemsOf,
  moveItem,
  questionsBefore,
  removeStep,
  restoreStep,
  stepPlaces,
  type Flow,
  type StepChange,
} from './steps.ts';
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
  readonly questions: Questions;
  /** A change to the list, as a function of the list it applies to, so changes made quickly never undo each other. */
  readonly onChange: (update: (before: Questions) => Questions) => void;
  /** The most questions the list holds, and what holds it ("A form"), for Add a question's tooltip at the most. */
  readonly max: number;
  readonly holder: string;
  /** What an unfiled answer stays with: a form's submission, or a booking. */
  readonly keptWith: 'submission' | 'booking';
  /** The target object's attributes, the choices for Where it goes. */
  readonly attributes: readonly FormAttributeChoice[];
  /** The target object's name; absent while the form keeps its submissions only, when no answer is filed. */
  readonly objectName?: string;
  /**
   * Where it goes shows, off and at Not filed, with why: a booking page kept out of the CRM (spec 0057, AC-5708). Each
   * question keeps where it was filed, so turning the CRM back on puts it back.
   */
  readonly isFilingOff?: boolean;
  /** Questions that stay as they are (a form's match question): no delete, no type or filing change, and why. */
  readonly locked?: { readonly ids: ReadonlySet<string>; readonly reason: string };
  /** Questions in the live version: their keys stay as they are. */
  readonly liveIds: ReadonlySet<string>;
  readonly newId: () => string;
  readonly toasts: Toasts;
  /** The question a publish refused, and why: kept open, with the error inline. */
  readonly problem?: { readonly questionId: string; readonly message: string };
  /** A question to open and bring into view as the screen shows (a link from Settings' map of where answers go). */
  readonly focusQuestionId?: string;
  /** Whether the member may add attributes: an unfiled question is then filed onto a new one when the form is published. */
  readonly canCreate?: boolean;
  readonly isReadOnly: boolean;
  /**
   * A form's New step dividers (spec 0063, AC-6303), in the list among the questions: given, the list draws them,
   * moves questions and dividers together through `onChange`, and offers Add a step. A booking page has none.
   */
  readonly steps?: StepsProps;
}

/** A form's step dividers, as the questions section draws and changes them. */
export interface StepsProps {
  readonly steps: readonly FormStep[];
  readonly layout: FormLayout;
  /** A change to the questions and dividers together, as a function of what it applies to. */
  readonly onChange: (update: (before: Flow) => Flow) => void;
  /** The divider a publish refused, and why: kept open, with the error under its title. */
  readonly problem?: { readonly stepId: string; readonly message: string };
}

/** A divider's row id in the list: apart from the questions' ids, which share their pattern. */
const STEP_ROW = 'step:';
const stepOfRow = (rowId: string) => (rowId.startsWith(STEP_ROW) ? rowId.slice(STEP_ROW.length) : undefined);

/** Where it goes' two choices that are not a field: a new field made on Save, and the answer kept off the CRM. */
const CREATE = 'create';
const NOT_FILED = 'none';

/** The answer types a question may take now (file questions wait for file attachments). */
const TYPE_ITEMS = ANSWER_TYPES.map((type) => ({
  id: type,
  label: strings.answerTypes[type],
  icon: TYPE_ICONS[type],
}));

/** The questions: a header with the count and Add a question, then the cards. */
export function QuestionsSection(props: QuestionsSectionProps) {
  const { questions, onChange, attributes, objectName, liveIds, newId, toasts, problem, isReadOnly } = props;
  const isFilingOff = props.isFilingOff === true;
  const isLocked = (question: FormQuestion) => props.locked?.ids.has(question.id) === true;
  const words =
    props.keptWith === 'booking'
      ? {
          notFiled: strings.notFiledBooking,
          cantCreate: strings.cantCreateBooking,
          help: strings.whereItGoesHelpBooking,
        }
      : { notFiled: strings.notFiled, cantCreate: strings.cantCreate, help: strings.whereItGoesHelp };
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
  const breaks = props.steps;
  const stepProblem = breaks?.problem;
  const openIds = useMemo(
    () =>
      new Set([
        ...open,
        ...refused,
        ...(problem === undefined ? [] : [problem.questionId]),
        ...(stepProblem === undefined ? [] : [`${STEP_ROW}${stepProblem.stepId}`]),
      ]),
    [open, refused, problem, stepProblem],
  );

  // Unfiled questions the publish will give an attribute: each says so until it exists.
  const planned = useMemo(
    () =>
      new Map(
        planNewAttributes(
          questions,
          attributes,
          objectName !== undefined && !isFilingOff && props.canCreate === true && !isReadOnly,
        ).map((plan) => [plan.questionId, plan.title]),
      ),
    [questions, attributes, objectName, isFilingOff, props.canCreate, isReadOnly],
  );
  // The field each question would get if it asked for one, kept ones included: what the Create choice is titled.
  const creatable = useMemo(
    () =>
      new Map(
        planNewAttributes(
          questions.map((question) => {
            const { kept: _kept, ...rest } = question;
            return rest;
          }),
          attributes,
          objectName !== undefined && !isFilingOff && props.canCreate === true && !isReadOnly,
        ).map((plan) => [plan.questionId, plan.title]),
      ),
    [questions, attributes, objectName, isFilingOff, props.canCreate, isReadOnly],
  );
  const isFull = questions.length >= props.max;
  const tooMany = strings.tooManyQuestions(props.holder, props.max);
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
    if (focusQuestionId !== undefined && questions.some((question) => question.id === focusQuestionId)) {
      setOpen((before) => new Set([...before, focusQuestionId]));
      setJustAdded(focusQuestionId);
    }
  }

  // A booking page's new question starts Not filed (flow walks B3): a guest's answer stays with the booking unless
  // the host picks a field, rather than every question quietly becoming a column on everyone's People table. A form
  // keeps filing onto a new field by default (spec 0023), since filing is what a form is for.
  const keptAtFirst = (list: readonly FormQuestion[], id: string): readonly FormQuestion[] =>
    props.keptWith === 'booking'
      ? list.map((each) => (each.id === id && each.filedOn === undefined ? { ...each, kept: true as const } : each))
      : list;

  const add = () => {
    if (isFull) return;
    const id = newId();
    onChange((before) => keptAtFirst(addQuestion(before, id), id));
    opened(id);
  };

  const remove = (question: FormQuestion) => {
    onChange((before) => removeQuestion(before, question.id).questions);
    const index = questions.findIndex((each) => each.id === question.id);
    const name = question.label === '' ? strings.untitledQuestion : question.label;
    const filed =
      question.filedOn === undefined || objectName === undefined || isFilingOff
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

  const questionItems: readonly QuestionListItem[] = questions.map((question) => ({
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
          filed:
            question.filedOn === undefined || isFilingOff
              ? planned.has(question.id)
                ? strings.willCreateShort(planned.get(question.id) ?? '')
                : strings.notFiledShort
              : filedLine(question, objectName, attributes),
        }),
    ...(question.showWhen === undefined
      ? {}
      : {
          condition: routingStrings.shownWhen(
            conditionsLine(question.showWhen, questionFacts(questions.slice(0, questions.indexOf(question)))),
          ),
        }),
    hasProblem: problem?.questionId === question.id || refused.has(question.id),
  }));
  // With dividers, each in its place among the questions (spec 0063): a step's place and title, what it holds, its
  // Show when, and outside Steps a quiet note that only Steps draws it.
  const flow: Flow | undefined = breaks === undefined ? undefined : { questions, steps: breaks.steps };
  const places = flow === undefined ? new Map<string, { number: number; count: number }>() : stepPlaces(flow);
  const items: readonly QuestionListItem[] =
    flow === undefined || breaks === undefined
      ? questionItems
      : itemsOf(flow).flatMap((item): QuestionListItem[] => {
          if (item.kind === 'question') return questionItems.filter((each) => each.id === item.id);
          const step = breaks.steps.find((each) => each.id === item.id);
          if (step === undefined) return [];
          const place = places.get(step.id) ?? { number: 1, count: 0 };
          return [
            {
              id: `${STEP_ROW}${step.id}`,
              kind: 'step',
              label: strings.stepName(place.number, step.title),
              typeIcon: 'layers',
              note: [strings.stepHolds(place.count), ...(breaks.layout === 'steps' ? [] : [strings.stepsOnly])].join(
                strings.separator,
              ),
              ...(step.showWhen === undefined
                ? {}
                : {
                    condition: routingStrings.shownWhen(
                      conditionsLine(step.showWhen, questionFacts(questionsBefore(flow, step.id))),
                    ),
                  }),
              hasProblem: stepProblem?.stepId === step.id,
            },
          ];
        });

  const addBreak = () => {
    if (breaks === undefined) return;
    const id = newId();
    breaks.onChange((before) => addStep(before, id));
    opened(`${STEP_ROW}${id}`);
  };

  const removeBreak = (stepId: string) => {
    if (breaks === undefined || flow === undefined) return;
    const step = breaks.steps.find((each) => each.id === stepId);
    if (step === undefined) return;
    const name = strings.stepName(places.get(stepId)?.number ?? 1, step.title);
    const index = breaks.steps.indexOf(step);
    breaks.onChange((before) => removeStep(before, stepId).flow);
    toasts.toast({
      tone: 'info',
      message: strings.stepRemoved(name),
      action: {
        label: strings.undo,
        onAction: () => {
          breaks.onChange((before) => restoreStep(before, step, index));
        },
      },
    });
  };

  return (
    <QuestionList
      label={strings.questions}
      actions={
        <>
          {!isReadOnly && (
            <>
              {breaks?.layout === 'steps' && (
                <Button variant="ghost" icon="layers" onPress={addBreak}>
                  {strings.addStep}
                </Button>
              )}
              {isFull ? (
                // Off at the most a form holds, and says so on hover and focus.
                <Tooltip content={tooMany}>
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
                    if (key === 'step') addBreak();
                  }}
                >
                  {breaks !== undefined && breaks.layout !== 'steps' && (
                    <MenuItem id="step" icon="layers" description={strings.stepsOnly}>
                      {strings.addStep}
                    </MenuItem>
                  )}
                  <SubmenuTrigger>
                    <MenuItem icon="list-plus" isDisabled={isFull} {...(isFull ? { description: tooMany } : {})}>
                      {strings.addFromPresets}
                    </MenuItem>
                    <Menu
                      label={strings.addFromPresets}
                      onAction={(key) => {
                        const preset = QUESTION_PRESETS.find((each) => each.key === key);
                        if (preset === undefined || isFull) return;
                        const id = newId();
                        onChange((before) => keptAtFirst(addPreset(before, preset, id), id));
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
        // The question or divider a publish refused stays open until it is fixed.
        if (!isOpen && (problem?.questionId === id || `${STEP_ROW}${stepProblem?.stepId ?? ''}` === id)) return;
        setOpen((before) => {
          const next = new Set(before);
          if (isOpen) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      renderOpen={(id) => {
        const stepId = stepOfRow(id);
        if (stepId !== undefined) {
          const step = breaks?.steps.find((each) => each.id === stepId);
          if (step === undefined || breaks === undefined || flow === undefined) return null;
          return (
            <StepEditor
              step={step}
              earlier={questionsBefore(flow, stepId)}
              isReadOnly={isReadOnly}
              isJustAdded={justAdded === id || stepProblem?.stepId === stepId}
              {...(stepProblem?.stepId === stepId ? { problem: stepProblem.message } : {})}
              onChange={(change) => {
                breaks.onChange((before) => changeStep(before, stepId, change));
              }}
            />
          );
        }
        const question = questions.find((each) => each.id === id);
        if (question === undefined) return null;
        return (
          <QuestionEditor
            question={question}
            questions={questions}
            attributes={attributes}
            isFiling={objectName !== undefined}
            isFilingOff={isFilingOff}
            isLocked={isLocked(question)}
            words={words}
            {...(objectName === undefined ? {} : { objectName })}
            {...(planned.has(id) ? { willCreate: planned.get(id) ?? '' } : {})}
            {...(creatable.has(id) ? { createTitle: creatable.get(id) ?? '' } : {})}
            canCreate={props.canCreate === true}
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
        const question = questions.find((each) => each.id === id);
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
        const stepId = stepOfRow(id);
        if (stepId !== undefined) {
          return isReadOnly ? null : (
            <Tooltip content={strings.removeStep}>
              <Button
                variant="ghost-danger"
                size="lg"
                icon="trash"
                label={strings.removeStep}
                onPress={() => {
                  removeBreak(stepId);
                }}
              />
            </Tooltip>
          );
        }
        const question = questions.find((each) => each.id === id);
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
                  onChange((before) => keptAtFirst(duplicateQuestion(before, id, copy), copy));
                  opened(copy);
                }}
              />
            </Tooltip>
            {props.locked !== undefined && isLocked(question) ? (
              <LockReason reason={props.locked.reason} />
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
              // With dividers, a move is among questions and dividers together: a question crossing one changes step.
              if (breaks !== undefined) {
                breaks.onChange((before) => moveItem(before, stepOfRow(id) ?? id, index));
                return;
              }
              onChange((before) => moveQuestion(before, id, index));
            },
          })}
    />
  );
}

/** Props for one open question. */
interface QuestionEditorProps {
  readonly question: FormQuestion;
  readonly questions: Questions;
  readonly attributes: readonly FormAttributeChoice[];
  /** The form adds submissions to the CRM, so Where it goes shows; a form that keeps them only files nothing. */
  readonly isFiling: boolean;
  /** Where it goes shows off, at Not filed: a booking page kept out of the CRM. */
  readonly isFilingOff: boolean;
  /** A question that stays as it is: its type and filing can't change, and it has no Show when. */
  readonly isLocked: boolean;
  /** What an unfiled answer stays with, in the section's words. */
  readonly words: { readonly notFiled: string; readonly cantCreate: string; readonly help: string };
  readonly objectName?: string;
  /** The title of the attribute publishing will create for this question, when it will. */
  readonly willCreate?: string;
  /** The title it would get if it asked for a field, even while kept off the CRM: the Create choice's words. */
  readonly createTitle?: string;
  readonly canCreate: boolean;
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
  questions,
  attributes,
  isFiling,
  isFilingOff,
  isLocked,
  words,
  objectName,
  willCreate,
  createTitle,
  canCreate,
  isReadOnly,
  isJustAdded,
  problem,
  onChange,
  onChoicesInvalid,
}: QuestionEditorProps) {
  // Whether Save may make this question a field of its own: filing on, a member who may add fields, an answer type
  // a field can hold (a file answer files onto a file field only, which Save never makes).
  const couldCreate =
    objectName !== undefined && !isFilingOff && canCreate && !isReadOnly && question.answerType !== 'file';
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
    questions
      .filter((each) => each.id !== question.id && each.filedOn !== undefined)
      .map((each) => [each.filedOn?.attributeId ?? '', each.label === '' ? strings.untitledQuestion : each.label]),
  );

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
          if (type === null) return;
          onChange(typeChange(question, attributes, type as AnswerType));
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
      {!isLocked && (
        <ShowWhenEditor
          showWhen={question.showWhen}
          earlier={questions.slice(
            0,
            questions.findIndex((each) => each.id === question.id),
          )}
          words={QUESTION_SHOW_WHEN}
          isReadOnly={isReadOnly}
          onChange={(showWhen) => {
            onChange({ showWhen });
          }}
        />
      )}
      {isFiling && (
        <Select
          label={strings.whereItGoes}
          info={
            <InfoTip label={strings.whereItGoes} example={strings.whereItGoesExample}>
              {words.help}
            </InfoTip>
          }
          items={[
            // A new field, and Not filed, are two choices: one choice that read as either, by whether a field would be
            // made, left no way to keep an answer off the CRM (every booking question became a People column).
            // Offered from the start, before the question has words: with Not filed the only item there, choosing it
            // chose what was already showing, so the choice was lost when the label was typed (UX review).
            ...(!couldCreate
              ? []
              : [
                  {
                    id: CREATE,
                    // The title Save will really use, when it will make one; else the one it would (kept, or no words yet).
                    label:
                      (willCreate ?? createTitle) === undefined
                        ? strings.willCreateUnnamed(objectName)
                        : strings.willCreate(willCreate ?? createTitle ?? '', objectName),
                  },
                ]),
            ...fitting.map((attribute) => {
              const holder = usedBy.get(attribute.attributeId);
              return {
                id: attribute.attributeId,
                label: attribute.title,
                ...(holder === undefined ? {} : { description: strings.takenBy(holder) }),
                ...(attribute.canWrite ? {} : { description: strings.cantWrite, isArchived: true }),
              };
            }),
            // A filing whose field is gone (archived, or no longer fits the answer type) still shows, muted, as the card
            // names it: the Select was blank while the card said the field no longer exists.
            ...(question.filedOn === undefined ||
            fitting.some((attribute) => attribute.attributeId === question.filedOn?.attributeId)
              ? []
              : [{ id: question.filedOn.attributeId, label: strings.goneAttribute, isArchived: true }]),
            // Apart from the fields, as a form's "Don't add to the CRM" is: not one more place an answer could go.
            {
              id: NOT_FILED,
              label: words.notFiled,
              isApart: fitting.length > 0 || couldCreate,
              ...(!isFilingOff && !canCreate && question.label.trim() !== '' && question.filedOn === undefined
                ? { description: words.cantCreate }
                : {}),
            },
          ]}
          value={
            isFilingOff
              ? NOT_FILED
              : (question.filedOn?.attributeId ?? (question.kept !== true && couldCreate ? CREATE : NOT_FILED))
          }
          isReadOnly={isReadOnly || isLocked}
          isDisabled={isFilingOff}
          {...(isFilingOff ? { hint: strings.offCrm } : {})}
          onChange={(id) => {
            if (id === null || id === NOT_FILED) onChange({ filedOn: null, kept: true });
            else if (id === CREATE) onChange({ filedOn: null, kept: false });
            else onChange({ filedOn: id });
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

/** Props for a Show when: a question's, or a step's (spec 0063). */
interface ShowWhenEditorProps {
  readonly showWhen: FormQuestion['showWhen'];
  /** The questions before it: what its conditions may read. */
  readonly earlier: readonly FormQuestion[];
  readonly words: { readonly hint: string; readonly noEarlier: string; readonly readsLater: string };
  readonly isReadOnly: boolean;
  /** New conditions, or null to always show it. */
  readonly onChange: (showWhen: FormQuestion['showWhen'] | null) => void;
}

/** The Show when words of a question. */
const QUESTION_SHOW_WHEN = {
  hint: routingStrings.showWhenHint,
  noEarlier: routingStrings.noEarlier,
  readsLater: routingStrings.readsLater,
} as const;

/** The Show when words of a step. */
const STEP_SHOW_WHEN = {
  hint: strings.stepShowWhenHint,
  noEarlier: strings.stepNoEarlier,
  readsLater: strings.stepReadsLater,
} as const;

/**
 * Show when (spec 0043, AC-1615; a step's, spec 0063 AC-6312): off, a line saying it always shows and Add a
 * condition; on, its conditions over the questions before it, and Always show it. Nothing before it, nothing to read.
 */
function ShowWhenEditor({ showWhen, earlier: before, words, isReadOnly, onChange }: ShowWhenEditorProps) {
  const earlier = questionFacts(before);
  // Turning Show when on or off swaps what is drawn: focus follows to the first condition, or to Add a condition.
  const addRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  if (showWhen === undefined) {
    return (
      <SettingsRow
        title={routingStrings.showWhen}
        description={earlier.length === 0 ? words.noEarlier : routingStrings.alwaysShown}
      >
        {!isReadOnly && (
          <Button
            ref={addRef}
            variant="dashed"
            icon="plus"
            isDisabled={earlier.length === 0}
            onPress={() => {
              onChange(storedShowWhen(firstConditions(earlier)));
              focusLater(() => firstRef.current);
            }}
          >
            {routingStrings.addShowWhen}
          </Button>
        )}
      </SettingsRow>
    );
  }
  // Moved above what its Show when reads: said here, as publish would refuse it.
  const readsLater = showWhen.rules.some((condition) => !earlier.some((fact) => fact.key === condition.key));
  return (
    <SettingsSection title={routingStrings.showWhen} description={words.hint}>
      {readsLater && <Callout tone="danger">{words.readsLater}</Callout>}
      <ConditionsEditor
        value={showWhen}
        facts={earlier}
        factLabel={routingStrings.question}
        isReadOnly={isReadOnly}
        firstRef={firstRef}
        onChange={(next) => onChange(storedShowWhen(next))}
      />
      {!isReadOnly && (
        <Button
          variant="ghost"
          icon="x"
          onPress={() => {
            onChange(null);
            focusLater(() => addRef.current);
          }}
        >
          {routingStrings.clearShowWhen}
        </Button>
      )}
    </SettingsSection>
  );
}

/** Props for one open step divider. */
interface StepEditorProps {
  readonly step: FormStep;
  readonly earlier: readonly FormQuestion[];
  readonly isReadOnly: boolean;
  /** Just added: its title takes focus, and the divider comes into view. */
  readonly isJustAdded: boolean;
  readonly problem?: string;
  readonly onChange: (change: StepChange) => void;
}

/** One step divider open (spec 0063, AC-6303, AC-6312): its title, then its Show when over the questions before it. */
function StepEditor({ step, earlier, isReadOnly, isJustAdded, problem, onChange }: StepEditorProps) {
  const titleRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!isJustAdded) return;
    const input = titleRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    input.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }, [isJustAdded]);
  return (
    <>
      <Field
        ref={titleRef}
        label={strings.stepTitle}
        placeholder={strings.stepTitlePlaceholder}
        value={step.title ?? ''}
        maxLength={FORM_STEP_TITLE_MAX}
        isReadOnly={isReadOnly}
        onChange={(title) => {
          onChange({ title });
        }}
        {...(problem === undefined ? {} : { error: problem })}
      />
      <ShowWhenEditor
        showWhen={step.showWhen}
        earlier={earlier}
        words={STEP_SHOW_WHEN}
        isReadOnly={isReadOnly}
        onChange={(showWhen) => {
          onChange({ showWhen });
        }}
      />
    </>
  );
}
