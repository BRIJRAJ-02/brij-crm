/** AIAssist's built in copy. */
export const strings = {
  /** The panel's heading and name. */
  title: 'Ask AI',
  about: (context: string) => `about ${context}`,
  /** The start headline, before the first question. */
  startTitle: (context: string) => `What do you want to know about ${context}?`,
  suggestions: 'Suggested questions',
  /** The status line's default steps while it works. */
  thinkingSteps: ['Reading the timeline', 'Checking notes and emails', 'Writing the answer'],
  /** Said once to screen readers while it works: the steps themselves change too often to read out. */
  thinking: 'Working on an answer',
  question: 'Ask a question',
  placeholder: (context: string) => `Ask about ${context}…`,
  /** The keycap and its words beside Ask. */
  enterKey: '↵',
  toAsk: 'to ask',
  ask: 'Ask',
  stop: 'Stop',
  stopped: 'Stopped.',
  newQuestion: 'New question',
  close: 'Close',
  copy: 'Copy',
  copied: 'Answer copied',
  saveNote: 'Save as note',
  /** The answer that didn't come: a refusal, a dropped connection, or nothing at all. */
  failed: 'Couldn’t get an answer. Try again.',
  tryAgain: 'Try again',
} as const;
