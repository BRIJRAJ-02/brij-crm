// The one module that imports React Email (lint's vendor rule): the parts of
// it the email layout uses, and its HTML renderer. Node runs these files with
// no build step, and type stripping has no JSX, so callers make elements with
// React's createElement.
/** The React Email components the layout draws with. */
export { Button, Container, Head, Heading, Html, Link, Section, Text } from 'react-email';
// From the package that owns it: react-email 6.11 re-exports `render` but leaves it out of its own type
// declarations, so every build that typechecks these files reported it as missing (deploy, 24 Oct 2026).
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

/** An email element as HTML: a whole document, `<!DOCTYPE>` included. */
export function renderHtml(element: ReactElement): Promise<string> {
  return render(element);
}
