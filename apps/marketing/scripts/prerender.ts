// The build's last step (package.json `build`): each page of the site rendered by the SSR bundle and written into
// the client build's shell (index.html for the home page, <page>.html for the rest; vercel.json's clean URLs serve
// them at /<page>), then the SSR bundle deleted, so dist/ holds the pages, their one script, stylesheets, fonts
// and images.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prerenderPage } from './page.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SSR = path.join(ROOT, 'dist-ssr');

interface SsrBundle {
  readonly render: (page: string) => string;
  readonly ROUTES: readonly {
    readonly id: string;
    readonly path: string;
    readonly file: string;
    readonly title: string;
    readonly description: string;
  }[];
}

const bundle = (await import(pathToFileURL(path.join(SSR, 'render.js')).href)) as SsrBundle;
const shell = readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const route of bundle.ROUTES) {
  writeFileSync(path.join(DIST, route.file), prerenderPage(shell, bundle.render(route.id), route));
}
rmSync(SSR, { recursive: true, force: true });
