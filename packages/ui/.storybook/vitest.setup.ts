// Runs around every story test (the `stories` project, all three browsers).
// After the story renders, plays and passes axe in light (the a11y addon):
//   1. it fails if the story broke the production content security policy
//      (an injected <style>, an outside image, a blob: worker);
//   2. it switches to dark and runs axe again, so contrast holds in both
//      themes (AC-6).
import axe from 'axe-core';
import { configure } from 'storybook/test';
import { afterEach, beforeEach, expect } from 'vitest';

// Three engines run at once in CI, and WebKit can take over a second to put
// focus back after an overlay closes, so waitFor and findBy wait up to 5 s.
configure({ asyncUtilTimeout: 5_000 });

interface StoryContext {
  readonly story?: { readonly parameters: { readonly a11y?: { readonly disable?: boolean; readonly test?: string } } };
}

const blocked: string[] = [];

// Storybook's own test helpers inject styles too: it pauses animations with a
// <style> (preview api, bundled as deps/csf-*.js) and the a11y addon adds its
// vision filters with style attributes. Those are the workbench, not the
// library, so they are the only sources let through.
const WORKBENCH_SOURCES = [/\/deps\/csf-[\w-]+\.js/, /@storybook[+/]addon-a11y/];

document.addEventListener('securitypolicyviolation', (event) => {
  if (WORKBENCH_SOURCES.some((source) => source.test(event.sourceFile))) return;
  const what = event.blockedURI === '' || event.blockedURI === 'inline' ? `inline "${event.sample}"` : event.blockedURI;
  blocked.push(`${event.violatedDirective} blocked ${what} (${event.sourceFile}:${String(event.lineNumber)})`);
});

beforeEach(() => {
  blocked.splice(0);
});

/** Theme changes start colour transitions; finish them so axe reads the final colours. */
function settleTransitions() {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
}

afterEach(async (context) => {
  expect(blocked, 'The story broke the production content security policy').toEqual([]);

  const a11y = (context as StoryContext).story?.parameters.a11y;
  const root = document.querySelector('[data-testid="story-root"]');
  if (root === null || a11y?.disable === true || a11y?.test === 'off') return;

  const html = document.documentElement;
  const theme = html.dataset.theme;
  html.dataset.theme = 'dark';
  settleTransitions();
  try {
    const results = await axe.run(root, { resultTypes: ['violations'] });
    const violations = results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
    );
    expect(violations, 'axe found violations in the dark theme').toEqual([]);
  } finally {
    if (theme === undefined) delete html.dataset.theme;
    else html.dataset.theme = theme;
  }
});
