/** InviteRows' built in copy. */
export const strings = {
  /** The email column's name, above the rows. */
  email: 'Email',
  /** A row's email, for screen readers: "Email 2". */
  emailFor: (row: number) => (row === 1 ? 'Email' : `Email ${String(row)}`),
  /** The role column's name, above the rows. */
  role: 'Role',
  /** A row's role, for screen readers: "Role for ada@acme.com". */
  roleFor: (what: string) => `Role for ${what}`,
  /** A row with nothing typed yet, in a control's name: "row 2". */
  rowName: (row: number) => `row ${String(row)}`,
  /** A row's remove button: "Remove ada@acme.com". */
  removeRow: (what: string) => `Remove ${what}`,
  /** The plus button under the rows. */
  addAnother: 'Add another',
  /** Its fuller name, starting with what it shows. */
  addAnotherName: 'Add another person',
  placeholder: 'name@company.com',
} as const;
