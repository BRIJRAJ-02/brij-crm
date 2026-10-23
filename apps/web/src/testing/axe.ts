// For browser tests (*.browser.test.tsx) only, never imported by the app: the
// page in one theme, and axe's WCAG A and AA violations on it, as the flows'
// checkScreen reads them (e2e/people.ts), so a screen test can hold contrast,
// names and roles in light and dark without a running app.
import axe from 'axe-core';

/** The two themes every screen is checked in. */
export const THEMES = ['light', 'dark'] as const;

/** One of the two themes. */
export type Theme = (typeof THEMES)[number];

/** Sets `theme` on <html>, as the theme controller does, and finishes the colour transitions it starts. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
}

/** Puts the theme back to the system's, for the next test. */
export function resetTheme(): void {
  delete document.documentElement.dataset.theme;
}

/**
 * axe's WCAG A and AA violations in the document, as `rule (help): targets` lines. React Aria's live announcer is
 * left out: it is empty between announcements.
 */
export async function axeViolations(): Promise<string[]> {
  const result = await axe.run(
    { exclude: [['[data-live-announcer]']] },
    {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    },
  );
  return result.violations.map(
    (violation) =>
      `${violation.id} (${violation.help}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}
