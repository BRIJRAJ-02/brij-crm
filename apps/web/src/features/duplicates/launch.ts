// The one place a Merge button reaches the merge dialog (spec 0049, AC-4910).
// TODO(wip/merge-core): the merge dialog lands in
// `apps/web/src/features/duplicates/merge/` with spec 0049 task 4; that lane
// sets `merge.launch` here to open it. Until then it is absent, and every
// Merge button (the hint, the record banner, the Duplicates page) stays hidden.

/** What a Merge button hands the dialog: the workspace, the object, and the two records. */
export interface MergeRequest {
  readonly slug: string;
  readonly objectId: string;
  /** The two records of the pair; the dialog preselects the newer as the one merged away. */
  readonly recordIds: readonly [string, string];
  /** Runs once the merge landed, so the screen can drop the pair. */
  readonly onMerged?: () => void;
}

/** Opens the merge dialog for a pair. */
export type MergeLauncher = (request: MergeRequest) => void;

/** The merge dialog's launcher, once wip/merge-core plugs it in; absent, every Merge button stays hidden. */
export const merge: { readonly launch?: MergeLauncher } = Object.freeze({});

/** The launcher a reader with this access to the object may use (AC-4909, AC-4919): write, and a dialog to open. */
export const mergeFor = (access: string): MergeLauncher | undefined => (access === 'write' ? merge.launch : undefined);
