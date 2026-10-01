// A theme controller for stories: it holds the choice in memory and tells its
// listeners, with no storage and no page. Stories only.
import type { ThemeChoice, ThemeController } from '../theme/theme.ts';

/** A theme controller that keeps the choice in memory, starting at System. */
export function fakeThemeController(): ThemeController {
  let choice: ThemeChoice = 'system';
  const listeners = new Set<(choice: ThemeChoice) => void>();
  return {
    get: () => choice,
    set: (next) => {
      choice = next;
      for (const listener of listeners) listener(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => undefined,
  };
}
