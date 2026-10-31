import { inSentence } from '../../molecules/Field/strings.ts';

/** The status field's built in copy. */
export const strings = {
  choose: (name: string) => `Set ${inSentence(name)}…`,
  search: (name: string) => `Search ${name}`,
} as const;
