/** AttributeList's built in copy. */
export const strings = {
  /** An empty value that can be set: "Set Stage…". */
  set: (name: string) => `Set ${name}…`,
  /** The pencil button's name: "Edit Stage". */
  edit: (name: string) => `Edit ${name}`,
  loading: 'Loading details',
  /** A read only value with nothing in it: said quietly, in words. */
  notSet: 'Not set',
} as const;
