// The business card's starting time zone (spec 0065, AC-6506): the newcomer's first try should read on the place's
// own clock, so a workspace still on the default UTC starts from the browser's zone instead.

/** The zone the card starts from: the workspace's own, unless it is still the default UTC; then the browser's. */
export function startingZone(workspaceZone: string | undefined, browserZone: string | undefined): string {
  if (workspaceZone !== undefined && workspaceZone !== 'UTC') return workspaceZone;
  return browserZone ?? workspaceZone ?? 'UTC';
}

/** This browser's time zone, when it says one. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
