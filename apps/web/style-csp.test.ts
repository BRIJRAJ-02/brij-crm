// Inline styles under the production policy (22 October 2026): every page's
// style-src is 'self' plus the hash of the one fixed <style> React Aria injects
// that nothing can head off (usePreventScroll's, on iOS while a dialog is open),
// never 'unsafe-inline'. Its other <style>, usePress's touch-action rule, is
// headed off: the /layers.css link carries the id usePress looks for, and the
// rule lives in the library's reset layer. These checks read the installed
// React Aria, so an upgrade that changes either one fails here, not in a
// visitor's console.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PRESSABLE_STYLE_ID } from '@crm/ui/vite';
import { describe, expect, it } from 'vitest';
import { directiveSources, policyForPath, sourcePattern } from './csp.ts';

const UI = path.join(import.meta.dirname, '..', '..', 'packages', 'ui');
/** The React Aria @crm/ui builds with: its package folder. */
const REACT_ARIA = path.dirname(createRequire(path.join(UI, 'package.json')).resolve('react-aria/package.json'));
const PRIVATE = path.join(REACT_ARIA, 'dist', 'private');
const read = (file: string) => readFileSync(path.join(PRIVATE, file), 'utf8');

/** The CSS one React Aria module writes into its injected <style>. */
function injected(source: string): string {
  const match = /style\.textContent = `([^`]*)`\.trim\(\)/.exec(source);
  if (match === null) throw new Error('No injected style found.');
  return (match[1] ?? '').trim();
}

const hashOf = (css: string) => `'sha256-${createHash('sha256').update(css).digest('base64')}'`;

const PAGES = ['/', '/sign-in', '/w/acme/objects/people', '/f/contact-us', '/b/intro-call', '/b/intro-call/manage'];

describe('the policy each page gets', () => {
  it('matches vercel.json sources the way Vercel does', () => {
    expect(sourcePattern('/b/:publicKey').test('/b/intro')).toBe(true);
    expect(sourcePattern('/b/:publicKey').test('/b/intro/manage')).toBe(false);
    expect(sourcePattern('/f/(.*)').test('/f/x')).toBe(true);
    expect(sourcePattern('/((?:a|b)/.*)').test('/a/x')).toBe(true);
  });

  it('gives the form, the booking page and the app each their own, and the api none', () => {
    expect(directiveSources(policyForPath('/f/contact-us') ?? '', 'frame-src')).toEqual([
      'https://www.google.com/recaptcha/',
    ]);
    expect(directiveSources(policyForPath('/b/intro-call') ?? '', 'frame-ancestors')).toEqual(['*']);
    expect(directiveSources(policyForPath('/sign-in') ?? '', 'frame-ancestors')).toEqual(["'self'"]);
    expect(directiveSources(policyForPath('/b/intro-call/manage') ?? '', 'frame-ancestors')).toEqual(["'self'"]);
    expect(policyForPath('/api/rpc/x')).toBeUndefined();
    expect(policyForPath('/embed/v1.js')).toBeUndefined();
  });
});

describe('inline styles', () => {
  const preventScroll = injected(read('overlays/usePreventScroll.mjs'));

  it.each(PAGES)("allows %s 'self' and the hash of React Aria's scroll lock style, never unsafe-inline", (page) => {
    expect(directiveSources(policyForPath(page) ?? '', 'style-src')).toEqual(["'self'", hashOf(preventScroll)]);
  });

  it("heads off usePress's <style> with the id it checks for, and carries its rule in the reset layer", () => {
    const press = read('interactions/usePress.mjs');
    expect(press).toMatch(new RegExp(`STYLE_ID = '${PRESSABLE_STYLE_ID}'`));
    expect(press).toMatch(/getElementById\(\$\w+\$var\$STYLE_ID\)\) return;/);
    const attribute = /PRESSABLE_ATTRIBUTE = '([\w-]+)'/.exec(press)?.[1];
    const declaration = /touch-action:[^;]+;/.exec(injected(press))?.[0];
    expect(attribute).toBe('data-react-aria-pressable');
    const reset = readFileSync(path.join(UI, 'src', 'styles', 'reset.css'), 'utf8');
    expect(reset).toContain(`[${attribute ?? ''}] {\n    ${declaration ?? 'missing'}`);
  });

  it('finds no other React Aria module that injects a <style>', () => {
    const injecting = readdirSync(PRIVATE, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.mjs') && read(file).includes("createElement('style')"),
    );
    expect(injecting.sort()).toEqual(['interactions/usePress.mjs', 'overlays/usePreventScroll.mjs']);
  });
});
