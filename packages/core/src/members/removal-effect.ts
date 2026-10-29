// The shape of a removal effect (spec 0031, AC-814; spec 0037, AC-1440): what
// one feature does with a member's rows when they are removed or leave, inside
// the removal's own transaction, and what it will do, counted beforehand for
// the remove dialog. Each feature owns its effect, beside its own tables; the
// members module only runs them in order (`removal.ts`).
import type { WorkspaceTx } from '@crm/db';
import type { WriteContext } from '../engine/write.ts';

/** What a removal will do, as the remove dialog lists it (AC-816). */
export interface RemovalCounts {
  /** Booking pages that will pause, nobody being left to host them. */
  readonly pausedPages: number;
  /** Calendar connections that will be disconnected, their tokens revoked. */
  readonly calendars: number;
  /** Open tasks assigned to them. */
  readonly openTasks: number;
  /** Live records whose member typed values name them (an Owner, an Account manager). */
  readonly records: number;
  /** Fields whose default names them, which stop naming them (late trap #70). */
  readonly defaults: number;
  /** Of those, required ones left with no default: every new record then needs a value for them. */
  readonly requiredDefaults: number;
}

/** One feature's part of a removal. */
export interface RemovalEffect {
  /** The feature, for logs and the guard test. */
  readonly feature: string;
  /**
   * The foreign keys to `members` this effect looks after, by constraint
   * name: the guard test fails on any other one that isn't kept on purpose.
   */
  readonly constraints: readonly string[];
  /** Its counts for the remove dialog, read inside the workspace with no lock. */
  readonly count?: (tx: WorkspaceTx, workspaceId: string, memberId: string) => Promise<Partial<RemovalCounts>>;
  /** Its change, inside the removal's transaction, after the member row is marked removed; none when it only counts. */
  readonly run?: (context: WriteContext, memberId: string) => Promise<void>;
}
