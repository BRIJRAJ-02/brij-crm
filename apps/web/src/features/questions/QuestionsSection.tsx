// Brief
// Purpose: a list of questions (spec 0023, 0023-experience.md, Questions), shared by a form's Form tab and a booking page's editor (spec 0057): cards closed until opened, each with its editor.
// Main task: add, word, type, file, require, duplicate, delete (with Undo) and reorder the questions.
// Leaves out: saving (each editor saves as it goes), the look and the words around the questions.
import { CONSENT_PURPOSES, type AnswerType, type FormAttributeChoice, type FormQuestion } from '@crm/data';
import {
  ANSWER_TYPES,
  BOOKING_ANSWER_TYPES,
  CHOICE_TYPES,
  CONDITIONS_MAX,
  FORM_CHOICES_MAX,
  FORM_STEP_TITLE_MAX,
  NO_PLACEHOLDER_TYPES,
  QUESTION_PRESETS,
  RATING_COUNT,
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
  DatePicker,
  Field,
  FieldGroup,
  focusInCard,
  focusLater,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  OptionsEditor,
  QuestionList,
  Select,
  SettingsRow,
  SettingsStack,
  Sentence,
  SubmenuTrigger,
  Switch,
  Tooltip,
  type IconName,
  type OptionsEditorOption,
  type QuestionListItem,
  type Toasts,
} from '@crm/ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addPreset,
  changeQuestion,
  duplicateQuestion,
  filedLine,
  fittingAttributes,
  insertQuestion,
  matchingField,
  markSource,
  SOURCE_ANSWER_TYPES,
  typeChange,
  planNewAttributes,
  moveQuestion,
  removeQuestion,
  restoreQuestion,
  type QuestionChange,
  type Questions,
} from './questions.ts';
import {
  addJump,
  changeJump,
  idOfTarget,
  jumpChoices,
  nextQuestionName,
  nextStepName,
  questionJumpChoices,
  removeJump,
  targetOfId,
} from './jumps.ts';
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
  takeStepStart,
  type Flow,
  type StepChange,
} from './steps.ts';
import { strings } from './strings.ts';
import { ConditionLines, withCondition } from '../routing/ConditionLines.tsx';
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
  /** Before Add a question in the list's header: a form's Logic. */
  readonly actionsStart?: ReactNode;
  /**
   * What is wrong with the logic at one place (T41), in words: a question's Show only if, a step, or one of a step's
   * rules. A form passes it; a booking page has no logic to check.
   */
  readonly logicWarnings?: (place: LogicPlaceRef) => readonly string[];
  /**
   * Deletes a question the form's logic reads (T41: "deleting a used question warns and offers fix with Undo"): the
   * form takes it and the rules that read it together, with one Undo. Answers false when the question isn't used, so
   * the list deletes it as usual.
   */
  readonly onRemoveUsed?: (question: FormQuestion, index: number) => boolean;
  /**
   * An empty list starts with one new question, its words focused (a Blank form, spec 0063, AC-6323: "the cursor in
   * the first question"), once, as the list mounts. Escape before typing takes it away again, as with any new one.
   */
  readonly startsWithQuestion?: boolean;
}

/** Where a logic warning is: a question, a step, or a step's rule by its place. */
export type LogicPlaceRef =
  | { readonly kind: 'question'; readonly questionId: string }
  | { readonly kind: 'step'; readonly stepId: string }
  | { readonly kind: 'jump'; readonly stepId: string; readonly index: number }
  | { readonly kind: 'questionJump'; readonly questionId: string; readonly index: number };

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
/** A step's rules row, under its last question. */
const AFTER_ROW = 'after-step:';
const afterOfRow = (rowId: string) => (rowId.startsWith(AFTER_ROW) ? rowId.slice(AFTER_ROW.length) : undefined);
const stepOfRow = (rowId: string) => (rowId.startsWith(STEP_ROW) ? rowId.slice(STEP_ROW.length) : undefined);
/** One at a time: a question's rules row, right under it ("After this question"). */
const AFTER_QUESTION_ROW = 'after-question:';
const afterQuestionOfRow = (rowId: string) =>
  rowId.startsWith(AFTER_QUESTION_ROW) ? rowId.slice(AFTER_QUESTION_ROW.length) : undefined;

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

/**
 * The answer types in the groups the type menu shows them in (critique c: picked first, from a short grouped list).
 * Choice stands for Dropdown and Multi select too, which are its two switches (Show as a dropdown, Let people pick
 * more than one); Checkbox is a Yes or no, and stays only on a question that has it.
 */
const TYPE_GROUPS: readonly { readonly id: keyof typeof strings.typeGroups; readonly types: readonly AnswerType[] }[] =
  [
    { id: 'text', types: ['short_text', 'long_text', 'email', 'phone', 'website', 'number'] },
    { id: 'choice', types: ['choice', 'yes_no', 'rating', 'scale', 'ranking'] },
    { id: 'time', types: ['date', 'time', 'datetime', 'country', 'address'] },
    { id: 'more', types: ['file', 'signature', 'consent', 'hidden'] },
  ];

/** The types Choice stands for in the menu: a question of any of them shows Choice as its type. */
const CHOICE_FAMILY: ReadonlySet<AnswerType> = new Set(['choice', 'dropdown', 'multi_select']);

/** Props for the type menu. */
interface TypeMenuProps {
  /** The trigger: Add a question, the gap's +, or an open question's type button. */
  readonly children: ReactNode;
  readonly label: string;
  /** The types this list may hold (a booking page's are fewer). */
  readonly allowed: ReadonlySet<AnswerType>;
  /** The question's type now, checked; absent when adding. */
  readonly current?: AnswerType;
  readonly onPick: (type: AnswerType) => void;
  /** Ready-made questions at the end, when adding to a form. */
  readonly presets?: { readonly isFull: boolean; readonly onPick: (key: string) => void };
}

