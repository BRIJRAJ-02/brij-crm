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

/** First run's steps, in order. "Invite your team" joins after spec 0031 slice 2. */
export type WelcomeStep = 'about' | 'workspace' | 'calendar';

const STEPS: readonly WelcomeStep[] = ['about', 'workspace', 'calendar'];

/** The steps this deployment shows: Connect your calendar only where calendar sync is set up (AC-1204). */
export function welcomeSteps(calendarSync: boolean): readonly WelcomeStep[] {
  return calendarSync ? STEPS : STEPS.filter((step) => step !== 'calendar');
}

/**
 * The step Back returns to, or undefined: the first step has none, and once
 * the workspace exists the steps before it are done (AC-1209).
 */
export function previousStep(step: WelcomeStep): WelcomeStep | undefined {
  return step === 'workspace' ? 'about' : undefined;
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
 * The step to show: the calendar step once the workspace is made (it is the
 * only step after it), else the step asked for, never the calendar step
 * without a workspace; About you when none is asked for.
 */
export function shownStep(asked: WelcomeStep | undefined, hasWorkspace: boolean, another = false): WelcomeStep {
  if (hasWorkspace) return 'calendar';
  // Another workspace (spec 0031): the person is known already, so it starts at Your workspace.
  if (another) return 'workspace';
  return asked === undefined || asked === 'calendar' ? 'about' : asked;
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
  calendarSync: boolean,
  home: W | undefined = workspaces[0],
  another = false,
): WelcomeLanding<W> {
  const made = asked === undefined ? undefined : workspaces.find((each) => each.slug === asked);
  if (made !== undefined && calendarSync) return { kind: 'steps', workspace: made };
  if (made === undefined && another) return { kind: 'steps', workspace: undefined };
  const opened = made ?? home;
  return opened === undefined ? { kind: 'steps', workspace: undefined } : { kind: 'open', slug: opened.slug };
}
