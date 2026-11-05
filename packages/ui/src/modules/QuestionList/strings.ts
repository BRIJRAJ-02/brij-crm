/** QuestionList's built in copy. */
export const strings = {
  untitled: 'Untitled question',
  required: 'Required',
  choices: (count: number) => (count === 1 ? '1 choice' : `${String(count)} choices`),
  noChoices: 'No choices yet',
  move: (name: string) => `Move ${name}`,
  close: (name: string) => `Close ${name}`,
  moved: (name: string, position: number, total: number) =>
    `${name}, moved to position ${String(position)} of ${String(total)}`,
  hasProblem: 'Needs a fix',
  /** A fixed question's lock, and the list of them: asked of everyone, never changed here. */
  alwaysAsked: 'Always asked',
  /** Between the parts of a row's second line: "Dropdown · 3 choices · Person › Size". */
  separator: ' · ',
} as const;