/** The answer types, grouped, as a menu: what Add a question opens, and what an open question's type button opens. */
function TypeMenu({ children, label, allowed, current, onPick, presets }: TypeMenuProps) {
  const currentFamily = current !== undefined && CHOICE_FAMILY.has(current) ? 'choice' : current;
  return (
    <MenuTrigger>
      {children}
      <Menu
        label={label}
        onAction={(key) => {
          const id = String(key);
          if (id.startsWith('preset:')) presets?.onPick(id.slice('preset:'.length));
          else {
            const type = ANSWER_TYPES.find((each) => each === id);
            if (type !== undefined) onPick(type);
          }
        }}
      >
        {TYPE_GROUPS.map((group) => {
          // A type the list may hold, and the question's own (a Checkbox kept from before) so it shows checked.
          const types = [
            ...group.types.filter((type) => allowed.has(type)),
            ...(group.id === 'choice' && current === 'checkbox' ? (['checkbox'] as const) : []),
          ];
          if (types.length === 0) return null;
          return (
            <MenuSection key={group.id} label={strings.typeGroups[group.id]}>
              {types.map((type) => (
                <MenuItem key={type} id={type} icon={TYPE_ICONS[type]} isChecked={type === currentFamily}>
                  {strings.answerTypes[type]}
                </MenuItem>
              ))}
            </MenuSection>
          );
        })}
        {presets !== undefined && (
          <MenuSection label={strings.typeGroups.presets}>
            {QUESTION_PRESETS.map((preset) => (
              <MenuItem key={preset.key} id={`preset:${preset.key}`} isDisabled={presets.isFull}>
                {preset.label}
              </MenuItem>
            ))}
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  );
}

/** The questions: a header with the count and Add a question, then the cards. */
export function QuestionsSection(props: QuestionsSectionProps) {
  const { questions, onChange, attributes, objectName, liveIds, newId, toasts, problem, isReadOnly } = props;
  const { stats } = props;
  const warningsAt = (place: LogicPlaceRef): readonly string[] => props.logicWarnings?.(place) ?? [];
  const isFilingOff = props.isFilingOff === true;
  const isLocked = (question: FormQuestion) => props.locked?.ids.has(question.id) === true;
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
  // One card open at a time (critique c): opening one closes the rest, so the list reads as a list.
  const opened = (id: string) => {
    setOpen(new Set([id]));
    setJustAdded(id);
    props.onOpened?.(id);
  };
  const addRef = useRef<HTMLButtonElement>(null);
  // Questions just added and not yet given words: Escape in their field takes them away again (critique c).
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  // Questions whose Save answer to was picked by hand: their words no longer pick a field for them.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const allowed: ReadonlySet<AnswerType> = new Set(
    (props.keptWith === 'booking' ? BOOKING_TYPE_ITEMS : TYPE_ITEMS).map((item) => item.id),
  );

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
  // A form's new question starts there too (T40, 5 November 2026: "Save answer to defaults to Keep with the answer"):
  // its words file it onto a field the object already has (Email, Company), and making a new field is a choice.
  const keptAtFirst = (list: readonly FormQuestion[], id: string): readonly FormQuestion[] =>
    list.map((each) => (each.id === id && each.filedOn === undefined ? { ...each, kept: true as const } : each));

  /**
   * A new question of `type` before `beforeId` (the gap's "Add a question here"), else under the open question, else
   * at the end (critique c: insert under focus). `takesStart` puts it at the top of `beforeId`'s step.
   */
  const addAt = (type: AnswerType, place: { readonly beforeId?: string; readonly takesStart?: boolean } = {}) => {
    if (isFull) return;
    const id = newId();
    const openOne = questions.find((question) => open.has(question.id));
    const index = (list: Questions) => {
      if (place.beforeId !== undefined) {
        const at = list.findIndex((question) => question.id === place.beforeId);
        return at < 0 ? list.length : at;
      }
      const at = openOne === undefined ? -1 : list.findIndex((question) => question.id === openOne.id);
      return at < 0 ? list.length : at + 1;
    };
    if (breaks !== undefined) {
      breaks.onChange((before) => {
        const flowNow = {
          ...before,
          questions: keptAtFirst(insertQuestion(before.questions, id, type, index(before.questions)), id),
        };
        return place.takesStart === true && place.beforeId !== undefined
          ? takeStepStart(flowNow, place.beforeId, id)
          : flowNow;
      });
    } else {
      onChange((before) => keptAtFirst(insertQuestion(before, id, type, index(before)), id));
    }
    setFresh((before) => new Set([...before, id]));
    opened(id);
  };
  // A Blank form opens on its first question, ready to type (once, as the list mounts).
  const hasStarted = useRef(false);
  const startFirst = useEffectEvent(() => {
    if (hasStarted.current || props.startsWithQuestion !== true || questions.length > 0 || isReadOnly) return;
    hasStarted.current = true;
    addAt('short_text');
  });
  useEffect(() => {
    startFirst();
  }, []);
  const addPresetAt = (key: string) => {
    const preset = QUESTION_PRESETS.find((each) => each.key === key);
    if (preset === undefined || isFull) return;
    const id = newId();
    onChange((before) => keptAtFirst(addPreset(before, preset, id), id));
    opened(id);
  };
  /** Escape in a new question that was never given words: it goes, quietly, and focus goes back to Add a question. */
  const dropFresh = (question: FormQuestion) => {
    if (!fresh.has(question.id) || question.label.trim() !== '') return false;
    onChange((before) => removeQuestion(before, question.id).questions);
    setFresh((before) => new Set([...before].filter((each) => each !== question.id)));
    setOpen(new Set());
    focusLater(() => addRef.current);
    return true;
  };

  /**
   * Save answer to, as the question's ⋯ lists it (T40): Keep with the answer first, then the fields its answer fits
   * (one another question uses says so), then a new field, made only when picked. Undefined where nothing is filed: a
   * form that keeps its submissions only, a booking kept out of the CRM, a consent, or a question that stays.
   */
  const filingChoices = (question: FormQuestion) => {
    if (objectName === undefined || isFilingOff || question.answerType === 'consent' || isLocked(question)) {
      return undefined;
    }
    const couldCreate = props.canCreate === true && !isReadOnly && question.answerType !== 'file';
    const fitting = fittingAttributes(attributes, question.answerType);
    const usedBy = new Map(
      questions
        .filter((each) => each.id !== question.id && each.filedOn !== undefined)
        .map((each) => [each.filedOn?.attributeId ?? '', each.label === '' ? strings.untitledQuestion : each.label]),
    );
    const title = planned.get(question.id) ?? creatable.get(question.id);
    const keep = props.keptWith === 'booking' ? strings.keepWithBooking : strings.keepWithAnswer;
    const items: { id: string; label: string; description?: string; isDisabled?: boolean }[] = [
      { id: NOT_FILED, label: keep },
      ...fitting.map((attribute) => {
        const holder = usedBy.get(attribute.attributeId);
        return {
          id: attribute.attributeId,
          label: attribute.title,
          ...(attribute.canWrite
            ? holder === undefined
              ? {}
              : { description: strings.takenBy(holder) }
            : { description: strings.cantWrite, isDisabled: true }),
        };
      }),
      ...(couldCreate
        ? [
            {
              id: CREATE,
              label: title === undefined ? strings.newFieldUnnamed(objectName) : strings.newField(title, objectName),
            },
          ]
        : []),
    ];
    const value = question.filedOn?.attributeId ?? (question.kept !== true && couldCreate ? CREATE : NOT_FILED);
    const current =
      question.filedOn !== undefined
        ? filedLine(question, objectName, attributes)
        : value === CREATE
          ? (items.find((item) => item.id === CREATE)?.label ?? keep)
          : keep;
    return { items, value, current };
  };

  const remove = (question: FormQuestion) => {
    const index = questions.findIndex((each) => each.id === question.id);
    if (props.onRemoveUsed?.(question, index) === true) return;
    onChange((before) => removeQuestion(before, question.id).questions);
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
  // One at a time (spec 0063, AC-6313): each question is a screen of its own, so each carries its own rules.
  const isOneByOne = breaks?.layout === 'conversational';
  const places = flow === undefined ? new Map<string, { number: number; count: number }>() : stepPlaces(flow);
  // A stepped form whose first questions have no header of their own (one made before Steps split forms at once):
  // they still read as Step 1, under a header that makes its break the moment it is renamed or given logic.
  const firstQuestion = questions[0];
  const hasLeadHeader = flow === undefined || firstQuestion === undefined || itemsOf(flow)[0]?.kind === 'step';
  const leadRow: readonly QuestionListItem[] =
    isStepped && !hasLeadHeader
      ? [
          {
            id: `${STEP_ROW}${LEAD}`,
            kind: 'step',
            label: strings.stepName(1),
            note: strings.questionCount(
              itemsOf(flow).findIndex((item) => item.kind === 'step') < 0
                ? questions.length
                : itemsOf(flow).findIndex((item) => item.kind === 'step'),
            ),
          },
        ]
      : [];
  const headed: readonly QuestionListItem[] = !isStepped
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
              // Clearly a step (T39): its number, its name and how many questions it holds.
              note: strings.questionCount(place.count),
              // Named by every question, so one that comes after the step reads by its label, not as removed.
              ...shownWhenOf(step.showWhen, questionFacts(questions)),
              hasProblem: stepProblem?.stepId === step.id,
            },
          ];
        }),
      ];
  // A step's rules sit under its last question (critique c, 7: read after the questions they read), as a note row:
  // "After this step: If … → …, Otherwise → …".
  // With One at a time a question's rules sit right under it, the same note row: "After this question: If … → …".
  const items: readonly QuestionListItem[] = !isStepped
    ? !isOneByOne
      ? headed
      : headed.flatMap((item): QuestionListItem[] => {
          const question = questions.find((each) => each.id === item.id);
          if (question === undefined || (question.jumps?.length ?? 0) === 0) return [item];
          return [item, { id: `${AFTER_QUESTION_ROW}${question.id}`, kind: 'note', label: strings.afterQuestion }];
        })
    : headed.flatMap((item, at): QuestionListItem[] => {
        const next = headed[at + 1];
        if (item.kind === 'step' || (next !== undefined && next.kind !== 'step')) return [item];
        // The last question of a step: the step it is in is the nearest header above it.
        const header = headed.slice(0, at).findLast((each) => each.kind === 'step');
        const stepId = header === undefined ? undefined : stepOfRow(header.id);
        const step = breaks.steps.find((each) => each.id === stepId);
        if (step === undefined || (step.jumps?.length ?? 0) === 0) return [item];
        return [item, { id: `${AFTER_ROW}${step.id}`, kind: 'note', label: strings.afterStep(header?.label ?? '') }];
      });

  // A step with logic shows it under its header, always: its rules are what the header is about.
  const shownOpen: ReadonlySet<string> = new Set([
    ...openIds,
    ...(breaks?.steps ?? [])
      .filter((step) => step.showWhen !== undefined || warningsAt({ kind: 'step', stepId: step.id }).length > 0)
      .map((step) => `${STEP_ROW}${step.id}`),
  ]);

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

  /**
   * The quiet + in the gap above a row (T39): "Add a question here" (the types), and with Steps "Start a new step
   * here" too, between two questions of one step. Above a step's first question the new one opens that step; above
   * a step header it ends the step before. Nothing above the list's first row.
   */
  const gapFor = (rowId: string): ReactNode => {
    const at = items.findIndex((item) => item.id === rowId);
    // A question's rules belong to it: nothing goes between them, and the gap under them adds after both.
    if (at <= 0 || isFull || afterQuestionOfRow(rowId) !== undefined) return null;
    const previous = items[at - 1];
    // After a step's rules the next gap belongs to the next step: the end of this one is the gap above its rules.
    if (previous?.kind === 'note' && afterQuestionOfRow(previous.id) === undefined) return null;
    const noteOf = afterOfRow(rowId);
    if (noteOf !== undefined) {
      const ahead = items.slice(at + 1).find((item) => item.kind === undefined || item.kind === 'question');
      return (
        <TypeMenu
          label={strings.addHere}
          allowed={allowed}
          onPick={(type) => {
            addAt(type, ahead === undefined ? {} : { beforeId: ahead.id });
          }}
        >
          <Button variant="ghost" size="sm" icon="plus" label={strings.addHere} />
        </TypeMenu>
      );
    }
    const rowStep = stepOfRow(rowId);
    // The question the new one goes before: this row's, or the first of the step this header opens.
    const beforeId =
      rowStep === undefined ? rowId : (items.slice(at + 1).find((item) => item.kind !== 'step')?.id ?? undefined);
    const takesStart = rowStep === undefined && previous?.kind === 'step';
    const place = { ...(beforeId === undefined ? {} : { beforeId }), takesStart };
    const canSplit = isStepped && rowStep === undefined && previous?.kind !== 'step' && !startsAStep(flow, rowId);
    const button = (
      <Button variant="ghost" size="sm" icon="plus" label={canSplit ? strings.addHereOrStep : strings.addHere} />
    );
    if (!canSplit) {
      return (
        <TypeMenu
          label={strings.addHere}
          allowed={allowed}
          onPick={(type) => {
            addAt(type, place);
          }}
        >
          {button}
        </TypeMenu>
      );
    }
    return (
      <MenuTrigger>
        {button}
        <Menu
          label={strings.addHereOrStep}
          onAction={(key) => {
            if (key === 'split') split(rowId);
          }}
        >
          <SubmenuTrigger>
            <MenuItem icon="plus">{strings.addHere}</MenuItem>
            <Menu
              label={strings.addHere}
              onAction={(key) => {
                const type = ANSWER_TYPES.find((each) => each === String(key));
                if (type !== undefined) addAt(type, place);
              }}
            >
              {TYPE_GROUPS.map((group) => {
                const types = group.types.filter((type) => allowed.has(type));
                return types.length === 0 ? null : (
                  <MenuSection key={group.id} label={strings.typeGroups[group.id]}>
                    {types.map((type) => (
                      <MenuItem key={type} id={type} icon={TYPE_ICONS[type]}>
                        {strings.answerTypes[type]}
                      </MenuItem>
                    ))}
                  </MenuSection>
                );
              })}
            </Menu>
          </SubmenuTrigger>
          <MenuItem id="split" icon="scissors">
            {strings.startStepHere}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
  };

  /**
   * Add a step (T39: "a clear Add a step" up front): a new step at the end holding one new question, its name typed
   * first, so no step is ever empty.
   */
  const addStepAtEnd = () => {
    if (breaks === undefined || isFull) return;
    const stepId = newId();
    const questionId = newId();
    breaks.onChange((before) => ({
      questions: keptAtFirst(
        insertQuestion(before.questions, questionId, 'short_text', before.questions.length),
        questionId,
      ),
      steps: [...before.steps, { id: stepId, startsAt: questionId }],
    }));
    setFresh((before) => new Set([...before, questionId]));
    setOpen(new Set([questionId]));
    setRenaming({ stepId, text: '' });
    props.onOpened?.(`${STEP_ROW}${stepId}`);
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

  /**
   * Add logic on a question with One at a time (one click, as on a step): a ready rule reading this question, sending
   * people past the next question (where everyone goes anyway) to the one after it, or to an ending, or to an ending
   * made for it. Undefined when it could do nothing, so the menu leaves it out.
   */
  const addQuestionLogic = (question: FormQuestion): (() => void) | undefined => {
    if (!isOneByOne || isReadOnly || question.answerType === 'hidden') return undefined;
    const at = questions.findIndex((each) => each.id === question.id);
    const facts = questionFacts(questions.slice(0, at + 1));
    const jumps = question.jumps ?? [];
    if (facts.length === 0 || jumps.length >= STEP_JUMPS_MAX) return undefined;
    const offered = questionJumpChoices(questions, breaks.endings ?? [], question.id);
    const choices = offered.slice(offered[0]?.id.startsWith('step:') === true ? 1 : 0);
    if (choices.length === 0 && breaks.onAddEnding === undefined) return undefined;
    return () => {
      const first = choices[0];
      const ending = first === undefined ? breaks.onAddEnding?.() : undefined;
      const target = first === undefined ? (ending === undefined ? undefined : { ending }) : targetOfId(first.id);
      if (target === undefined) return;
      const when = storedShowWhen(readyConditions(facts, new Set([question.key])));
      onChange((before) => {
        const now = before.find((each) => each.id === question.id);
        return changeQuestion(before, question.id, { jumps: addJump(now?.jumps ?? [], target, when) }, liveIds);
      });
      focusOn(`${question.id}:jump:${String(jumps.length)}`);
    };
  };

  /** A step header's ⋯: Rename, Add logic, Show only if…, and Merge with the step above. */
  const stepMenu = (rowId: string) => {
    const stepId = stepOfRow(rowId);
    if (stepId === undefined || isReadOnly || flow === undefined || breaks === undefined) return null;
    const step = breaks.steps.find((each) => each.id === stepId);
    const isLead = stepId === LEAD;
    const name = isLead ? strings.stepName(1) : strings.stepName(places.get(stepId)?.number ?? 1, step?.title);
    // Once the step has a rule, + Add a rule sits under them: the menu doesn't repeat it (item 5).
    const addLogic = (step?.jumps?.length ?? 0) > 0 ? undefined : addLogicTo(stepId);
    const earlier = isLead ? [] : questionsBefore(flow, stepId);
    const canShowIf = !isLead && step?.showWhen === undefined && questionFacts(earlier).length > 0;
    const canMerge = !isLead && !isFirstStep(flow, stepId) && hasLeadHeader;
    const canMergeAfterLead = !isLead && !hasLeadHeader;
    // Rename alone is no menu (item 5: no single item menus): the pencil itself.
    if (addLogic === undefined && !canShowIf && !canMerge && !canMergeAfterLead) {
      return (
        <Tooltip content={strings.renameStep}>
          <Button
            ref={refFor(`step:${stepId}:menu`)}
            variant="ghost"
            icon="pencil"
            label={strings.renameStepNamed(name)}
            onPress={() => {
              const id = ensureStep(stepId);
              if (id !== undefined) setRenaming({ stepId: id, text: step?.title ?? '' });
            }}
          />
        </Tooltip>
      );
    }
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
          {!isReadOnly && isStepped && !isFull && (
            <Button icon="list-plus" onPress={addStepAtEnd}>
              {strings.addStep}
            </Button>
          )}
          {!isReadOnly &&
            (isFull ? (
              // Off at the most a form holds, and says so on hover and focus.
              <Tooltip content={tooMany}>
                <Button icon="plus" isDisabled>
                  {strings.addQuestion}
                </Button>
              </Tooltip>
            ) : (
              // The type first (critique c), then the question goes under the one being edited.
              <TypeMenu
                label={strings.addQuestion}
                allowed={allowed}
                onPick={(type) => {
                  addAt(type);
                }}
                {...(props.keptWith === 'submission' ? { presets: { isFull, onPick: addPresetAt } } : {})}
              >
                <Button ref={addRef} icon="plus">
                  {strings.addQuestion}
                </Button>
              </TypeMenu>
            ))}
        </>
      }
      items={items}
      // A quiet + between the cards, always there (T39: adding in between was "a find"); not on a read only list.
      {...(isReadOnly ? {} : { gaps: 'shown' as const, renderGap: gapFor })}
      openIds={shownOpen}
      onOpenChange={(id, isOpen) => {
        // The question or divider a publish refused stays open until it is fixed.
        if (!isOpen && (problem?.questionId === id || `${STEP_ROW}${stepProblem?.stepId ?? ''}` === id)) return;
        if (isOpen) props.onOpened?.(id);
        // One card open at a time (critique c).
        setOpen((before) => {
          if (isOpen) return new Set([id]);
          const next = new Set(before);
          next.delete(id);
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
                  renderGap: (id: string) => gapFor(id),
                }),
          }
        : {})}
      renderOpen={(id) => {
        const ruledId = afterQuestionOfRow(id);
        if (ruledId !== undefined) {
          const at = questions.findIndex((each) => each.id === ruledId);
          const question = questions[at];
          if (question === undefined || breaks === undefined) return null;
          const nextName = nextQuestionName(questions, ruledId);
          return (
            <JumpRules
              keyBase={ruledId}
              heading={strings.afterQuestion}
              goneText={strings.jumpGoneQuestion}
              jumps={question.jumps ?? []}
              // A question's rules decide once it is answered, so they read it and every question before it.
              readable={questions.slice(0, at + 1)}
              choices={questionJumpChoices(questions, breaks.endings ?? [], ruledId)}
              {...(nextName === undefined ? {} : { nextName })}
              isReadOnly={isReadOnly}
              refFor={refFor}
              focusOn={focusOn}
              onChange={(jumps) => {
                onChange((before) =>
                  changeQuestion(before, ruledId, { jumps: jumps.length === 0 ? null : [...jumps] }, liveIds),
                );
              }}
              onAddRule={addQuestionLogic(question)}
              warnings={(index) => warningsAt({ kind: 'questionJump', questionId: ruledId, index })}
            />
          );
        }
        const afterId = afterOfRow(id);
        const stepId = stepOfRow(id) ?? afterId;
        if (stepId !== undefined) {
          const step = breaks?.steps.find((each) => each.id === stepId);
          if (step === undefined || breaks === undefined || flow === undefined) return null;
          const stepWarnings = warningsAt({ kind: 'step', stepId });
          // Its header holds its Show only if and what is wrong with it; its rules sit under its last question.
          if (
            afterId === undefined &&
            step.showWhen === undefined &&
            stepProblem?.stepId !== stepId &&
            stepWarnings.length === 0
          ) {
            return null;
          }
          return (
            <StepEditor
              part={afterId === undefined ? 'head' : 'after'}
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
              onAddRule={isReadOnly ? undefined : addLogicTo(stepId)}
              warnings={stepWarnings}
              jumpWarnings={(index) => warningsAt({ kind: 'jump', stepId, index })}
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
            isLocked={isLocked(question)}
            isReadOnly={isReadOnly}
            refFor={refFor}
            focusOn={focusOn}
            onChange={(change) => {
              onChange((before) => changeQuestion(before, id, change, liveIds));
            }}
            onChoicesInvalid={(isInvalid) => {
              markRefused(id, isInvalid);
            }}
            warnings={warningsAt({ kind: 'question', questionId: id })}
          />
        );
      }}
      renderOpenHead={(id) => {
        const question = questions.find((each) => each.id === id);
        if (question === undefined) return null;
        return (
          <QuestionHead
            question={question}
            allowed={allowed}
            isLocked={isLocked(question)}
            {...(props.locked === undefined ? {} : { lockReason: props.locked.reason })}
            isReadOnly={isReadOnly}
            // A question just added, or one a publish refused, takes focus and comes into view.
            isJustAdded={justAdded === id || problem?.questionId === id}
            {...(problem?.questionId === id ? { problem: problem.message } : {})}
            onLabel={(label) => {
              setFresh((before) => (before.has(id) ? new Set([...before].filter((each) => each !== id)) : before));
              // Its words pick a field the object already has, until Save answer to is chosen by hand (T40).
              const field =
                objectName === undefined || isFilingOff || chosen.has(id) || question.filedOn !== undefined
                  ? undefined
                  : question.kept === true
                    ? matchingField(questions, id, label, attributes)
                    : undefined;
              onChange((before) =>
                changeQuestion(before, id, field === undefined ? { label } : { label, filedOn: field }, liveIds),
              );
            }}
            onType={(type) => {
              onChange((before) => changeQuestion(before, id, typeChange(question, attributes, type), liveIds));
            }}
            onSubmit={() => {
              // Enter goes on to the next question, of the same type, under this one (Typeform's way).
              if (question.label.trim() !== '') addAt(question.answerType);
            }}
            onEscape={() => dropFresh(question)}
          />
        );
      }}
      renderFooterStart={(id) => {
        if (stepOfRow(id) !== undefined) return null;
        const question = questions.find((each) => each.id === id);
        // A hidden question has nothing a visitor could answer (spec 0063): it is never one they must.
        if (question === undefined || question.answerType === 'hidden') return null;
        return (
          <Switch
            label={strings.required}
            isSelected={question.required}
            isReadOnly={isReadOnly}
            onChange={(required) => {
              onChange((before) => changeQuestion(before, id, { required }, liveIds));
            }}
          />
        );
      }}
      renderFooter={(id) => {
        if (stepOfRow(id) !== undefined || isReadOnly) return null;
        const question = questions.find((each) => each.id === id);
        if (question === undefined) return null;
        const at = questions.findIndex((each) => each.id === id);
        const name = question.label === '' ? strings.untitledQuestion : question.label;
        const locked = isLocked(question);
        // Show only if…: one click to a ready condition, while it has none and something before it to read.
        // A hidden question is never shown, so it has no Show only if (critique c).
        const canShowIf =
          !locked &&
          question.answerType !== 'hidden' &&
          question.showWhen === undefined &&
          questionFacts(questions.slice(0, at)).length > 0;
        // Give points (Typeform's score, T20): on a form only, on a question that can score.
        const canScore =
          props.keptWith === 'submission' &&
          question.points === undefined &&
          SCORED_TYPES.includes(question.answerType);
        // How they heard about you (spec 0067, AC-6703): a form's one choice or short text question.
        const canBeSource = props.keptWith === 'submission' && SOURCE_ANSWER_TYPES.has(question.answerType);
        // One at a time: Add logic, while it has no rules (once it has, + Add a rule sits under them).
        const addLogic = (question.jumps?.length ?? 0) > 0 ? undefined : addQuestionLogic(question);
        const filing = filingChoices(question);
        return (
          <MenuTrigger>
            <Button ref={refFor(`${id}:menu`)} variant="ghost" icon="ellipsis" label={strings.questionActions(name)} />
            <Menu
              label={strings.questionActions(name)}
              onAction={(key) => {
                if (key === 'show') {
                  onChange((before) =>
                    changeQuestion(
                      before,
                      id,
                      { showWhen: storedShowWhen(readyConditions(questionFacts(questions.slice(0, at)))) },
                      liveIds,
                    ),
                  );
                  focusOn(`${id}:show`);
                }
                if (key === 'points') {
                  onChange((before) => changeQuestion(before, id, { points: startingPoints(question) }, liveIds));
                }
                if (key === 'logic') addLogic?.();
                if (key === 'source') onChange((before) => markSource(before, id, question.source !== true));
                if (key === 'duplicate') {
                  const copy = newId();
                  onChange((before) => keptAtFirst(duplicateQuestion(before, id, copy), copy));
                  opened(copy);
                }
                if (key === 'delete') remove(question);
              }}
            >
              {canShowIf && (
                <MenuItem id="show" icon="eye">
                  {strings.showOnlyIf}
                </MenuItem>
              )}
              {addLogic !== undefined && (
                <MenuItem id="logic" icon="git-branch">
                  {strings.addLogic}
                </MenuItem>
              )}
              {filing !== undefined && (
                <SubmenuTrigger>
                  <MenuItem icon="database" description={filing.current}>
                    {strings.whereItGoes}
                  </MenuItem>
                  <Menu
                    label={strings.whereItGoes}
                    onAction={(key) => {
                      const picked = String(key);
                      setChosen((before) => new Set([...before, id]));
                      if (picked === NOT_FILED)
                        onChange((before) => changeQuestion(before, id, { filedOn: null, kept: true }, liveIds));
                      else if (picked === CREATE)
                        onChange((before) => changeQuestion(before, id, { filedOn: null, kept: false }, liveIds));
                      else onChange((before) => changeQuestion(before, id, { filedOn: picked }, liveIds));
                    }}
                  >
                    {filing.items.map((item) => (
                      <MenuItem
                        key={item.id}
                        id={item.id}
                        isChecked={item.id === filing.value}
                        isDisabled={item.isDisabled === true}
                        {...(item.description === undefined ? {} : { description: item.description })}
                      >
                        {item.label}
                      </MenuItem>
                    ))}
                  </Menu>
                </SubmenuTrigger>
              )}
              {canBeSource && (
                <MenuItem id="source" icon="chart-line" isChecked={question.source === true}>
                  {strings.insightsSource}
                </MenuItem>
              )}
              {canScore && (
                <MenuItem id="points" icon="target">
                  {strings.givePoints}
                </MenuItem>
              )}
              <MenuItem id="duplicate" icon="copy">
                {strings.duplicateQuestion}
              </MenuItem>
              <MenuSeparator />
              {locked && props.locked !== undefined ? (
                <MenuItem id="locked" icon="lock" isDisabled description={props.locked.reason}>
                  {strings.lockedQuestion}
                </MenuItem>
              ) : (
                <MenuItem id="delete" icon="trash" isDanger>
                  {strings.deleteQuestion}
                </MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        );
      }}
      {...(isReadOnly
        ? {}
        : {
            onMove: (id: string, index: number) => {
              const stepId = stepOfRow(id);
              if (stepId === LEAD || afterOfRow(id) !== undefined) return;
              if (breaks !== undefined && isStepped) {
                // The lead header (no break yet) and the rules rows hold rows of their own: moves count without them.
                const notes = items
                  .filter((item) => item.id !== id)
                  .slice(0, index)
                  .filter((item) => item.kind === 'note').length;
                const at = Math.max(0, index - notes - (leadRow.length > 0 ? 1 : 0));
                breaks.onChange((before) => moveItem(before, stepId ?? id, at));
                return;
              }
              if (breaks !== undefined) {
                // Headers aren't drawn: a question moves among questions, and the breaks keep the order the
                // document needs (each at its question, in the questions' order). One at a time's rules rows
                // hold places of their own: the move counts without them.
                const notes = items
                  .filter((item) => item.id !== id)
                  .slice(0, index)
                  .filter((item) => item.kind === 'note').length;
                breaks.onChange((before) => {
                  const moved = { ...before, questions: moveQuestion(before.questions, id, index - notes) };
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

/** A rating's star counts, as its picker lists them (3 to 10, spec 0063). */
const RATING_COUNTS: readonly number[] = Array.from(
  { length: RATING_COUNT.max - RATING_COUNT.min + 1 },
  (_, at) => RATING_COUNT.min + at,
);

/** A lead header's stand in id: the questions before the first break, which have no break of their own yet. */
const LEAD = '~lead';

/** A question's first points, one click from Give points: the answer itself, yes over no, or 1, 2, 3 by choice. */
function startingPoints(question: FormQuestion): NonNullable<FormQuestion['points']> {
  if (question.answerType === 'rating' || question.answerType === 'scale') return 'value';
  if (question.answerType === 'yes_no') return [1, 0];
  return (question.choices ?? []).map((_, place) => place + 1);
}

/** Props for an open question's head. */
interface QuestionHeadProps {
  readonly question: FormQuestion;
  readonly allowed: ReadonlySet<AnswerType>;
  /** A question that stays as it is: its type can't change. */
  readonly isLocked: boolean;
  /** Why it stays, said on its type. */
  readonly lockReason?: string;
  readonly isReadOnly: boolean;
  /** Just added: its words take focus, and the card comes into view. */
  readonly isJustAdded: boolean;
  readonly problem?: string;
  readonly onLabel: (label: string) => void;
  readonly onType: (type: AnswerType) => void;
  /** Enter: the next question. */
  readonly onSubmit: () => void;
  /** Escape: a new question never given words goes again; answers whether it did. */
  readonly onEscape: () => boolean;
}

/**
 * An open question's head (T40, 5 November 2026; owner: "cluttered and not proper"): the question typed right in the
 * card's header row, large, with its answer type as a small icon menu at its start. No second title, no separate
 * Question field.
 */
function QuestionHead({
  question,
  allowed,
  isLocked,
  lockReason,
  isReadOnly,
  isJustAdded,
  problem,
  onLabel,
  onType,
  onSubmit,
  onEscape,
}: QuestionHeadProps) {
  const labelRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // A question just added takes focus without jumping, then glides into view (at once with reduced motion).
  // After the type menu that made it has closed and handed focus back (forms QA: by keyboard, focus stayed behind).
  useEffect(() => {
    if (!isJustAdded) return;
    focusLater(() => {
      const input = labelRef.current;
      if (input === null) return null;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      input.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      // Its card first, so the list keeps focus here rather than taking it to its first question.
      focusInCard(input);
      return input;
    });
  }, [isJustAdded]);
  const isConsent = question.answerType === 'consent';
  const typeName = strings.answerTypes[CHOICE_FAMILY.has(question.answerType) ? 'choice' : question.answerType];
  // Its type, said and changeable at a glance (UX review): the icon, the type's name and a chevron.
  const typeButton = (
    <Button
      variant="ghost"
      size="sm"
      icon={TYPE_ICONS[question.answerType]}
      iconRight="chevrons-up-down"
      // On a phone the icon and chevron stand alone, so the question keeps the room to be read.
      isLabelCollapsible
      label={strings.typeMenu(typeName)}
      isDisabled={isReadOnly || isLocked}
    >
      {typeName}
    </Button>
  );
  return (
    <>
      {isLocked && lockReason !== undefined ? (
        <Tooltip content={lockReason}>{typeButton}</Tooltip>
      ) : isReadOnly || isLocked ? (
        typeButton
      ) : (
        <TypeMenu label={strings.answerType} allowed={allowed} current={question.answerType} onPick={onType}>
          {typeButton}
        </TypeMenu>
      )}
      <Field
        ref={labelRef}
        // A consent's label is its exact wording, shown beside the tick box (spec 0023, AC-1053).
        label={isConsent ? strings.consentWording : strings.question}
        isLabelHidden
        size="lg"
        isWrapping
        placeholder={
          isConsent
            ? strings.consentPlaceholder
            : question.answerType === 'hidden'
              ? strings.hiddenPlaceholder
              : strings.questionPlaceholder
        }
        value={question.label}
        maxLength={200}
        isReadOnly={isReadOnly}
        onChange={onLabel}
        onSubmit={onSubmit}
        onEscape={() => {
          if (!onEscape()) labelRef.current?.blur();
        }}
        {...(problem === undefined ? {} : { error: problem })}
      />
    </>
  );
}

/** Props for one open question's body. */
interface QuestionEditorProps {
  readonly question: FormQuestion;
  readonly questions: Questions;
  readonly attributes: readonly FormAttributeChoice[];
  readonly isLocked: boolean;
  readonly isReadOnly: boolean;
  readonly refFor: (key: string) => (node: HTMLButtonElement | null) => void;
  readonly focusOn: (key: string) => void;
  readonly onChange: (change: QuestionChange) => void;
  /** The choices list holds a refused edit, or no longer does. */
  readonly onChoicesInvalid: (isInvalid: boolean) => void;
  /** What is wrong with its Show only if (T41). */
  readonly warnings: readonly string[];
}

/**
 * One question open, under its head (T40): only what its type needs. Its choices (with Choice's two switches, pick
 * more than one and show as a dropdown), its type's settings, its points once it gives some, its placeholder edited
 * in place, and its Show only if once it has one. Required and the ⋯ are in the card's footer.
 */
function QuestionEditor({
  question,
  questions,
  attributes,
  isLocked,
  isReadOnly,
  refFor,
  focusOn,
  onChange,
  onChoicesInvalid,
  warnings,
}: QuestionEditorProps) {
  const isChoice = CHOICE_TYPES.includes(question.answerType);
  const choices = question.choices ?? [];
  const family = CHOICE_FAMILY.has(question.answerType);
  const toType = (type: AnswerType) => {
    onChange(typeChange(question, attributes, type));
  };
  return (
    <>
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
      {family && !isLocked && (
        <SettingsStack variant="nested">
          <Switch
            label={strings.pickMore}
            isSelected={question.answerType === 'multi_select'}
            isReadOnly={isReadOnly}
            onChange={(isMore) => {
              toType(isMore ? 'multi_select' : 'choice');
            }}
          />
          {question.answerType !== 'multi_select' && (
            <Switch
              label={strings.asDropdown}
              isSelected={question.answerType === 'dropdown'}
              isReadOnly={isReadOnly}
              onChange={(isDropdown) => {
                toType(isDropdown ? 'dropdown' : 'choice');
              }}
            />
          )}
        </SettingsStack>
      )}
      <TypeOptions question={question} isReadOnly={isReadOnly} onChange={onChange} />
      <PointsEditor question={question} isReadOnly={isReadOnly} onChange={onChange} />
      {!NO_PLACEHOLDER_TYPES.includes(question.answerType) && (
        <Field
          label={strings.placeholder}
          isLabelHidden
          size="sm"
          placeholder={strings.placeholderInline}
          value={question.placeholder ?? ''}
          maxLength={80}
          isReadOnly={isReadOnly}
          onChange={(placeholder) => {
            onChange({ placeholder });
          }}
        />
      )}
      {question.answerType === 'consent' && <Callout tone="info">{strings.consentWordingHint}</Callout>}
      {warnings.map((warning) => (
        <Callout key={warning} tone="warning">
          {warning}
        </Callout>
      ))}
      {!isLocked && question.showWhen !== undefined && (
        <ShowWhenRules
          showWhen={question.showWhen}
          earlier={questions.slice(
            0,
            questions.findIndex((each) => each.id === question.id),
          )}
          readsLaterText={routingStrings.readsLater}
          otherwise={strings.otherwiseSkipQuestion}
          isReadOnly={isReadOnly}
          firstRef={refFor(`${question.id}:show`)}
          onChange={(showWhen) => {
            onChange({ showWhen });
          }}
          onClear={() => {
            onChange({ showWhen: null });
            focusOn(`${question.id}:menu`);
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
    case 'rating':
      // A rating's stars and the words at its ends (critique 9), set as Scale's are: one row, then the two words.
      return (
        <>
          <SettingsRow title={strings.ratingCount}>
            <Select
              label={strings.ratingCount}
              isLabelHidden
              size="sm"
              items={RATING_COUNTS.map((count) => ({ id: String(count), label: String(count) }))}
              value={String(options.count ?? RATING_COUNT.default)}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                const count = RATING_COUNTS.find((each) => String(each) === id);
                if (count !== undefined) onChange({ options: { count } });
              }}
            />
          </SettingsRow>
          <Field
            label={strings.lowLabel}
            placeholder={strings.ratingLowPlaceholder}
            value={options.lowLabel ?? ''}
            maxLength={40}
            isReadOnly={isReadOnly}
            onChange={(lowLabel) => {
              onChange({ options: { lowLabel } });
            }}
          />
          <Field
            label={strings.highLabel}
            placeholder={strings.ratingHighPlaceholder}
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
        <>
          {/* Its key, to copy into a link (critique c): ?source=newsletter fills it. */}
          <Field label={strings.hiddenKey} variant="copy" copyLabel={strings.copyKey} value={`?${question.key}=`} />
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
        </>
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
  /** The Otherwise line: what a visitor gets when the conditions don't match. */
  readonly otherwise: string;
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
  otherwise,
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
      <SettingsStack variant="nested">
        <ConditionLines
          value={showWhen}
          facts={earlier}
          isReadOnly={isReadOnly}
          firstRef={firstRef}
          onChange={(next) => {
            onChange(storedShowWhen(next));
          }}
        />
        {/* What happens when it doesn't match, said (T41). */}
        <Sentence lead="">{otherwise}</Sentence>
        {!isReadOnly && showWhen.rules.length < CONDITIONS_MAX && (
          <span>
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              onPress={() => {
                onChange(storedShowWhen(withCondition(showWhen, earlier)));
              }}
            >
              {routingStrings.addCondition}
            </Button>
          </span>
        )}
      </SettingsStack>
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
  /** What its focus keys start with: `step:<id>` for a step's rules, the question's id for a question's. */
  readonly keyBase: string;
  /** The heading over the rules: After this step, or After this question. */
  readonly heading?: string;
  /** Said over a rule whose target the form no longer has below it. */
  readonly goneText?: string;
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
  /** + Add a rule: one more ready rule, where there is still somewhere to send people. */
  readonly onAddRule?: (() => void) | undefined;
  /** What is wrong with each rule, by its place (T41). */
  readonly warnings: (index: number) => readonly string[];
}

/**
 * A step's logic (spec 0063, AC-6313, AC-6325), in Typeform's words: each rule "When <answers match>, Jump to
 * <a step below, or an ending>", tried in order, the first match deciding; under them, where everyone else goes
 * ("Otherwise, go to Step 3"). Only forward targets are offered, so a backward jump is nothing the editor can make.
 * With no rules, nothing is drawn: Add logic in the card's footer adds a ready one.
 */
function JumpRules({
  keyBase,
  heading = strings.logic,
  goneText = strings.jumpGone,
  jumps,
  readable,
  choices,
  nextName,
  isReadOnly,
  refFor,
  focusOn,
  onChange,
  onAddRule,
  warnings,
}: JumpRulesProps) {
  if (jumps.length === 0) return null;
  const facts = questionFacts(readable);
  return (
    <FieldGroup label={heading}>
      <SettingsStack variant="nested">
        {jumps.map((jump, index) => {
          const chosen = idOfTarget(jump.to);
          const isGone = !choices.some((choice) => choice.id === chosen);
          return (
            <SettingsStack key={String(index)} variant="nested">
              {isGone && <Callout tone="danger">{goneText}</Callout>}
              {warnings(index).map((warning) => (
                <Callout key={warning} tone="warning">
                  {warning}
                </Callout>
              ))}
              {/* One sentence (T41): "If Budget is Under $1k → Thank-you message: Not a fit". */}
              <ConditionLines
                value={jump.when}
                facts={facts}
                name={strings.jumpNumber(index + 1)}
                isReadOnly={isReadOnly}
                firstRef={refFor(`${keyBase}:jump:${String(index)}`)}
                onChange={(when) => {
                  onChange(changeJump(jumps, index, { when: storedShowWhen(when) }));
                }}
                {...(isReadOnly
                  ? {}
                  : {
                      end: (
                        <Button
                          variant="ghost"
                          icon="x"
                          label={strings.removeJump(index + 1)}
                          onPress={() => {
                            onChange(removeJump(jumps, index));
                            focusOn(`${keyBase}:menu`);
                          }}
                        />
                      ),
                    })}
                then={
                  <>
                    {strings.thenArrow}
                    <Select
                      savesOnPick
                      label={`${strings.jumpTo}, ${strings.jumpNumber(index + 1)}`}
                      isLabelHidden
                      variant="inline"
                      placeholder={strings.pickWhere}
                      items={[...choices]}
                      value={isGone ? null : chosen}
                      isReadOnly={isReadOnly}
                      onChange={(id) => {
                        const target = id === null ? undefined : targetOfId(id);
                        if (target !== undefined) onChange(changeJump(jumps, index, { to: target }));
                      }}
                    />
                  </>
                }
              />
            </SettingsStack>
          );
        })}
        {/* Where everyone else goes, always said (T41: a visible Otherwise). */}
        <Sentence lead="">{strings.otherwiseLine(nextName ?? strings.theEnd)}</Sentence>
        {onAddRule !== undefined && (
          <span>
            <Button variant="ghost" size="sm" icon="plus" onPress={onAddRule}>
              {strings.addRule}
            </Button>
          </span>
        )}
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
  readonly onAddRule?: (() => void) | undefined;
  /** What is wrong with the step's logic, and with each of its rules (T41). */
  readonly warnings: readonly string[];
  readonly jumpWarnings: (index: number) => readonly string[];
  /** `head`: its Show only if and warnings, under its header; `after`: its rules, under its last question. */
  readonly part: 'head' | 'after';
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
  onAddRule,
  warnings,
  jumpWarnings,
  part,
}: StepEditorProps) {
  const key = `step:${step.id}`;
  if (part === 'after') {
    return (
      <JumpRules
        keyBase={`step:${step.id}`}
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
        onAddRule={onAddRule}
        warnings={jumpWarnings}
      />
    );
  }
  return (
    <>
      {warnings.map((warning) => (
        <Callout key={warning} tone="warning">
          {warning}
        </Callout>
      ))}
      {/* A refusal is about the step (empty, or its Show when): said over its logic. */}
      {problem !== undefined && <Callout tone="danger">{problem}</Callout>}
      {step.showWhen !== undefined && (
        <ShowWhenRules
          showWhen={step.showWhen}
          earlier={earlier}
          readsLaterText={strings.stepReadsLater}
          otherwise={strings.otherwiseSkipStep}
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
