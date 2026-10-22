import { createContext } from 'react';

/**
 * True inside a part whose rows are inset by space-8 with a 16px control first (a TaskList's footer, where a
 * record's Completed fold sits under the task rows). A quiet Disclosure there puts its chevron on the rows'
 * checkboxes and its words on their titles, and keeps its hover pill inside the part, which may scroll and clip.
 */
export const RowInset = createContext(false);
