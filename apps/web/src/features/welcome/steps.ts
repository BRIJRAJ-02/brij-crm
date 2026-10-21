// First run's steps and its address (spec 0036): which step shows, the
// workspace once it is made, and what a calendar connect came back with.
// Pure, so the rules are tested on their own. The route's search reads it, so
// it stays in the first load: no screen code, no copy.
import { SLUG_RULE } from './names.ts';

/** What a calendar connect comes back with in `?calendar=` (the API's `ConnectResult`). */
export type ConnectResult = 'connected' | 'denied' | 'scope' | 'limit' | 'off' | 'failed';

const CONNECT_RESULTS: readonly string[] = ['connected', 'denied', 'scope', 'limit', 'off', 'failed'];

/** True when `value` is one of the results a connect comes back with. */
export function isConnectResult(value: unknown): value is ConnectResult {
  return typeof value === 'string' && CONNECT_RESULTS.includes(value);
}

/**
 * First run's steps, in order: Your name (`about`), About you (`details`),
 * Your workspace, Invite your team, Connect your calendar.
 */
export type WelcomeStep = 'about' | 'details' | 'workspace' | 'invite' | 'calendar';

const STEPS: readonly WelcomeStep[] = ['about', 'details', 'workspace', 'invite', 'calendar'];

/** The steps that come once the workspace exists. */
const AFTER_WORKSPACE: readonly WelcomeStep[] = ['invite', 'calendar'];

/**
 * The steps this deployment shows: Connect your calendar only where calendar
 * sync is set up (AC-1204). Another workspace (spec 0031) starts at Your
 * workspace, so the steps about the person are left out of its count.
 */
export function welcomeSteps(calendarSync: boolean, another = false): readonly WelcomeStep[] {
  return STEPS.filter(
    (step) => (calendarSync || step !== 'calendar') && (!another || (step !== 'about' && step !== 'details')),
  );
}

/**
 * The step Back returns to, or undefined: the first step has none, and once
 * the workspace exists the steps before it are done (AC-1209).
 */
export function previousStep(step: WelcomeStep): WelcomeStep | undefined {
  return step === 'workspace' ? 'details' : step === 'details' ? 'about' : undefined;
}

/** The step after `step` in `steps`, or undefined after the last. */
export function nextStep(steps: readonly WelcomeStep[], step: WelcomeStep): WelcomeStep | undefined {
  const index = steps.indexOf(step);
  return index === -1 ? undefined : steps[index + 1];
}

/**
 * First run's search: the step, the workspace once it is made (the calendar
 * step needs it), and what a calendar connect came back with (`?calendar=`).
 */
export interface WelcomeSearch {
  readonly step?: WelcomeStep;
  readonly workspace?: string;
  readonly calendar?: ConnectResult;
  /** `?another=1`: the workspace menu's Create workspace (spec 0031, AC-801), for someone who already has one. */
  readonly another?: true;
}

/** The search as given, keeping only values first run knows: a step name, an address, a connect result. */
export function welcomeSearch(search: Record<string, unknown>): WelcomeSearch {
  const { step, workspace, calendar, another } = search;
  return {
    ...(typeof step === 'string' && (STEPS as readonly string[]).includes(step) ? { step: step as WelcomeStep } : {}),
    ...(typeof workspace === 'string' && SLUG_RULE.test(workspace) ? { workspace } : {}),
    ...(isConnectResult(calendar) ? { calendar } : {}),
    ...(another === 1 || another === '1' || another === true ? { another: true as const } : {}),
  };
}

/**
 * The step to show: once the workspace is made, Invite your team or the
 * calendar step (the only steps after it); before, the step asked for, never
 * one that needs the workspace; Your name when none is asked for.
 */
export function shownStep(asked: WelcomeStep | undefined, hasWorkspace: boolean, another = false): WelcomeStep {
  if (hasWorkspace) return asked === 'calendar' ? 'calendar' : 'invite';
  // Another workspace (spec 0031): the person is known already, so it starts at Your workspace.
  if (another) return 'workspace';
  return asked === undefined || AFTER_WORKSPACE.includes(asked) ? 'about' : asked;
}

/** Where `/welcome` goes for a signed in person: first run's steps (with the workspace just made), or a workspace. */
export type WelcomeLanding<W> =
  { readonly kind: 'steps'; readonly workspace: W | undefined } | { readonly kind: 'open'; readonly slug: string };

/**
 * Where `/welcome` goes: the calendar step for `asked` only when it is one of
 * the person's own workspaces and calendar sync is on; else, for someone with
 * a workspace, that workspace (or their first); else the steps from the
 * start. A workspace that isn't theirs is passed over, never shown. `home`
 * is the one to open (spec 0031: the last opened, else the oldest), and
 * `another` keeps the steps open for someone making another workspace.
 */
export function welcomeLanding<W extends { readonly slug: string }>(
  workspaces: readonly W[],
  asked: string | undefined,
  home: W | undefined = workspaces[0],
  another = false,
): WelcomeLanding<W> {
  const made = asked === undefined ? undefined : workspaces.find((each) => each.slug === asked);
  // Invite your team always follows the workspace, so the one just made keeps the steps open.
  if (made !== undefined) return { kind: 'steps', workspace: made };
  if (another) return { kind: 'steps', workspace: undefined };
  return home === undefined ? { kind: 'steps', workspace: undefined } : { kind: 'open', slug: home.slug };
}
