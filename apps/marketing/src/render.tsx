// The SSR build's entry (package.json `build`): each page as HTML, written into the shell by scripts/prerender.ts,
// then hydrated in the browser by client.tsx. It renders exactly the tree the browser hydrates.
import { createToasts } from '@crm/ui';
import { renderToString } from 'react-dom/server';
import { App } from './App.tsx';
import { ROUTES, type PageId } from './routes.ts';

export { ROUTES };

/** One page's markup, for the `<!--app-->` slot in index.html. */
export function render(page: PageId): string {
  return renderToString(<App page={page} toasts={createToasts()} />);
}
