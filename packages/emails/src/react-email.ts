// The one module that imports React Email (lint's vendor rule): the parts of
// it the email layout uses, and its HTML renderer. Node runs these files with
// no build step, and type stripping has no JSX, so callers make elements with
// React's createElement.
/** The React Email components the layout draws with. */
export { Button, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from 'react-email';
import { render } from 'react-email';
import type { ReactElement } from 'react';

/** An email element as HTML: a whole document, `<!DOCTYPE>` included. */
export function renderHtml(element: ReactElement): Promise<string> {
  return render(element);
}
