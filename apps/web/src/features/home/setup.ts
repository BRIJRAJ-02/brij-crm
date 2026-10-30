// Home's Finish setting up (spec 0041): the steps a member may still take,
// each done or not from real state, never from a flag. A step the member may
// not take, or whose state didn't load, is left out. Pure.

/** A setup step. */
export type SetupStepId = 'calendar' | 'bookingPage' | 'form' | 'contacts' | 'invite';

/** What the steps are read from; a fact left out means the member may not take that step (or it didn't load). */
export interface SetupFacts {
  /** The member's calendar connections' addresses (calendars enabled). */
  readonly calendars?: readonly string[];
  /** How many booking pages the member owns (`booking.manage`). */
  readonly bookingPages?: number;
  /** How many forms the workspace has (`forms.manage`). */
  readonly forms?: number;
  /** How many records People holds (People writable): an import, or one by one, ticks it. */
  readonly contacts?: number;
  /** How many people are in the workspace, and how many invitations still work (`members.invite`). */
  readonly team?: { readonly members: number; readonly invited: number };
}

/** One step as Home shows it. */
export interface SetupStep {
  readonly id: SetupStepId;
  readonly done: boolean;
}

/** The steps to show, in order, each done or not. */
export function setupSteps(facts: SetupFacts): readonly SetupStep[] {
  const steps: SetupStep[] = [];
  if (facts.calendars !== undefined) steps.push({ id: 'calendar', done: facts.calendars.length > 0 });
  if (facts.bookingPages !== undefined) steps.push({ id: 'bookingPage', done: facts.bookingPages > 0 });
  if (facts.forms !== undefined) steps.push({ id: 'form', done: facts.forms > 0 });
  if (facts.contacts !== undefined) steps.push({ id: 'contacts', done: facts.contacts > 0 });
  if (facts.team !== undefined) {
    steps.push({ id: 'invite', done: facts.team.members > 1 || facts.team.invited > 0 });
  }
  return steps;
}

/** The first step not done: the one that carries the button. */
export function nextStep(steps: readonly SetupStep[]): SetupStepId | undefined {
  return steps.find((step) => !step.done)?.id;
}
