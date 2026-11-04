// Brief
// Purpose: a list of questions (spec 0023, 0023-experience.md, Questions), shared by a form's Form tab and a booking page's editor (spec 0057): cards closed until opened, each with its editor.
// Main task: add, word, type, file, require, duplicate, delete (with Undo) and reorder the questions.
// Leaves out: saving (each editor saves as it goes), the look and the words around the questions.
import { CONSENT_PURPOSES, type AnswerType, type FormAttributeChoice, type FormQuestion } from '@crm/data';
import {
  ANSWER_TYPES,
  BOOKING_ANSWER_TYPES,
  CHOICE_TYPES,
  FORM_CHOICES_MAX,
  FORM_STEP_TITLE_MAX,
  NO_PLACEHOLDER_TYPES,
  QUESTION_PRESETS,
  SCORED_TYPES,
  STEP_JUMPS_MAX,
  type FormEnding,
  type FormJump,
  type FormLayout,
  type FormStep,
} from '@crm/data/forms';
import {
  Button,
  Callout,
  Checkbox,
  ConditionRow,
  DatePicker,
  Field,
  FieldGroup,
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
  SettingsStack,
  SubmenuTrigger,
  Tooltip,
  type IconName,
  type OptionsEditorOption,
  type QuestionListItem,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addPreset,
  addQuestion,
  changeQuestion,
  duplicateQuestion,
  filedLine,
  fittingAttributes,
  markSource,
  SOURCE_ANSWER_TYPES,
  typeChange,
  planNewAttributes,
  type DealChoices,
  moveQuestion,
  removeQuestion,
  restoreQuestion,
  type QuestionChange,
  type Questions,
} from './questions.ts';
import { addJump, changeJump, idOfTarget, jumpChoices, nextStepName, removeJump, targetOfId } from './jumps.ts';
import {
  changeStep,
  fromItems,
  isFirstStep,
  itemsOf,
  moveItem,
  questionsBefore,
  removeStep,
  restoreStep,
  splitAt,
  startsAStep,
  stepPlaces,
  stepQuestionsOf,
  type Flow,
  type StepChange,
} from './steps.ts';
import { strings } from './strings.ts';
import { ConditionsEditor } from '../routing/ConditionsEditor.tsx';
import { conditionsLine, questionFacts, readyConditions, storedShowWhen } from '../routing/facts.ts';
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
  date: 'calendar',
  time: 'clock',
  datetime: 'calendar-clock',
  rating: 'star',
  scale: 'sliders-horizontal',
  multi_select: 'list-checks',
  address: 'map-pin',
  hidden: 'eye-off',
  signature: 'pen',
  ranking: 'arrow-down-wide-narrow',
  consent: 'shield-check',
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
   * The deal a form makes beside each person (Also create a deal, forms fixes 2): its fields join Where it goes under
   * their own heading, so an answer can go on the deal itself (its Value, its Source). Absent: no deal is made.
   */
  readonly deal?: DealChoices;
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
  /**
   * How each question performs, by question id (spec 0063, AC-6322): a short chip on the card's second line, so a
   * weak question is visible where it is edited. Absent on a form with no analytics, and a question nobody has
   * reached has no entry.
   */
  readonly stats?: ReadonlyMap<string, { readonly stat: string; readonly statTitle: string }>;
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
  /** A question or divider was opened (its row id; a divider's is `step:<id>`): the preview shows its step. */
  readonly onOpened?: (rowId: string) => void;
  /** Before Add a question in the list's header: a form's Flow. */
  readonly actionsStart?: ReactNode;
}

/** A form's step dividers, as the questions section draws and changes them. */
export interface StepsProps {
  readonly steps: readonly FormStep[];
  readonly layout: FormLayout;
  /** The form's endings (spec 0063, AC-6315): where a step's jumps may end instead of going on. */
  readonly endings?: readonly FormEnding[];
  /** A change to the questions and dividers together, as a function of what it applies to. */
  readonly onChange: (update: (before: Flow) => Flow) => void;
  /** The divider a publish refused, and why: kept open, with the error under its title. */
  readonly problem?: { readonly stepId: string; readonly message: string };
  /**
   * Adds an ending and answers its id: Add logic on a step with nowhere further down to jump makes one, so one click
   * still gives a working rule. Left out, Add logic shows only where there is a step or an ending to jump to.
   */
  readonly onAddEnding?: () => string | undefined;
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

/** A booking page's answer types (spec 0063, AC-6311): the ones it had, until a later spec opens the new ones to it. */
const BOOKING_TYPE_ITEMS = TYPE_ITEMS.filter((item) => BOOKING_ANSWER_TYPES.includes(item.id));

/** The questions: a header with the count and Add a question, then the cards. */
export function QuestionsSection(props: QuestionsSectionProps) {
  const { questions, onChange, attributes, objectName, liveIds, newId, toasts, problem, isReadOnly } = props;
  const { stats } = props;
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
    props.onOpened?.(id);
  };

