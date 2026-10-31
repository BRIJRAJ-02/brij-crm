// Routing's shared layer in the browser (spec 0037, L7): the workspace's skills and who holds them (AC-1382), and its
// routing settings (Won means, AC-1385). Settings, as rotations and editors are: no change event names them, so each
// is read when a screen first holds it and again whenever the person comes back to the page. Every write shows at
// once and is sent; the server's answer becomes the base, and a refusal takes back only that write (the others still
// waiting stay shown), rejecting with the refusal. Nothing is fetched for a read no screen holds.
import type { RoutingSettings, RoutingSkill, SkillGroup, SkillsView, WonStage } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { heldRead, type RoutingHeld } from './log.ts';

/** What the store needs: the procedures, an id minter, and (for tests) the return signal and the clock. */
export interface RoutingSkillsDeps {
  readonly list: (workspace: string) => Promise<SkillsView>;
  readonly create: (
    workspace: string,
    input: { readonly id: string; readonly group: SkillGroup; readonly name: string },
  ) => Promise<SkillsView>;
  readonly update: (
    workspace: string,
    input: { readonly id: string; readonly group?: SkillGroup; readonly name?: string },
  ) => Promise<SkillsView>;
  readonly remove: (workspace: string, id: string) => Promise<SkillsView>;
  readonly setMember: (workspace: string, memberId: string, skillIds: readonly string[]) => Promise<SkillsView>;
  readonly settings: (workspace: string) => Promise<RoutingSettings>;
  readonly setSettings: (
    workspace: string,
    wonStage: WonStage | null,
    updatedAt: string | undefined,
  ) => Promise<RoutingSettings>;
  readonly mintId: () => string;
  readonly onReturn?: (refresh: () => void) => () => void;
  readonly now?: () => number;
}

/** A held read's state: loading, refused on its first read, or ready with what the screen shows. */
export type RoutingSharedState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly value: T };

/** Skills' state. */
export type RoutingSkillsState = RoutingSharedState<SkillsView>;
/** The settings' state. */
export type RoutingSettingsState = RoutingSharedState<RoutingSettings>;

/** One write waiting for its answer: how it changes what is shown. */
interface Pending<T> {
  readonly id: number;
  readonly apply: (value: T) => T;
}

/**
 * A held value with optimistic writes: what is shown is the server's last answer with every waiting write applied
 * over it, in order, so an answer or a read landing under a waiting write never hides it.
 */
function optimistic<T>(read: (workspace: string) => Promise<T>, workspace: string, deps: RoutingSkillsDeps) {
  let base: T | undefined;
  let failed: string | undefined;
  let pending: readonly Pending<T>[] = [];
  let counter = 0;
  const shown = (): RoutingSharedState<T> => {
    if (base === undefined) return failed === undefined ? { status: 'loading' } : { status: 'error', message: failed };
    return { status: 'ready', value: pending.reduce<T>((value, each) => each.apply(value), base) };
  };
  const held = heldRead<RoutingSharedState<T>>(
    { status: 'loading' },
    async (set) => {
      try {
        base = await read(workspace);
        failed = undefined;
      } catch (error) {
        // A failed read again keeps what is shown; only a first read shows the failure.
        if (base === undefined) failed = toDataError(error).message;
      }
      set(shown());
    },
    deps,
  );
  return {
    subscribe: held.subscribe,
    getSnapshot: held.getSnapshot,
    retain: held.retain,
    reload: held.reload,
    isHeld: held.isHeld,
    /** Whatever the screen shows now, before a write: undefined until the first read lands. */
    current: (): T | undefined => {
      const state = shown();
      return state.status === 'ready' ? state.value : undefined;
    },
    /** Shows `apply` at once, sends it, and puts the answer in place; a refusal takes back this write only. */
    write: async (apply: (value: T) => T, send: () => Promise<T>): Promise<T> => {
      counter += 1;
      const mine: Pending<T> = { id: counter, apply };
      pending = [...pending, mine];
      held.set(shown());
      try {
        const answer = await send();
        base = answer;
        failed = undefined;
        return answer;
      } catch (error) {
        throw toDataError(error);
      } finally {
        pending = pending.filter((each) => each.id !== mine.id);
        held.set(shown());
      }
    },
  };
}

