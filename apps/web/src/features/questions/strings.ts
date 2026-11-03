// Every word the question editor shows (spec 0023, 0023-experience.md, Questions; spec 0057), in one place: a form's
// builder and a booking page's editor draw the same section. Where the two say something different (what an
// unfiled answer is kept with), each has its own line.
import type { AnswerType } from '@crm/data';

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
  consentPlaceholder: 'I agree to get emails from Acme.',
  consentPurpose: 'For',
  /** A consent's card line: where its answer goes instead of a field. */
  consentKept: 'Kept as consent',
  consentPurposes: { marketing_email: 'Marketing emails', terms: 'Terms and privacy' },
  untitledQuestion: 'Untitled question',
  answerType: 'Answer type',
  choices: 'Choices',
  placeholder: 'Placeholder',
  placeholderHint: 'Shown until they type',
  whereItGoes: 'Where it goes',
  /** Where it goes' InfoTip on a question. */
  whereItGoesHelp: 'The record field this answer fills in.',
  whereItGoesExample: 'Point a Job title question at Job title, and each person who answers gets it on their record.',
  notFiled: 'Not filed, kept with the submission',
  notFiledShort: 'Not filed',
  willCreate: (title: string, objectName: string) => `Creates “${title}” on ${objectName}`,
  willCreateShort: (title: string) => `Creates “${title}”`,
  /** The Create choice before the question has words to name its field by. */
  willCreateUnnamed: (objectName: string) => `Creates a field on ${objectName} from this question`,
  cantCreate: 'You can’t add attributes, so this stays with the submission.',
  /** Save couldn't make some planned attributes: those questions stay unfiled. */
  notCreated: (titles: readonly string[], objectName: string, keptWith: 'booking' | 'submission' = 'booking') =>
    titles.length === 1
      ? `Couldn’t add “${titles[0] ?? ''}” to ${objectName}, so its answers stay with the ${keptWith}.`
      : `Couldn’t add ${String(titles.length)} attributes to ${objectName}, so their answers stay with the ${keptWith}.`,
  undoFailed: 'Couldn’t undo that. The questions are still filed.',
  createdAttributes: (count: number, objectName: string) =>
    count === 1 ? `Added 1 attribute to ${objectName}.` : `Added ${String(count)} attributes to ${objectName}.`,
  takenBy: (label: string) => `Used by “${label}”; choosing it moves it here`,
  cantWrite: 'You can’t write to this',
  mustAnswer: 'Visitors must answer',
  duplicateQuestion: 'Duplicate',
  deleteQuestion: 'Delete',
  questionDeleted: (label: string) => `Deleted “${label}”.`,
  questionDeletedFiled: (label: string, filed: string) => `Deleted “${label}”. Its answers went to ${filed}.`,
  undo: 'Undo',
  filedLine: (objectName: string, title: string) => `${objectName} › ${title}`,
  goneAttribute: 'An attribute that no longer exists',
  // The new answer types' options (spec 0063)
  dateRange: 'Days offered',
  dateRangeHint: 'Leave either empty for no limit.',
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
  picksHint: 'The least and the most a visitor may pick.',
  leastPicks: 'Least picks',
  mostPicks: 'Most picks',
  anyPicks: 'Any',
  offerOther: 'Offer Other, with a box to type in',
  hiddenDefault: 'Value when the link has none',
  hiddenDefaultHint: (key: string) => `Visitors never see it. Add ?${key}=… to the link to set it.`,
  // A form's New step dividers (spec 0063)
  addStep: 'Add a step',
  /** A divider's name: its step's place ("New step" while empty), then its title when it has one ("Step 2 · Your company"). */
  stepName: (number: number, title?: string) => {
    // A divider with nothing under it yet is no step a visitor counts.
    const place = number === 0 ? 'New step' : `Step ${String(number)}`;
    return title === undefined || title.trim() === '' ? place : `${place} · ${title.trim()}`;
  },
  stepHolds: (count: number) =>
    count === 0 ? 'No questions yet' : count === 1 ? '1 question' : `${String(count)} questions`,
  /** On a divider outside the Steps layout: it is kept, and only Steps draws it. */
  stepsOnly: 'Shows with Steps',
  /** Add a step's line in the menu outside the Steps layout. */
  stepsOnlyMenu: 'Visitors see it with Steps',
  separator: ' · ',
  stepTitle: 'Step title',
  stepTitlePlaceholder: 'About your company',
  stepShowWhenHint: 'Show this step only when earlier answers match. Its answers are not kept when it is skipped.',
  stepNoEarlier: 'Add a question before this step to show it by an answer.',
  stepReadsLater: 'A condition reads a question that is no longer before this step. Pick another, or remove it.',
  removeStep: 'Remove step',
  stepRemoved: (name: string) => `Removed ${name}. Its questions joined the step above.`,
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
  notFiledBooking: 'Not filed, kept with the booking',
  whereItGoesHelpBooking: 'The booker’s field this answer fills in.',
  cantCreateBooking: 'You can’t add attributes, so this stays with the booking.',
  offCrm: 'Turn on Add to the CRM to file answers on the person.',

  // Jumps and points (spec 0063, AC-6313, AC-6316, AC-6325)
  jumps: 'Jumps',
  jumpsHint: 'Go further down when answers match. First match wins.',
  addJump: 'Add a jump',
  removeJump: (place: number) => `Remove jump ${String(place)}`,
  jumpsNowhere: 'Add a step below this one, or an ending in Settings, to jump to.',
  jumpTo: 'Then',
  /** One jump among a step's, in the order they are tried. */
  jumpNumber: (place: number) => `Jump ${String(place)}`,
  jumpToStep: (place: number, title: string | undefined) =>
    title === undefined || title.trim() === ''
      ? `Go to step ${String(place)}`
      : `Go to step ${String(place)}, ${title}`,
  jumpToEnding: (place: number, heading: string) =>
    heading.trim() === '' ? `End with ending ${String(place)}` : `End with “${heading.trim()}”`,
  jumpGone: 'This jump no longer points to a step below this one. Choose where it goes.',
  jumpsFull: (most: number) => `A step holds ${String(most)} jumps.`,
  jumpsNoAnswers: 'This step has no answers to jump on yet.',
  points: 'Points',
  pointsHint: 'What each answer adds to the form’s score.',
  pointsNoChoices: 'Add a choice to score it.',
  pointsFor: (choice: string) => `Points for ${choice}`,
  pointsYes: 'Points for Yes',
  pointsNo: 'Points for No',
  pointsOff: 'No points',
  pointsValue: 'The answer itself',
  pointsValueHint: 'A scale of 0 to 10 scores 0 to 10, with nothing to key in.',
  pointsScale: 'What it scores',
} as const;