  // A link to one question opens it and brings it into view, once per question it names: only a new link opens
  // one, so edits to the draft never reopen it.
  const { focusQuestionId } = props;
  const [focused, setFocused] = useState<string | undefined>(undefined);
  if (focusQuestionId !== focused) {
    setFocused(focusQuestionId);
    const linkedStep = focusQuestionId === undefined ? undefined : stepOfRow(focusQuestionId);
    if (
      focusQuestionId !== undefined &&
      (questions.some((question) => question.id === focusQuestionId) ||
        (linkedStep !== undefined && props.steps?.steps.some((step) => step.id === linkedStep) === true))
    ) {
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
        : filedLine(question, objectName, attributes, props.deal);
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
    // Where an answer is saved shows in its editor, not on the row: the row stays the question and its type (T17).
    // Only a complete condition is said: one still being written shows nothing rather than "Shows when … is".
    ...shownWhenOf(question.showWhen, questionFacts(questions.slice(0, questions.indexOf(question)))),
    ...(stats?.get(question.id) ?? {}),
    hasProblem: problem?.questionId === question.id || refused.has(question.id),
  }));
  // Steps as pages (spec 0063; T20, 5 November 2026: Tally's page breaks): with the Steps layout each break is an
  // inline header among the questions ("Step 2 · About you"); Classic and One at a time draw no headers at all, the
  // breaks kept in the document for the day Steps is chosen again.
  const flow: Flow | undefined = breaks === undefined ? undefined : { questions, steps: breaks.steps };
  const isStepped = breaks?.layout === 'steps' && flow !== undefined;
  const places = flow === undefined ? new Map<string, { number: number; count: number }>() : stepPlaces(flow);
  // A stepped form whose first questions have no header of their own (one made before Steps split forms at once):
  // they still read as Step 1, under a header that makes its break the moment it is renamed or given logic.
  const firstQuestion = questions[0];
  const hasLeadHeader = flow === undefined || firstQuestion === undefined || itemsOf(flow)[0]?.kind === 'step';
  const leadRow: readonly QuestionListItem[] =
    isStepped && !hasLeadHeader ? [{ id: `${STEP_ROW}${LEAD}`, kind: 'step', label: strings.stepName(1) }] : [];
  const items: readonly QuestionListItem[] = !isStepped
    ? questionItems
    : [
        ...leadRow,
        ...itemsOf(flow).flatMap((item): QuestionListItem[] => {
          if (item.kind === 'question') return questionItems.filter((each) => each.id === item.id);
          const step = breaks.steps.find((each) => each.id === item.id);
          if (step === undefined) return [];
          const place = places.get(step.id) ?? { number: 1, count: 0 };
          return [
            {
              id: `${STEP_ROW}${step.id}`,
              kind: 'step',
              label: strings.stepName(place.number, step.title),
              // Named by every question, so one that comes after the step reads by its label, not as removed.
              ...shownWhenOf(step.showWhen, questionFacts(questions)),
              hasProblem: stepProblem?.stepId === step.id,
            },
          ];
        }),
      ];

  // A step with logic shows it under its header, always: its rules are what the header is about.
  const shownOpen = useMemo(
    () =>
      new Set([
        ...openIds,
        ...(breaks?.steps ?? [])
          .filter((step) => (step.jumps?.length ?? 0) > 0 || step.showWhen !== undefined)
          .map((step) => `${STEP_ROW}${step.id}`),
      ]),
    [openIds, breaks?.steps],
  );

  // The step being renamed in place, and what has been typed. Its field takes focus as it appears.
  const [renaming, setRenaming] = useState<{ readonly stepId: string; readonly text: string } | undefined>(undefined);
  const renameRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const renamingId = renaming?.stepId;
  useEffect(() => {
    if (renamingId !== undefined) focusLater(() => renameRef.current);
  }, [renamingId]);

  /** The break a header stands for, made first for the lead header that has none yet; answers its id. */
  const ensureStep = (stepId: string): string | undefined => {
    if (breaks === undefined || firstQuestion === undefined) return undefined;
    if (stepId !== LEAD) return stepId;
    const id = newId();
    breaks.onChange((before) => {
      const first = before.questions[0];
      if (first === undefined || itemsOf(before)[0]?.kind === 'step') return before;
      const steps = [{ id, startsAt: first.id }, ...before.steps];
      return fromItems({ ...before, steps }, itemsOf({ ...before, steps }));
    });
    return id;
  };

  /** Split here: a new step starts at this question, its title field open to name it. */
  const split = (questionId: string) => {
    if (breaks === undefined) return;
    const id = newId();
    breaks.onChange((before) => splitAt(before, questionId, id));
    setRenaming({ stepId: id, text: '' });
    props.onOpened?.(`${STEP_ROW}${id}`);
  };

  /** Merge with the step above: the break goes, its questions join the step before it, with Undo. */
  const merge = (stepId: string) => {
    if (breaks === undefined || flow === undefined) return;
    const step = breaks.steps.find((each) => each.id === stepId);
    if (step === undefined) return;
    const name = strings.stepName(places.get(stepId)?.number ?? 1, step.title);
    const index = breaks.steps.indexOf(step);
    breaks.onChange((before) => removeStep(before, stepId).flow);
    toasts.toast({
      tone: 'info',
      message: strings.stepMerged(name),
      action: {
        label: strings.undo,
        onAction: () => {
          breaks.onChange((before) => restoreStep(before, step, index));
        },
      },
    });
  };

  const commitRename = () => {
    if (renaming === undefined || breaks === undefined) return;
    const { stepId, text } = renaming;
    setRenaming(undefined);
    breaks.onChange((before) => changeStep(before, stepId, { title: text.trim() }));
    focusOn(`step:${stepId}:menu`);
  };

  // Where focus goes after a one click rule appears or goes: its first picker, or back to the button that made it.
  const focusTargets = useRef(new Map<string, HTMLButtonElement | null>());
  const refFor = (key: string) => (node: HTMLButtonElement | null) => {
    focusTargets.current.set(key, node);
  };
  const focusOn = (key: string) => {
    focusLater(() => focusTargets.current.get(key) ?? null);
  };

  /** Show only if…: a ready condition on the questions before it, focus on its first picker. */
  const showIfButton = (key: string, earlier: readonly FormQuestion[], onAdd: (showWhen: ShowWhenValue) => void) => {
    const facts = questionFacts(earlier);
    if (isReadOnly || facts.length === 0) return null;
    return (
      <Button
        ref={refFor(`${key}:show-button`)}
        variant="ghost"
        icon="eye"
        onPress={() => {
          onAdd(storedShowWhen(readyConditions(facts)));
          focusOn(`${key}:show`);
        }}
      >
        {strings.showOnlyIf}
      </Button>
    );
  };

  /**
   * Add logic on a step (one click, the owner's "everything complex at a single click"): a ready rule reading the
   * step's own question with options first, jumping to the next step, or to an ending made for it when there is
   * nowhere below. Undefined when it could do nothing, so the menu leaves it out.
   */
  const addLogicTo = (stepId: string): (() => void) | undefined => {
    if (breaks === undefined || flow === undefined || isReadOnly) return undefined;
    const step = breaks.steps.find((each) => each.id === stepId);
    const isLead = stepId === LEAD;
    if (step === undefined && !isLead) return undefined;
    // The lead header's questions are those before the first break: what its break, once made, will hold.
    const firstBreak = itemsOf(flow).findIndex((item) => item.kind === 'step');
    const leadQuestions = questions.slice(0, firstBreak < 0 ? questions.length : firstBreak);
    const own = isLead ? leadQuestions : stepQuestionsOf(flow, stepId);
    const readable = isLead ? leadQuestions : readableBy(flow, stepId);
    const facts = questionFacts(readable);
    const jumps = step?.jumps ?? [];
    // The lead header has no break yet, so every break is below it: no step's id matches, and all are offered.
    // A ready rule never jumps to where everyone goes anyway (the next step): that would be a rule that does
    // nothing (UX review). It takes the step after, or an ending, or makes an ending to go to.
    const offered = jumpChoices(flow, breaks.endings ?? [], isLead ? '' : stepId);
    const choices = offered.slice(offered[0]?.id.startsWith('step:') === true ? 1 : 0);
    if (facts.length === 0 || jumps.length >= STEP_JUMPS_MAX) return undefined;
    if (choices.length === 0 && breaks.onAddEnding === undefined) return undefined;
    return () => {
      const id = ensureStep(stepId);
      if (id === undefined) return;
      const first = choices[0];
      const ending = first === undefined ? breaks.onAddEnding?.() : undefined;
      const target = first === undefined ? (ending === undefined ? undefined : { ending }) : targetOfId(first.id);
      if (target === undefined) return;
      const when = storedShowWhen(readyConditions(facts, new Set(own.map((each) => each.key))));
      breaks.onChange((before) => {
        const now = before.steps.find((each) => each.id === id);
        return changeStep(before, id, { jumps: addJump(now?.jumps ?? [], target, when) });
      });
      props.onOpened?.(`${STEP_ROW}${id}`);
      focusOn(`step:${id}:jump:${String(jumps.length)}`);
    };
  };

  /** A step header's ⋯: Rename, Add logic, Show only if…, and Merge with the step above. */
  const stepMenu = (rowId: string) => {
    const stepId = stepOfRow(rowId);
    if (stepId === undefined || isReadOnly || flow === undefined || breaks === undefined) return null;
    const step = breaks.steps.find((each) => each.id === stepId);
    const isLead = stepId === LEAD;
    const name = isLead ? strings.stepName(1) : strings.stepName(places.get(stepId)?.number ?? 1, step?.title);
    const addLogic = addLogicTo(stepId);
    const earlier = isLead ? [] : questionsBefore(flow, stepId);
    const canShowIf = !isLead && step?.showWhen === undefined && questionFacts(earlier).length > 0;
    const canMerge = !isLead && !isFirstStep(flow, stepId) && hasLeadHeader;
    const canMergeAfterLead = !isLead && !hasLeadHeader;
    return (
      <MenuTrigger>
        <Button ref={refFor(`step:${stepId}:menu`)} variant="ghost" icon="ellipsis" label={strings.stepMenu(name)} />
        <Menu
          label={strings.stepMenu(name)}
          onAction={(key) => {
            if (key === 'rename') {
              const id = ensureStep(stepId);
              if (id !== undefined) setRenaming({ stepId: id, text: step?.title ?? '' });
            }
            if (key === 'logic') addLogic?.();
            if (key === 'show' && step !== undefined) {
              breaks.onChange((before) =>
                changeStep(before, stepId, { showWhen: storedShowWhen(readyConditions(questionFacts(earlier))) }),
              );
              focusOn(`step:${stepId}:show`);
            }
            if (key === 'merge') merge(stepId);
          }}
        >
          <MenuItem id="rename" icon="pencil">
            {strings.renameStep}
          </MenuItem>
          {addLogic !== undefined && (
            <MenuItem id="logic" icon="git-branch">
              {strings.addLogic}
            </MenuItem>
          )}
          {canShowIf && (
            <MenuItem id="show" icon="eye">
              {strings.showOnlyIf}
            </MenuItem>
          )}
          {(canMerge || canMergeAfterLead) && (
            <>
              <MenuSeparator />
              <MenuItem id="merge" icon="arrow-up">
                {strings.mergeUp}
              </MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
    );
  };

  return (
    <QuestionList
      label={strings.questions}
      actions={
        <>
          {props.actionsStart}
          {!isReadOnly && (
            <>
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
                  }}
                >
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
      openIds={shownOpen}
      onOpenChange={(id, isOpen) => {
        // The question or divider a publish refused stays open until it is fixed.
        if (!isOpen && (problem?.questionId === id || `${STEP_ROW}${stepProblem?.stepId ?? ''}` === id)) return;
        if (isOpen) props.onOpened?.(id);
        setOpen((before) => {
          const next = new Set(before);
          if (isOpen) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      {...(isStepped
        ? {
            onStepPress: (id: string) => {
              props.onOpened?.(id);
            },
            renderStepEnd: stepMenu,
            renderStepTitle: (id: string) => {
              const stepId = stepOfRow(id);
              if (renaming === undefined || stepId !== renaming.stepId) return undefined;
              return (
                <Field
                  ref={renameRef}
                  label={strings.stepTitle}
                  isLabelHidden
                  size="sm"
                  placeholder={strings.stepName(places.get(stepId)?.number ?? 1)}
                  value={renaming.text}
                  maxLength={FORM_STEP_TITLE_MAX}
                  onChange={(text) => {
                    setRenaming({ stepId, text });
                  }}
                  onSubmit={commitRename}
                  onBlur={commitRename}
                  onEscape={() => {
                    setRenaming(undefined);
                    focusOn(`step:${stepId}:menu`);
                  }}
                />
              );
            },
            ...(isReadOnly
              ? {}
              : {
                  renderGap: (id: string) => {
                    if (stepOfRow(id) !== undefined || startsAStep(flow, id)) return null;
                    return (
                      <Button
                        size="sm"
                        icon="scissors"
                        onPress={() => {
                          split(id);
                        }}
                      >
                        {strings.splitHere}
                      </Button>
                    );
                  },
                }),
          }
        : {})}
      renderOpen={(id) => {
        const stepId = stepOfRow(id);
        if (stepId !== undefined) {
          const step = breaks?.steps.find((each) => each.id === stepId);
          if (step === undefined || breaks === undefined || flow === undefined) return null;
          if ((step.jumps?.length ?? 0) === 0 && step.showWhen === undefined && stepProblem?.stepId !== stepId) {
            return null;
          }
          return (
            <StepEditor
              step={step}
              earlier={questionsBefore(flow, stepId)}
              // A jump decides once its own step has been answered, so it reads that step's questions too.
              readable={readableBy(flow, stepId)}
              jumpTargets={jumpChoices(flow, breaks.endings ?? [], stepId)}
              {...(nextStepName(flow, stepId) === undefined ? {} : { nextName: nextStepName(flow, stepId) })}
              refFor={refFor}
              focusOn={focusOn}
              isReadOnly={isReadOnly}
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
            typeItems={props.keptWith === 'booking' ? BOOKING_TYPE_ITEMS : TYPE_ITEMS}
            questions={questions}
            attributes={attributes}
            {...(props.deal === undefined ? {} : { deal: props.deal })}
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
            refFor={refFor}
            focusOn={focusOn}
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
        if (stepOfRow(id) !== undefined) return null;
        const question = questions.find((each) => each.id === id);
        if (question === undefined) return null;
        // Show only if…: one click to a ready condition, while it has none and something before it to read.
        const showIf =
          isLocked(question) || question.showWhen !== undefined
            ? null
            : showIfButton(
                id,
                questions.slice(
                  0,
                  questions.findIndex((each) => each.id === question.id),
                ),
                (showWhen) => {
                  onChange((before) => changeQuestion(before, id, { showWhen }, liveIds));
                },
              );
        // Give points (Typeform's score, T20): one click on a question that can score, on a form only.
        const givePoints =
          props.keptWith === 'submission' &&
          !isReadOnly &&
          question.points === undefined &&
          SCORED_TYPES.includes(question.answerType) ? (
            <Button
              variant="ghost"
              icon="target"
              onPress={() => {
                onChange((before) => changeQuestion(before, id, { points: startingPoints(question) }, liveIds));
              }}
            >
              {strings.givePoints}
            </Button>
          ) : null;
        // A hidden question has nothing a visitor could answer (spec 0063): it is never one they must.
        if (question.answerType === 'hidden') return showIf;
        // How they heard about you (spec 0067, AC-6703): a form's one choice or short text question whose answers
        // Insights shows beside its sources. Marking one unmarks any other.
        const canBeSource = props.keptWith === 'submission' && SOURCE_ANSWER_TYPES.has(question.answerType);
        return (
          <>
            <Checkbox
              label={strings.mustAnswer}
              isSelected={question.required}
              isReadOnly={isReadOnly}
              onChange={(required) => {
                onChange((before) => changeQuestion(before, id, { required }, liveIds));
              }}
            />
            {canBeSource && (
              <Checkbox
                label={strings.sourceQuestion}
                isSelected={question.source === true}
                isReadOnly={isReadOnly}
                onChange={(isSource) => {
                  onChange((before) => markSource(before, id, isSource));
                }}
              />
            )}
            {showIf}
            {givePoints}
          </>
        );
      }}
      renderFooter={(id) => {
        if (stepOfRow(id) !== undefined) return null;
        const question = questions.find((each) => each.id === id);
        if (question === undefined || isReadOnly) return null;
        // Split here's twin for touch and the keyboard: the gap above a card shows only on hover.
        const canSplit = isStepped && !startsAStep(flow, id);
        return (
          <>
            {canSplit && (
              <Tooltip content={strings.startStepHere}>
                <Button
                  variant="ghost"
                  size="lg"
                  icon="scissors"
                  label={strings.startStepHere}
                  onPress={() => {
                    split(id);
                  }}
                />
              </Tooltip>
            )}
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
              const stepId = stepOfRow(id);
              if (stepId === LEAD) return;
              if (breaks !== undefined && isStepped) {
                // The lead header (no break yet) holds a row of its own: moves count without it.
                const at = leadRow.length > 0 ? Math.max(0, index - 1) : index;
                breaks.onChange((before) => moveItem(before, stepId ?? id, at));
                return;
              }
              if (breaks !== undefined) {
                // Headers aren't drawn: a question moves among questions, and the breaks keep the order the
                // document needs (each at its question, in the questions' order).
                breaks.onChange((before) => {
                  const moved = { ...before, questions: moveQuestion(before.questions, id, index) };
                  return fromItems(moved, itemsOf(moved));
                });
                return;
              }
              onChange((before) => moveQuestion(before, id, index));
            },
          })}
    />
  );
}

/** A lead header's stand in id: the questions before the first break, which have no break of their own yet. */
const LEAD = '~lead';

/** A question's first points, one click from Give points: the answer itself, yes over no, or 1, 2, 3 by choice. */
function startingPoints(question: FormQuestion): NonNullable<FormQuestion['points']> {
  if (question.answerType === 'rating' || question.answerType === 'scale') return 'value';
  if (question.answerType === 'yes_no') return [1, 0];
  return (question.choices ?? []).map((_, place) => place + 1);
}

/** Props for one open question. */
interface QuestionEditorProps {
  readonly question: FormQuestion;
  /** The answer types it may take: a booking page's are fewer (spec 0063, AC-6311). */
  readonly typeItems: typeof TYPE_ITEMS;
  readonly questions: Questions;
  readonly attributes: readonly FormAttributeChoice[];
  /** The deal's fields, under their own heading in Where it goes. */
  readonly deal?: DealChoices;
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
  /** Keeps a control to move focus to, by key; and moves focus to one. */
  readonly refFor: (key: string) => (node: HTMLButtonElement | null) => void;
  readonly focusOn: (key: string) => void;
  readonly onChange: (change: QuestionChange) => void;
  /** The choices list holds a refused edit, or no longer does. */
  readonly onChoicesInvalid: (isInvalid: boolean) => void;
}

/**
 * One question open (T6, 4 November 2026: "need proper heirarchy to type here"): the question's words first, in the
 * large field, then its answer settings (type, choices, placeholder), then, quieter, its Show only if and where its
 * answer is saved. Required and Show only if… sit in the card's footer, as Tally and Typeform keep them apart from
 * the words.
 */
function QuestionEditor({
  question,
  typeItems,
  questions,
  attributes,
  deal,
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
  refFor,
  focusOn,
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
  const isConsent = question.answerType === 'consent';
  const choices = question.choices ?? [];
  const fitting = fittingAttributes(attributes, question.answerType);
  const dealFitting = deal === undefined ? [] : fittingAttributes(deal.items, question.answerType);
  // With a deal, the person's fields sit under the object's name and the deal's under Deal, so each reads as where
  // it goes; without one the list stays as it was, one group.
  const mainGroup = dealFitting.length === 0 || objectName === undefined ? {} : { group: objectName };
  const usedBy = new Map(
    questions
      .filter((each) => each.id !== question.id && each.filedOn !== undefined)
      .map((each) => [each.filedOn?.attributeId ?? '', each.label === '' ? strings.untitledQuestion : each.label]),
  );

  return (
    <>
      <Field
        ref={labelRef}
        // A consent's label is its exact wording, shown beside the tick box (spec 0023, AC-1053).
        label={isConsent ? strings.consentWording : strings.question}
        // The one thing the card is about: larger than the settings under it, so it reads, and is typed, first.
        size="lg"
        placeholder={isConsent ? strings.consentPlaceholder : strings.questionPlaceholder}
        {...(isConsent ? { hint: strings.consentWordingHint } : {})}
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
        items={typeItems}
        value={question.answerType}
        isReadOnly={isReadOnly || isLocked}
        onChange={(type) => {
          if (type === null) return;
          onChange(typeChange(question, [...attributes, ...(deal?.items ?? [])], type as AnswerType));
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
      <TypeOptions question={question} isReadOnly={isReadOnly} onChange={onChange} />
      <PointsEditor question={question} isReadOnly={isReadOnly} onChange={onChange} />
      {!NO_PLACEHOLDER_TYPES.includes(question.answerType) && (
        <Field
          label={strings.placeholder}
          value={question.placeholder ?? ''}
          maxLength={80}
          isReadOnly={isReadOnly}
          onChange={(placeholder) => {
            onChange({ placeholder });
          }}
        />
      )}
      {!isLocked && question.showWhen !== undefined && (
        <ShowWhenRules
          showWhen={question.showWhen}
          earlier={questions.slice(
            0,
            questions.findIndex((each) => each.id === question.id),
          )}
          readsLaterText={routingStrings.readsLater}
          isReadOnly={isReadOnly}
          firstRef={refFor(`${question.id}:show`)}
          onChange={(showWhen) => {
            onChange({ showWhen });
          }}
          onClear={() => {
            onChange({ showWhen: null });
            focusOn(`${question.id}:show-button`);
          }}
        />
      )}
      {/* A consent is never filed onto a field: it becomes a consent record on the person. */}
      {isFiling && !isConsent && (
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
                    ...mainGroup,
                    id: CREATE,
                    // The title Save will really use, when it will make one; else the one it would (kept, or no words yet).
                    label:
                      (willCreate ?? createTitle) === undefined
                        ? strings.willCreateUnnamed(objectName)
                        : strings.willCreate(willCreate ?? createTitle ?? '', objectName),
                  },
                ]),
            ...[
              ...fitting.map((attribute) => ({ attribute, group: mainGroup })),
              ...dealFitting.map((attribute) => ({ attribute, group: { group: strings.dealGroup } })),
            ].map(({ attribute, group }) => {
              const holder = usedBy.get(attribute.attributeId);
              return {
                ...group,
                id: attribute.attributeId,
                label: attribute.title,
                ...(holder === undefined ? {} : { description: strings.takenBy(holder) }),
                ...(attribute.canWrite ? {} : { description: strings.cantWrite, isArchived: true }),
              };
            }),
            // A filing whose field is gone (archived, or no longer fits the answer type) still shows, muted, as the card
            // names it: the Select was blank while the card said the field no longer exists.
            ...(question.filedOn === undefined ||
            [...fitting, ...dealFitting].some((attribute) => attribute.attributeId === question.filedOn?.attributeId)
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
            else {
              const onDeal = dealFitting.some((attribute) => attribute.attributeId === id);
              onChange({ filedOn: id, filedRole: onDeal ? 'deal' : 'main' });
            }
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

/** Props for a question's type options. */
interface TypeOptionsProps {
  readonly question: FormQuestion;
  readonly isReadOnly: boolean;
  readonly onChange: (change: QuestionChange) => void;
}

/** A whole number typed in a field, or undefined when blank or not one. */
function wholeOf(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() === '' || !Number.isInteger(value) || value < 1 ? undefined : value;
}

/**
 * What a question's type sets beyond its words and choices (spec 0063, AC-6307): a date's earliest and latest day,
 * a scale's ends and their words, a multi select's least and most picks and its Other, a hidden question's value
 * when the link brings none. Nothing for the other types.
 */
function TypeOptions({ question, isReadOnly, onChange }: TypeOptionsProps) {
  const options = question.options ?? {};
  switch (question.answerType) {
    case 'date':
      return (
        <SettingsRow title={strings.dateRange}>
          {/* The app's one date editor, DatePicker; the visitor's page uses the phone's own picker. */}
          <DatePicker
            label={strings.earliest}
            size="sm"
            value={options.earliest ?? null}
            isReadOnly={isReadOnly}
            onChange={(earliest) => {
              onChange({ options: { earliest: earliest ?? undefined } });
            }}
          />
          <DatePicker
            label={strings.latest}
            size="sm"
            value={options.latest ?? null}
            isReadOnly={isReadOnly}
            onChange={(latest) => {
              onChange({ options: { latest: latest ?? undefined } });
            }}
          />
        </SettingsRow>
      );
    case 'scale':
      return (
        <>
          <SettingsRow title={strings.scaleRange}>
            <Select
              label={strings.scaleFrom}
              isLabelHidden
              size="sm"
              items={[
                { id: '0', label: '0' },
                { id: '1', label: '1' },
              ]}
              value={String(options.from ?? 0)}
              isReadOnly={isReadOnly}
              onChange={(from) => {
                if (from === '0' || from === '1') onChange({ options: { from: from === '0' ? 0 : 1 } });
              }}
            />
            <Select
              label={strings.scaleTo}
              isLabelHidden
              size="sm"
              items={[
                { id: '5', label: '5' },
                { id: '7', label: '7' },
                { id: '10', label: '10' },
              ]}
              value={String(options.to ?? 10)}
              isReadOnly={isReadOnly}
              onChange={(to) => {
                if (to === '5' || to === '7' || to === '10')
                  onChange({ options: { to: to === '5' ? 5 : to === '7' ? 7 : 10 } });
              }}
            />
          </SettingsRow>
          <Field
            label={strings.lowLabel}
            placeholder={strings.lowLabelPlaceholder}
            value={options.lowLabel ?? ''}
            maxLength={40}
            isReadOnly={isReadOnly}
            onChange={(lowLabel) => {
              onChange({ options: { lowLabel } });
            }}
          />
          <Field
            label={strings.highLabel}
            placeholder={strings.highLabelPlaceholder}
            value={options.highLabel ?? ''}
            maxLength={40}
            isReadOnly={isReadOnly}
            onChange={(highLabel) => {
              onChange({ options: { highLabel } });
            }}
          />
        </>
      );
    case 'multi_select':
      return (
        <>
          <SettingsRow title={strings.picks}>
            <Field
              label={strings.leastPicks}
              size="sm"
              inputMode="numeric"
              placeholder={strings.anyPicks}
              value={options.min === undefined ? '' : String(options.min)}
              isReadOnly={isReadOnly}
              onChange={(text) => {
                onChange({ options: { min: wholeOf(text) } });
              }}
            />
            <Field
              label={strings.mostPicks}
              size="sm"
              inputMode="numeric"
              placeholder={strings.anyPicks}
              value={options.max === undefined ? '' : String(options.max)}
              isReadOnly={isReadOnly}
              onChange={(text) => {
                onChange({ options: { max: wholeOf(text) } });
              }}
            />
          </SettingsRow>
          <Checkbox
            label={strings.offerOther}
            isSelected={options.other === true}
            isReadOnly={isReadOnly}
            onChange={(other) => {
              onChange({ options: { other: other ? true : undefined } });
            }}
          />
        </>
      );
    case 'consent':
      return (
        <Select
          label={strings.consentPurpose}
          items={CONSENT_PURPOSES.map((id) => ({ id, label: strings.consentPurposes[id] }))}
          value={options.purpose ?? 'marketing_email'}
          isReadOnly={isReadOnly}
          onChange={(purpose) => {
            const picked = CONSENT_PURPOSES.find((each) => each === purpose);
            if (picked !== undefined) onChange({ options: { purpose: picked } });
          }}
        />
      );
    case 'hidden':
      return (
        <Field
          label={strings.hiddenDefault}
          hint={strings.hiddenDefaultHint(question.key)}
          value={options.default ?? ''}
          maxLength={200}
          isReadOnly={isReadOnly}
          onChange={(text) => {
            onChange({ options: { default: text } });
          }}
        />
      );
    default:
      return null;
  }
}

/** A Show when as the document stores it. */
type ShowWhenValue = NonNullable<FormQuestion['showWhen']>;

/** Props for a Show only if: a question's, or a step's (spec 0063). */
interface ShowWhenRulesProps {
  readonly showWhen: ShowWhenValue;
  /** The questions before it: what its conditions may read. */
  readonly earlier: readonly FormQuestion[];
  /** What to say when a condition reads a question that is no longer before it. */
  readonly readsLaterText: string;
  readonly isReadOnly: boolean;
  readonly firstRef: (node: HTMLButtonElement | null) => void;
  readonly onChange: (showWhen: ShowWhenValue) => void;
  /** Always show it again. */
  readonly onClear: () => void;
}

/**
 * Show only if (spec 0043, AC-1615; a step's, spec 0063 AC-6312): its conditions over the questions before it under a
 * quiet label, with Always show at the label's end. Off, it is not drawn at all: Show only if… in the card's footer
 * adds it, ready filled.
 */
function ShowWhenRules({
  showWhen,
  earlier: before,
  readsLaterText,
  isReadOnly,
  firstRef,
  onChange,
  onClear,
}: ShowWhenRulesProps) {
  const earlier = questionFacts(before);
  // Moved above what its Show when reads: said here, as publish would refuse it.
  const readsLater = showWhen.rules.some((condition) => !earlier.some((fact) => fact.key === condition.key));
  return (
    <FieldGroup
      label={strings.showOnlyIfTitle}
      {...(isReadOnly
        ? {}
        : {
            action: (
              <Button variant="ghost" size="sm" icon="x" onPress={onClear}>
                {strings.alwaysShow}
              </Button>
            ),
          })}
    >
      {readsLater && <Callout tone="danger">{readsLaterText}</Callout>}
      <ConditionsEditor
        value={showWhen}
        facts={earlier}
        factLabel={routingStrings.question}
        isReadOnly={isReadOnly}
        firstRef={firstRef}
        onChange={(next) => {
          onChange(storedShowWhen(next));
        }}
      />
    </FieldGroup>
  );
}

/** Props for a question's points. */
interface PointsEditorProps {
  readonly question: FormQuestion;
  readonly isReadOnly: boolean;
  readonly onChange: (change: QuestionChange) => void;
}

/** One points field: a whole number between -1,000 and 1,000, where blank is no points at that place. */
function PointsField({
  label,
  value,
  isReadOnly,
  onChange,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly isReadOnly: boolean;
  readonly onChange: (points: number | undefined) => void;
}) {
  // The typed text is held while it is on its way to a number, so "-5" survives its first keystroke and a field
  // emptied stays empty instead of snapping back to 0. An outside change (Undo, a type change) takes over again.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const settled = value === undefined ? '' : String(value);
  const text = typed === undefined || Number(typed) === value ? settled : typed;
  return (
    <Field
      label={label}
      size="sm"
      inputMode="numeric"
      value={text}
      isReadOnly={isReadOnly}
      onChange={(next) => {
        setTyped(next);
        const number = Number(next.trim());
        if (next.trim() === '' || !Number.isInteger(number)) {
          if (next.trim() === '') onChange(undefined);
          return;
        }
        onChange(number);
      }}
    />
  );
}

/**
 * What a question's answers are worth (spec 0063, AC-6316, AC-6325): a number beside each choice, two for a yes or
 * no, and for a rating or a scale the answer itself. Only the types that can carry points show the row; every other
 * one scores nothing, as the document refuses points on it.
 */
function PointsEditor({ question, isReadOnly, onChange }: PointsEditorProps) {
  // Only once the question gives points (Give points in its footer, T20): a question that scores nothing says nothing.
  if (!SCORED_TYPES.includes(question.answerType) || question.points === undefined) return null;
  const { points } = question;
  const stop = isReadOnly ? null : (
    <Tooltip content={strings.stopPoints}>
      <Button
        variant="ghost"
        icon="x"
        label={strings.stopPoints}
        onPress={() => {
          onChange({ points: null });
        }}
      />
    </Tooltip>
  );
  const numbers = points === 'value' ? [] : points;
  const at = (place: number) => numbers[place];
  const set = (place: number, value: number | undefined) => {
    const next = [...numbers];
    while (next.length <= place) next.push(0);
    next[place] = value ?? 0;
    // Nothing but zeros is no points at all: the question goes back to scoring nothing.
    onChange({ points: next.every((each) => each === 0) ? null : next });
  };
  if (question.answerType === 'rating' || question.answerType === 'scale') {
    return (
      <SettingsRow title={strings.points}>
        <Select
          label={strings.pointsScale}
          isLabelHidden
          size="sm"
          items={[
            { id: 'off', label: strings.pointsOff },
            { id: 'value', label: strings.pointsValue },
          ]}
          value={points === 'value' ? 'value' : 'off'}
          isReadOnly={isReadOnly}
          onChange={(kind) => {
            onChange({ points: kind === 'value' ? 'value' : null });
          }}
        />
      </SettingsRow>
    );
  }
  if (question.answerType === 'yes_no') {
    return (
      <SettingsRow title={strings.points}>
        <PointsField
          label={strings.pointsYes}
          value={at(0)}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            set(0, value);
          }}
        />
        <PointsField
          label={strings.pointsNo}
          value={at(1)}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            set(1, value);
          }}
        />
        {stop}
      </SettingsRow>
    );
  }
  // Each choice at its own place in the list, blanks skipped but never closed up: the score reads `points` against
  // `choices` itself (`pointsOf`), so filtering first would hang every number below a blank choice on the wrong one.
  const choices = question.choices ?? [];
  if (choices.every((choice) => choice.trim() === '')) {
    return <SettingsRow title={strings.points} description={strings.pointsNoChoices} />;
  }
  // One row of small numbers, as the yes or no branch does, rather than a full width field per choice: the choices
  // are listed right above, so each number only has to say which one it is for.
  return (
    <SettingsRow title={strings.points}>
      {choices.flatMap((choice, place) =>
        choice.trim() === ''
          ? []
          : [
              <PointsField
                key={String(place)}
                label={strings.pointsFor(choice)}
                value={at(place)}
                isReadOnly={isReadOnly}
                onChange={(value) => {
                  set(place, value);
                }}
              />,
            ],
      )}
      {stop}
    </SettingsRow>
  );
}

/** What a step's jumps may read: the questions before it and its own (AC-6313), in the form's order. */
function readableBy(flow: Flow, stepId: string): readonly FormQuestion[] {
  const ids = new Set([...questionsBefore(flow, stepId), ...stepQuestionsOf(flow, stepId)].map((each) => each.id));
  return flow.questions.filter((each) => ids.has(each.id));
}

/** Props for a step's jumps. */
interface JumpRulesProps {
  readonly stepId: string;
  readonly jumps: readonly FormJump[];
  /** What a jump's conditions may read: the questions up to and including this step's own. */
  readonly readable: readonly FormQuestion[];
  /** Where a jump may go: the steps below this one, then the endings. */
  readonly choices: readonly { readonly id: string; readonly label: string }[];
  /** Where the step goes when no jump matched: the next step's name; absent at the last step (the thank you). */
  readonly nextName?: string;
  readonly isReadOnly: boolean;
  readonly refFor: (key: string) => (node: HTMLButtonElement | null) => void;
  readonly focusOn: (key: string) => void;
  readonly onChange: (jumps: readonly FormJump[]) => void;
}

/**
 * A step's logic (spec 0063, AC-6313, AC-6325), in Typeform's words: each rule "When <answers match>, Jump to
 * <a step below, or an ending>", tried in order, the first match deciding; under them, where everyone else goes
 * ("Otherwise, go to Step 3"). Only forward targets are offered, so a backward jump is nothing the editor can make.
 * With no rules, nothing is drawn: Add logic in the card's footer adds a ready one.
 */
function JumpRules({
  stepId,
  jumps,
  readable,
  choices,
  nextName,
  isReadOnly,
  refFor,
  focusOn,
  onChange,
}: JumpRulesProps) {
  if (jumps.length === 0) return null;
  const facts = questionFacts(readable);
  return (
    <FieldGroup label={strings.logic} hint={strings.otherwiseGoTo(nextName ?? strings.theEnd)}>
      <SettingsStack variant="nested">
        {jumps.map((jump, index) => {
          const chosen = idOfTarget(jump.to);
          const isGone = !choices.some((choice) => choice.id === chosen);
          return (
            <SettingsStack key={String(index)} variant="nested">
              {isGone && <Callout tone="danger">{strings.jumpGone}</Callout>}
              <ConditionsEditor
                value={jump.when}
                facts={facts}
                factLabel={routingStrings.question}
                isReadOnly={isReadOnly}
                firstRef={refFor(`step:${stepId}:jump:${String(index)}`)}
                onChange={(when) => {
                  onChange(changeJump(jumps, index, { when: storedShowWhen(when) }));
                }}
              />
              {/* The same row the conditions above it use, so Jump to starts on When's own left edge and removing a
                rule is the same control as removing a condition, not a third shape. */}
              <ConditionRow
                lead={strings.jumpTo}
                removeLabel={strings.removeJump(index + 1)}
                isDisabled={isReadOnly}
                {...(isReadOnly
                  ? {}
                  : {
                      onRemove: () => {
                        onChange(removeJump(jumps, index));
                        focusOn(`step:${stepId}:menu`);
                      },
                    })}
              >
                <Select
                  savesOnPick
                  label={strings.jumpTo}
                  isLabelHidden
                  items={[...choices]}
                  value={isGone ? null : chosen}
                  isReadOnly={isReadOnly}
                  onChange={(id) => {
                    const target = id === null ? undefined : targetOfId(id);
                    if (target !== undefined) onChange(changeJump(jumps, index, { to: target }));
                  }}
                />
              </ConditionRow>
            </SettingsStack>
          );
        })}
      </SettingsStack>
    </FieldGroup>
  );
}

/** Props for one step's logic. */
interface StepEditorProps {
  readonly step: FormStep;
  readonly earlier: readonly FormQuestion[];
  /** What its jumps may read: the questions before it and its own (AC-6313). */
  readonly readable: readonly FormQuestion[];
  /** Where its jumps may go: the steps below it, then the form's endings. */
  readonly jumpTargets: readonly { readonly id: string; readonly label: string }[];
  /** The next step's name, where everyone else goes; absent at the last step. */
  readonly nextName?: string;
  readonly refFor: (key: string) => (node: HTMLButtonElement | null) => void;
  readonly focusOn: (key: string) => void;
  readonly isReadOnly: boolean;
  readonly problem?: string;
  readonly onChange: (change: StepChange) => void;
}

/**
 * A step's logic under its header (spec 0063, AC-6312, AC-6313; T20): its Show only if and its jumps, only when it
 * has them. Its title is renamed in place on the header, and Add logic is in the header's menu.
 */
function StepEditor({
  step,
  earlier,
  readable,
  jumpTargets,
  nextName,
  refFor,
  focusOn,
  isReadOnly,
  problem,
  onChange,
}: StepEditorProps) {
  const key = `step:${step.id}`;
  return (
    <>
      {/* A refusal is about the step (empty, or its Show when): said over its logic. */}
      {problem !== undefined && <Callout tone="danger">{problem}</Callout>}
      {step.showWhen !== undefined && (
        <ShowWhenRules
          showWhen={step.showWhen}
          earlier={earlier}
          readsLaterText={strings.stepReadsLater}
          isReadOnly={isReadOnly}
          firstRef={refFor(`${key}:show`)}
          onChange={(showWhen) => {
            onChange({ showWhen });
          }}
          onClear={() => {
            onChange({ showWhen: null });
            focusOn(`${key}:menu`);
          }}
        />
      )}
      <JumpRules
        stepId={step.id}
        jumps={step.jumps ?? []}
        readable={readable}
        choices={jumpTargets}
        {...(nextName === undefined ? {} : { nextName })}
        isReadOnly={isReadOnly}
        refFor={refFor}
        focusOn={focusOn}
        onChange={(jumps) => {
          onChange({ jumps: [...jumps] });
        }}
      />
    </>
  );
}

/** A row's "Shows when …" line, only when its Show when has a complete condition to say. */
function shownWhenOf(
  showWhen: ShowWhenValue | undefined,
  facts: ReturnType<typeof questionFacts>,
): { readonly condition?: string } {
  const line = showWhen === undefined ? undefined : conditionsLine(showWhen, facts);
  return line === undefined ? {} : { condition: routingStrings.shownWhen(line) };
}
