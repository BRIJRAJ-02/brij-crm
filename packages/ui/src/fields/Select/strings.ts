import { inSentence } from '../../molecules/Field/strings.ts';

/** The select field's built in copy. */
export const strings = {
  /** An option id the attribute's list doesn't hold yet (options are archived, never deleted): one just made elsewhere. */
  unknown: 'Updating…',
  choose: (name: string) => `Set ${inSentence(name)}…`,
  search: (name: string) => `Search ${name}`,
  clear: 'Clear',
  /** The last item when what is typed is no option yet (spec 0012, AC-238). */
  create: (label: string) => `Create "${label}"`,
} as const;
