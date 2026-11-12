/** AIAssist's built in copy. */
export const strings = {
  /** The scrolling conversation's name for screen readers. */
  conversation: 'Conversation',
  /** The start headline, before the first question. */
  startTitle: (context: string) => `What do you want to know about ${context}?`,
  suggestions: 'Suggested questions',
  /** The status line's default steps while it works. */
  thinkingSteps: ['Reading the timeline', 'Checking notes and emails', 'Writing the answer'],
  /** Said once to screen readers while it works: the steps themselves change too often to read out. */
  thinking: 'Working on an answer',
  question: 'Ask a question',
  placeholder: (context: string) => `Ask about ${context}…`,
  /** Under the prompt: how to ask, and how to write more than one line. */
  hint: 'Enter to ask, Shift+Enter for a new line',
  /** Before the question, for screen readers: whose words they are. */
  youAsked: 'You asked:',
  /** Said once the whole answer is in. */
  answerReady: 'Answer ready',
  /** The row under an answer: Copy, Save as note, New question. */
  answerActions: 'Answer',
  ask: 'Ask',
  stop: 'Stop',
  stopped: 'Stopped.',
  newQuestion: 'New question',
  copy: 'Copy',
  copied: 'Answer copied',
  saveNote: 'Save as note',
  /** The answer that didn't come: a refusal, a dropped connection, or nothing at all. */
  failed: 'Couldn’t get an answer. Try again.',
  tryAgain: 'Try again',
} as const;
