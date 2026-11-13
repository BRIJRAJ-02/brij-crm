// The app's look (spec 0072, decision 16): a part guests also draw keeps its shipped CSS module, and its app look sits
// beside it in `<Part>.app.css`, written against the module's class names. These checks keep the two in step: a class
// renamed in the module would otherwise leave its app look styling nothing, silently.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopedClassName } from './vite.ts';

const SRC = import.meta.dirname;
const APP_LOOKS = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.app.css'))
  .map((entry) => path.relative(SRC, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();

/** The class names the CSS module beside an app look gives its elements, as Vite names them. */
function moduleClasses(appLook: string): Set<string> {
  const module = appLook.replace(/\.app\.css$/, '.module.css');
  const css = readFileSync(path.join(SRC, module), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const locals = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? '');
  return new Set(locals.map((local) => scopedClassName(local, module)));
}

/** A selector list's selectors: split at the commas that sit outside any brackets. */
function selectorsOf(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, at));
      start = at + 1;
    }
  }
  return [...parts, list.slice(start)];
}

describe('the app look', () => {
  it('exists for the parts guests draw that phase 1 restyled', () => {
    expect(APP_LOOKS).toEqual([
      'atoms/Avatar/Avatar.app.css',
      'atoms/Badge/Badge.app.css',
      'atoms/Button/Button.app.css',
      'atoms/Checkbox/Checkbox.app.css',
      'atoms/DragHandle/DragHandle.app.css',
      'atoms/FieldError/FieldError.app.css',
      'atoms/FieldLabel/FieldLabel.app.css',
      'atoms/Icon/Icon.app.css',
      'atoms/Kbd/Kbd.app.css',
      'atoms/Link/Link.app.css',
      'atoms/ProviderMark/ProviderMark.app.css',
      'atoms/Radio/Radio.app.css',
      'atoms/StatusDot/StatusDot.app.css',
      'atoms/Switch/Switch.app.css',
      'atoms/Tooltip/Tooltip.app.css',
      'molecules/Callout/Callout.app.css',
      'molecules/Card/Card.app.css',
      'molecules/ChoiceChips/ChoiceChips.app.css',
      'molecules/DescriptionList/DescriptionList.app.css',
      'molecules/Disclosure/Disclosure.app.css',
      'molecules/EmptyState/EmptyState.app.css',
      'molecules/Field/Field.app.css',
      'molecules/FieldGroup/FieldGroup.app.css',
      'molecules/FileDrop/FileDrop.app.css',
      'molecules/FileItem/FileItem.app.css',
      'molecules/Menu/Menu.app.css',
      'molecules/PersonLine/PersonLine.app.css',
      'molecules/Popover/Popover.app.css',
      'molecules/SegmentedControl/SegmentedControl.app.css',
      'molecules/Select/Select.app.css',
      'molecules/SocialLinks/SocialLinks.app.css',
      'molecules/Tabs/Tabs.app.css',
    ]);
  });

  it('is loaded, every file of it, by app-look.ts', () => {
    const loader = readFileSync(path.join(SRC, 'app-look.ts'), 'utf8');
    for (const look of APP_LOOKS) expect(loader).toContain(`import './${look}';`);
  });

  it.each(APP_LOOKS)('%s styles only classes its module names', (look) => {
    const known = moduleClasses(look);
    const css = readFileSync(path.join(SRC, look), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const used = new Set([...css.matchAll(/\.(ws-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''));
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !known.has(name))).toEqual([]);
  });

  it.each(APP_LOOKS)('%s applies only in the app, in the app-look layer', (look) => {
    const css = readFileSync(path.join(SRC, look), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{};]+)\{/g)]
      // One line each, as Prettier may wrap a long scope over three.
      .map((match) => (match[1] ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim())
      .filter((selector) => selector.startsWith('.') || selector.includes(',.') || selector.includes(', .'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const group of selectors) {
      for (const selector of selectorsOf(group)) {
        expect(selector).toContain(":where([data-scale='app'] *)");
      }
    }
    expect(css).toMatch(/@layer utilities\.app-look \{/);
    expect(css).not.toMatch(/@layer components/);
  });
});
