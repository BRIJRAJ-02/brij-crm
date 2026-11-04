// Every word the question editor shows (spec 0023, 0023-experience.md, Questions; spec 0057), in one place: a form's
// builder and a booking page's editor draw the same section. Where the two say something different (what an
// unfiled answer is kept with), each has its own line.
import type { AnswerType, ConsentPurpose } from '@crm/data';

export const strings = {
  questions: 'Questions',
  addQuestion: 'Add a question',
  questionMenu: 'More question actions',
  addFromPresets: 'Add from presets',
  closeAll: 'Close all questions',
  /** Add a question's tooltip at the most the list holds: "A form holds at most 30 questions." */
  tooManyQuestions: (holder: string, max: number) => `${holder} holds at most ${String(max)} questions.`,
  formHolder: 'A form',
  pageHolder: 'A booking page',
  question: 'Question',
  questionPlaceholder: 'What do you want to ask?',
  /** A Consent question's label: the exact words beside its tick box (spec 0023, AC-1053). */
  consentWording: 'Wording',
  consentWordingHint: 'Shown beside the tick box, word for word, and kept with each answer.',
  consentPlaceholder: 'I agree to get emails from you.',
  consentPurpose: 'For',
  /** A consent's card line: where its answer goes instead of a field. */
  consentKept: 'Kept as consent',
  consentPurposes: { marketing_email: 'Marketing emails', terms: 'Terms and privacy' } satisfies Record<
    ConsentPurpose,
    string
  >,
  untitledQuestion: 'Untitled question',
  answerType: 'Answer type',
  choices: 'Choices',
  placeholder: 'Placeholder',
  placeholderHint: 'Shown until they type',
  whereItGoes: 'Save answer to',
  /** Where it goes' InfoTip on a question. */
  whereItGoesHelp: 'The record field this answer fills in.',
  whereItGoesExample: 'Point a Job title question at Job title, and each person who answers gets it on their record.',
  notFiled: 'Kept with the submission only',
  notFiledShort: 'Not saved',
  willCreate: (title: string, objectName: string) => `Creates “${title}” on ${objectName}`,
  willCreateShort: (title: string) => `Creates “${title}”`,
  /** The Create choice before the question has words to name its field by. */
  willCreateUnnamed: (objectName: string) => `Creates a field on ${objectName} from this question`,
  cantCreate: 'You can’t add fields, so this stays with the submission.',
  /** Save couldn't make some planned attributes: those questions stay unfiled. */
  notCreated: (titles: readonly string[], objectName: string, keptWith: 'booking' | 'submission' = 'booking') =>
    titles.length === 1
      ? `Couldn’t add “${titles[0] ?? ''}” to ${objectName}, so its answers stay with the ${keptWith}.`
      : `Couldn’t add ${String(titles.length)} fields to ${objectName}, so their answers stay with the ${keptWith}.`,
  undoFailed: 'Couldn’t undo that. The answers still save to those fields.',
  createdAttributes: (count: number, objectName: string) =>
    count === 1 ? `Added 1 field to ${objectName}.` : `Added ${String(count)} fields to ${objectName}.`,
  takenBy: (label: string) => `Used by “${label}”; choosing it moves it here`,
  cantWrite: 'You can’t write to this',
  mustAnswer: 'Visitors must answer',
  /** The question card's footer switch (critique c: one word everywhere). */
  required: 'Required',
  /** The type menu at the start of an open question's head. */
  typeMenu: (type: string) => `${type}, answer type`,
  /** The groups the type menu lists (critique c: a short, grouped list, picked first). */
  typeGroups: {
    text: 'Text',
    choice: 'Choices and scores',
    time: 'Dates and places',
    more: 'More',
    presets: 'Ready-made',
  },
  /** The placeholder, edited in place under the question, quiet. */
  placeholderInline: 'Placeholder text (optional)',
  /** An open question's one ⋯. */
  questionActions: (name: string) => `More for ${name}`,
  keepWithAnswer: 'Keep with the answer',
  keepWithBooking: 'Keep with the booking',
  newField: (title: string, objectName: string) => `New field on ${objectName}: ${title}`,
  newFieldUnnamed: (objectName: string) => `New field on ${objectName}`,
  insightsSource: 'Use in Insights as “How did you hear about us”',
  /** One Choice type (critique c): its two ways to show, as switches. */
  pickMore: 'Let people pick more than one',
  asDropdown: 'Show as a dropdown',
  lockedQuestion: 'This question stays',
  // Spec 0067: its answers show beside Insights' sources.
  sourceQuestion: 'Use as “How did you hear about us” in Insights',
  duplicateQuestion: 'Duplicate',
  deleteQuestion: 'Delete',
  questionDeleted: (label: string) => `Deleted “${label}”.`,
  questionDeletedFiled: (label: string, filed: string) => `Deleted “${label}”. Its answers went to ${filed}.`,
  undo: 'Undo',
  filedLine: (objectName: string, title: string) => `${objectName} › ${title}`,
  goneAttribute: 'A field that no longer exists',
  // The new answer types' options (spec 0063)
  dateRange: 'Days offered',
  earliest: 'Earliest day',
  latest: 'Latest day',
  scaleRange: 'From and to',
  scaleFrom: 'Scale starts at',
  scaleTo: 'Scale ends at',
  lowLabel: 'Low end',
  lowLabelPlaceholder: 'Not likely',
  highLabel: 'High end',
  highLabelPlaceholder: 'Very likely',
  picks: 'Picks',
  leastPicks: 'Least picks',
  mostPicks: 'Most picks',
  anyPicks: 'Any',
  offerOther: 'Offer Other, with a box to type in',
  hiddenDefault: 'Value when the link has none',
  /** A hidden question's name (critique c): only you see it. */
  hiddenPlaceholder: 'Name it, for example Source',
  hiddenKey: 'Add to the link',
  copyKey: 'Copy',
  hiddenDefaultHint: (key: string) => `Visitors never see it. Add ?${key}=… to the link to set it.`,
  // A form's steps as pages (spec 0063; T20, 5 November 2026: Tally's page breaks)
  /** Between two questions of one step, on hover or focus: one click starts a new step there. */
  splitHere: 'Split here',
  /** The gap's +, between two questions of one step: a new step starts at the question below. */
  startStepHere: 'Start a new step here',
  /** The gap's + (T39): always there, quiet. */
  addHere: 'Add a question here',
  addHereOrStep: 'Add a question or a step here',
  /** The Questions header with Steps (T39): a new step at the end, with a question in it. */
  addStep: 'Add a step',
  /** A step header's count. */
  questionCount: (count: number) => (count === 1 ? '1 question' : `${String(count)} questions`),
  /** The first page's title when Steps splits a form after its contact details. */
  yourDetails: 'Your details',
  /** The second page's title when the first is the contact details. */
  aboutYou: 'About you',
  /** A step header's ⋯ menu. */
  stepMenu: (name: string) => `${name} options`,
  renameStep: 'Rename',
  renameStepNamed: (name: string) => `Rename ${name}`,
  /** Joins a step's questions to the step above it (the break goes). */
  mergeUp: 'Merge with the step above',
  stepMerged: (name: string) => `Merged ${name} into the step above.`,
  /** A divider's name: its step's place ("New step" while empty), then its title when it has one ("Step 2 · Your company"). */
  stepName: (number: number, title?: string) => {
    // A divider with nothing under it yet is no step a visitor counts.
    const place = number === 0 ? 'New step' : `Step ${String(number)}`;
    return title === undefined || title.trim() === '' ? place : `${place} · ${title.trim()}`;
  },
  separator: ' · ',
  stepTitle: 'Step title',
  stepTitlePlaceholder: 'About your company',
  // Logic, in the words Tally and Typeform use (T5, T15, 4 November 2026): one way to say "show this only if", one
  // way to say "after this, jump to".
  /** The quiet heading over a step's jumps. */
  logic: 'After this step',
  /** The rules row's name, under a step's last question. */
  afterStep: (step: string) => `After ${step}`,
  /** A rule's arrow, between its conditions and where it sends people. */
  thenArrow: '→',
  pickWhere: 'Pick where',
  /** The Otherwise lines (T41): where everyone else goes, always said. */
  otherwiseLine: (where: string) => `Otherwise → ${where}`,
  otherwiseSkipQuestion: 'Otherwise → this question is skipped',
  otherwiseSkipStep: 'Otherwise → this step is skipped',
  /** One more rule under a step's rules. */
  addRule: 'Add a rule',
  /** One click: a ready rule, If <first question> is <first option>, jump to <next step>. */
  addLogic: 'Add logic',
  /** One click: a ready condition, on the first earlier question. */
  showOnlyIf: 'Show only if…',
  /** The heading over a Show when's conditions. */
  showOnlyIfTitle: 'Show only if',
  /** Takes the Show when away. */
  alwaysShow: 'Always show',
  /** Where a step goes when no jump matched (or when it has none): the next step, or the end of the form. */
  otherwiseGoTo: (where: string) => `Otherwise, go to ${where}`,
  /** The end of the form as a place to go: the thank you. */
  theEnd: 'After they send',
  /** A new ending Add logic made, when there was nowhere further down to jump to. */
  newEndingHeading: 'Thanks for your answers',
  stepShowWhenHint: 'Show this step only when earlier answers match. Its answers are not kept when it is skipped.',
  stepNoEarlier: 'Add a question before this step to show it by an answer.',
  stepReadsLater: 'A condition reads a question that is no longer before this step. Pick another, or remove it.',
  // Points (spec 0063, AC-6316; T20: Typeform's score, offered on the question, never a Settings card)
  /** One click on a question that can score: sensible points appear, and the form gets a score. */
  givePoints: 'Give points',
  /** Takes a question's points away. */
  stopPoints: 'No points',
  answerTypes: {
    short_text: 'Short text',
    long_text: 'Long text',
    email: 'Email',
    phone: 'Phone',
    website: 'Website',
    number: 'Number',
    dropdown: 'Dropdown',
    choice: 'Choice',
    checkbox: 'Checkbox',
    yes_no: 'Yes or no',
    country: 'Country',
    file: 'File',
    date: 'Date',
    time: 'Time',
    datetime: 'Date and time',
    rating: 'Rating',
    scale: 'Scale',
    multi_select: 'Multi select',
    address: 'Address',
    hidden: 'Hidden',
    signature: 'Signature',
    ranking: 'Ranking',
    consent: 'Consent',
  } satisfies Record<AnswerType, string>,

  // An answer as a panel shows it
  /** Names an answer's copy button. */
  copyAnswer: (label: string) => `Copy ${label}`,
  /** An answer left empty. */
  noAnswer: 'No answer',
  yes: 'Yes',
  no: 'No',
  /** Marks a booking's answers the person record didn't take (spec 0057, AC-5712). */
  notSavedMark: 'Not saved',
  notFiledBooking: 'Kept with the booking only',
  whereItGoesHelpBooking: 'The booker’s field this answer fills in.',
  cantCreateBooking: 'You can’t add fields, so this stays with the booking.',
  offCrm: 'Turn on Add to the CRM to save answers on the person.',

  // Jumps and points (spec 0063, AC-6313, AC-6316, AC-6325)
  jumps: 'Jumps',
  jumpsHint: 'Go further down when answers match. First match wins.',
  addJump: 'Add a jump',
  removeJump: (place: number) => `Remove jump ${String(place)}`,
  jumpsNowhere: 'Add a step below this one to jump to.',
  jumpTo: 'Jump to',
  /** One jump among a step's, in the order they are tried. */
  jumpNumber: (place: number) => `Jump ${String(place)}`,
  /** A step as a jump's target, after "Jump to": "Step 3", or "Step 3 · Your team". */
  jumpToStep: (place: number, title: string | undefined) =>
    title === undefined || title.trim() === '' ? `Step ${String(place)}` : `Step ${String(place)} · ${title.trim()}`,
  /** An ending as a jump's target: its heading, or its place while it has none. */
  jumpToEnding: (place: number, heading: string) =>
    heading.trim() === '' ? `Thank-you message ${String(place)}` : `Thank-you message: ${heading.trim()}`,
  jumpGone: 'This jump no longer points to a step below this one. Choose where it goes.',
  jumpsFull: (most: number) => `A step holds ${String(most)} jumps.`,
  jumpsNoAnswers: 'This step has no answers to jump on yet.',
  points: 'Points',
  pointsNoChoices: 'Add a choice to score it.',
  pointsFor: (choice: string) => `Points for ${choice}`,
  pointsYes: 'Points for Yes',
  pointsNo: 'Points for No',
  pointsOff: 'No points',
  pointsValue: 'The answer itself',
  pointsScale: 'What it scores',
} as const;
