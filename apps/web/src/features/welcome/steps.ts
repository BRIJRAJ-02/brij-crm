// First run's steps and its address (spec 0036): which step shows, the
// workspace once it is made, and what a calendar connect came back with.
// Pure, so the rules are tested on their own. The route's search reads it, so
// it stays in the first load: no screen code, no copy.
import { SLUG_RULE } from '../address/address.ts';

/** What a calendar connect comes back with in `?calendar=` (the API's `ConnectResult`). */
export type ConnectResult = 'connected' | 'denied' | 'scope' | 'limit' | 'off' | 'failed';

const CONNECT_RESULTS: readonly string[] = ['connected', 'denied', 'scope', 'limit', 'off', 'failed'];

/** True when `value` is one of the results a connect comes back with. */
export function isConnectResult(value: unknown): value is ConnectResult {
  return typeof value === 'string' && CONNECT_RESULTS.includes(value);
}

/**
 * First run's steps, in order: Your name (`about`), Your workspace, Your
 * booking page (`booking`), Your link page (`handle`), Connect your calendar,
 * Invite your team. The booking page comes first, so the link page it goes on
 * has something on it by the time its owner sees it (the owner, 27 October
 * 2026). (About you, the questionnaire, was taken out on 22 October 2026
 * by the owner, to cut friction; an old `?step=details` link starts at Your
 * name.) Your link and Your booking page were added on 27 October 2026, when
 * the owner asked that first run set the link page and the booking page up
 * rather than let them be skipped: Timefix is a page and a booking page, so
 * first run makes both.
 */
export type WelcomeStep = 'about' | 'workspace' | 'booking' | 'handle' | 'calendar' | 'invite';

const STEPS: readonly WelcomeStep[] = ['about', 'workspace', 'booking', 'handle', 'calendar', 'invite'];

/** The steps that come once the workspace exists. */
const AFTER_WORKSPACE: readonly WelcomeStep[] = ['booking', 'handle', 'calendar', 'invite'];

/** True for a step that only makes sense once the workspace exists. */
export function needsWorkspace(step: WelcomeStep): boolean {
  return AFTER_WORKSPACE.includes(step);
}

/** What the person already has, so first run doesn't ask for it twice. */
export interface WelcomeDone {
  /** They have a booking page already: Your booking page is done. */
  readonly booking?: boolean;
}

/**
 * The steps this deployment shows for this person: Connect your calendar only
 * where calendar sync is set up (AC-1204), and Your booking page only while
 * they have none. Your link is always asked: a handle is made with every
 * membership (26 Oct 2026), so the step is where its owner sees the one they
 * were given and takes it or changes it, rather than finding it later in
 * Settings. Another workspace (spec 0031) starts at Your workspace, so the
 * steps about the person are left out of its count.
 */
export function welcomeSteps(calendarSync: boolean, another = false, done: WelcomeDone = {}): readonly WelcomeStep[] {
  return STEPS.filter((step) => {
    if (step === 'calendar' && !calendarSync) return false;
    if (step === 'about' && another) return false;
    if (step === 'booking' && done.booking === true) return false;
    return true;
  });
}

/**
 * The step Back returns to, or undefined: the first step has none, and once
 * the workspace exists the steps before it are done (AC-1209). Nothing after
 * the workspace has a Back either: each of those steps makes something
 * (a handle, a page, a calendar, invitations), so going back would mean
 * undoing it.
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
 * First run's search: the step, the workspace once it is made (every step
 * after it needs it), and what a calendar connect came back with (`?calendar=`).
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
 * The step to show: once the workspace is made, the step asked for when this
 * person still has it to do, else the first one they do (Your booking page,
 * then Your link page, then the calendar, then Invite your team); before the
 * workspace, the step asked for, never one that needs the workspace; Your
 * name when none is asked for. `steps` is this person's own list, so a step
 * they have already done is never shown again.
 */
export function shownStep(
  asked: WelcomeStep | undefined,
  hasWorkspace: boolean,
  another = false,
  steps: readonly WelcomeStep[] = STEPS,
): WelcomeStep {
  const after = steps.filter(needsWorkspace);
  if (hasWorkspace) {
    if (asked !== undefined && after.includes(asked)) return asked;
    // Every list keeps Invite your team, so there is always one step left to land on.
    return after[0] ?? 'invite';
  }
  // Another workspace (spec 0031): the person is known already, so it starts at Your workspace.
  if (another) return 'workspace';
  return asked === undefined || needsWorkspace(asked) ? 'about' : asked;
}

/** Where `/welcome` goes for a signed in person: first run's steps (with the workspace just made), or a workspace. */
export type WelcomeLanding<W> =
  { readonly kind: 'steps'; readonly workspace: W | undefined } | { readonly kind: 'open'; readonly slug: string };

/**
 * Where `/welcome` goes: the steps after the workspace for `asked` only when
 * it is one of the person's own workspaces; else, for someone with a
 * workspace, that workspace (or their first); else the steps from the
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
  // Your booking page always follows the workspace, so the one just made keeps the steps open.
  if (made !== undefined) return { kind: 'steps', workspace: made };
  if (another) return { kind: 'steps', workspace: undefined };
  return home === undefined ? { kind: 'steps', workspace: undefined } : { kind: 'open', slug: home.slug };
}