/** The skills in Skills' order: by group, then place, then name. */
const GROUP_ORDER: readonly SkillGroup[] = ['language', 'region', 'segment', 'product', 'other'];
function inOrder(skills: readonly RoutingSkill[]): RoutingSkill[] {
  return [...skills].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.position - b.position ||
      a.name.localeCompare(b.name),
  );
}

/** The store: one held skills view and one held settings read per workspace, and their writes. */
export function createRoutingSkills(deps: RoutingSkillsDeps) {
  const skills = new Map<string, ReturnType<typeof optimistic<SkillsView>>>();
  const settings = new Map<string, ReturnType<typeof optimistic<RoutingSettings>>>();
  const skillsOf = (workspace: string) => {
    const found = skills.get(workspace);
    if (found !== undefined) return found;
    const made = optimistic(deps.list, workspace, deps);
    skills.set(workspace, made);
    return made;
  };
  const settingsOf = (workspace: string) => {
    const found = settings.get(workspace);
    if (found !== undefined) return found;
    const made = optimistic(deps.settings, workspace, deps);
    settings.set(workspace, made);
    return made;
  };
  return {
    /** The workspace's skills and who holds them, the same handle for every screen asking it. */
    view: (workspace: string): RoutingHeld<RoutingSkillsState> => skillsOf(workspace),
    /** A new skill at the end of its group, shown at once under the id minted here; answers that id. */
    create: async (workspace: string, group: SkillGroup, name: string): Promise<string> => {
      const id = deps.mintId();
      const held = skillsOf(workspace);
      await held.write(
        (view) => ({
          ...view,
          skills: inOrder([
            ...view.skills,
            {
              id,
              group,
              name,
              position: Math.max(-1, ...view.skills.map((skill) => skill.position)) + 1,
            },
          ]),
        }),
        () => deps.create(workspace, { id, group, name }),
      );
      return id;
    },
    /** A skill renamed or moved to another group. */
    update: async (
      workspace: string,
      id: string,
      change: { readonly group?: SkillGroup; readonly name?: string },
    ): Promise<void> => {
      await skillsOf(workspace).write(
        (view) => ({
          ...view,
          skills: inOrder(view.skills.map((skill) => (skill.id === id ? { ...skill, ...change } : skill))),
        }),
        () => deps.update(workspace, { id, ...change }),
      );
    },
    /** A skill deleted, gone from everyone who held it; `SKILL_IN_USE` puts it back. */
    remove: async (workspace: string, id: string): Promise<void> => {
      await skillsOf(workspace).write(
        (view) => ({
          ...view,
          skills: view.skills.filter((skill) => skill.id !== id),
          members: view.members
            .map((member) => ({ ...member, skillIds: member.skillIds.filter((each) => each !== id) }))
            .filter((member) => member.skillIds.length > 0),
        }),
        () => deps.remove(workspace, id),
      );
    },
    /** One member's skills, replaced. */
    setMember: async (workspace: string, memberId: string, skillIds: readonly string[]): Promise<void> => {
      await skillsOf(workspace).write(
        (view) => ({
          ...view,
          members: [
            ...view.members.filter((member) => member.memberId !== memberId),
            ...(skillIds.length === 0 ? [] : [{ memberId, skillIds: [...skillIds] }]),
          ],
        }),
        () => deps.setMember(workspace, memberId, skillIds),
      );
    },
    /** The workspace's routing settings, held while a screen shows them. */
    settings: (workspace: string): RoutingHeld<RoutingSettingsState> => settingsOf(workspace),
    /**
     * Won means set (or cleared with null), shown at once; sent with the `updatedAt` last read, so a change someone
     * else made meanwhile is refused `STALE` and read again. Skills learn Won means is set from the answer.
     */
    setWonStage: async (workspace: string, wonStage: WonStage | null): Promise<void> => {
      const held = settingsOf(workspace);
      const updatedAt = held.current()?.updatedAt;
      try {
        await held.write(
          (value) => {
            const { wonStage: _, ...rest } = value;
            return wonStage === null ? rest : { ...rest, wonStage };
          },
          () => deps.setSettings(workspace, wonStage, updatedAt),
        );
      } catch (error) {
        const refused = toDataError(error);
        if (refused.code === 'STALE') held.reload();
        throw refused;
      }
      // Skills say whether Won means is set (Known's Customer): read again only while a screen holds them.
      const heldSkills = skillsOf(workspace);
      if (heldSkills.isHeld()) heldSkills.reload();
    },
  };
}

/** The store. */
export type RoutingSkillsStore = ReturnType<typeof createRoutingSkills>;
