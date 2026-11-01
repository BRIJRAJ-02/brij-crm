/** Sample data's copy: one button, and what it says as it goes. */
export const strings = {
  add: 'Add sample data',
  remove: 'Remove sample data',
  /** Settings › General's row. */
  title: 'Sample data',
  /** The row's InfoTip: what it adds, in one line. */
  info: 'A few companies, people and deals with notes and tasks, and a sales pipeline.',
  adding: 'Adding sample data…',
  added: 'Sample data added',
  removed: (records: number) =>
    records === 1 ? 'Removed 1 sample record' : `Removed ${String(records)} sample records`,
  restored: 'Sample data back',
  undo: 'Undo',
} as const;
