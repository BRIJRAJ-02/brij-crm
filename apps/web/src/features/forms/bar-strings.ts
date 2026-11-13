// The form editor's publish bar words (spec 0074, AC-7407): apart from `strings.ts`, which the first load carries
// (the refusal words), so the bar's words load with the editor and never with the app's first paint.

/** The publish bar's words on a form. */
export const barStrings = {
  /** Changes: one sentence per change. */
  questionAdded: (label: string) => `Question added: ${label}`,
  questionChanged: (label: string) => `Question changed: ${label}`,
  questionRemoved: (label: string) => `Question removed: ${label}`,
  questionsOrder: 'Questions reordered',
  part: (part: string) => `${part} changed`,
  parts: {
    headline: 'Headline',
    subheading: 'Subheading',
    buttonText: 'Button text',
    layout: 'Layout',
    steps: 'Steps',
    endings: 'Endings',
    after: 'After they send',
    look: 'Look',
    language: 'Language',
    targets: 'Where answers go',
    score: 'Score',
    routing: 'Routing',
    confirmation: 'Confirmation email',
    saveProgress: 'Save progress',
    closing: 'Closing',
    spam: 'Spam protection',
    settings: 'Settings',
  },
  /** Before the first publish, in place of a count. */
  notPublished: 'Not published yet',
  live: 'Live: visitors can send this form',
  paused: 'Paused: visitors can’t send this form',
} as const;
