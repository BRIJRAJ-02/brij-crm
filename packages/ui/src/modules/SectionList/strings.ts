/** SectionList's built in copy. */
export const strings = {
  /** A titled section's grip: "Move the Sales section". */
  move: (title: string) => `Move the ${title} section`,
  /** An untitled section's grip, by its place: "Move section 2". */
  moveNumbered: (position: number) => `Move section ${String(position)}`,
  /** An untitled section in what a move says, by its place: "Section 2". */
  numbered: (position: number) => `Section ${String(position)}`,
} as const;
