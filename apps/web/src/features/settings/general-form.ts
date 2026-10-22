// Settings › Workspace › General's text fields as one form: what Save would
// send, so Save shows only while something changed, and whether the change
// moves the workspace's address (which asks first). Pure, tested on its own.

/** The saved values the fields start from. */
export interface GeneralSaved {
  readonly name: string;
  readonly slug: string;
}

/** What Save sends: only the fields that differ from the saved ones. */
export interface GeneralChange {
  readonly name?: string;
  readonly slug?: string;
}

/** The change the drafts make: the name trimmed, each field left out while it matches what is saved. */
export function generalChange(saved: GeneralSaved, name: string, slug: string): GeneralChange {
  const trimmed = name.trim();
  return {
    ...(trimmed === saved.name ? {} : { name: trimmed }),
    ...(slug === saved.slug ? {} : { slug }),
  };
}

/** True when Save has something to send. */
export function isChanged(change: GeneralChange): boolean {
  return change.name !== undefined || change.slug !== undefined;
}
