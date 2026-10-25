// The icon registry names every icon as Lucide does, and HUES matches the tag
// tokens. The Icon atom's own behaviour is checked by its stories.
import { OBJECT_ICONS } from '@crm/contracts/values';
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HUES } from '../../hue.ts';
import { editorIcons } from './editor-icons.ts';
import { icons } from './icons.ts';
import { linkPageIcons } from './link-page-icons.ts';

const SRC = path.resolve(import.meta.dirname, '../..');
const WEB = path.resolve(SRC, '../../../apps/web/src');

/** Every source file under a folder, but tests and stories. */
function sources(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|stories)\.tsx?$/.test(file))
    .map((file) => path.join(folder, file));
}

describe('the icon registry', () => {
  it('names every icon exactly as Lucide 1.49 does', () => {
    for (const [name, glyph] of Object.entries(icons)) {
      const pascal = name.replace(/(^|-)([a-z0-9])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
      expect(glyph.displayName, name).toBe(pascal);
    }
  });

  it('names the editor set as Lucide does, and shares no name with the registry', () => {
    for (const [name, glyph] of Object.entries(editorIcons)) {
      const pascal = name.replace(/(^|-)([a-z0-9])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
      expect(glyph.displayName, name).toBe(pascal);
      expect(Object.keys(icons)).not.toContain(name);
    }
  });

  it('draws the editor set only inside the editor, where its IconScope is', () => {
    const editor = path.join(SRC, 'editor');
    const names = Object.keys(editorIcons).join('|');
    const asIcon = new RegExp(`(icon|name)(=|: |=\\{)['"](${names})['"]`);
    const outside = [...sources(SRC), ...sources(WEB)].filter(
      (file) => !file.startsWith(editor) && !file.includes(`${path.sep}atoms${path.sep}Icon${path.sep}`),
    );
    expect(outside.filter((file) => asIcon.test(readFileSync(file, 'utf8')))).toEqual([]);
    expect(readFileSync(path.join(editor, 'FormatToolbar.tsx'), 'utf8')).toContain('<IconScope icons={editorIcons}>');
  });

  it('names the link page set as Lucide does, and shares no name with the registry or the editor set', () => {
    for (const [name, glyph] of Object.entries(linkPageIcons)) {
      const pascal = name.replace(/(^|-)([a-z0-9])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
      expect(glyph.displayName, name).toBe(pascal);
      expect([...Object.keys(icons), ...Object.keys(editorIcons)]).not.toContain(name);
    }
  });

  it('draws the link page set only on the link page and its editor, inside LinkPageIcons', () => {
    // The three places a link page draws: the module, the public page that mounts it, and the editor.
    const inside = [
      path.join(SRC, 'modules', 'LinkPage'),
      path.join(WEB, 'public', 'booking'),
      path.join(WEB, 'features', 'link-page'),
    ];
    const names = Object.keys(linkPageIcons).join('|');
    const asIcon = new RegExp(`(icon|name)(=|: |=\\{)['"](${names})['"]`);
    const outside = [...sources(SRC), ...sources(WEB)].filter(
      (file) =>
        !inside.some((each) => file.startsWith(each)) && !file.includes(`${path.sep}atoms${path.sep}Icon${path.sep}`),
    );
    expect(outside.filter((file) => asIcon.test(readFileSync(file, 'utf8')))).toEqual([]);
    const module = path.join(SRC, 'modules', 'LinkPage', 'LinkPage.tsx');
    expect(readFileSync(module, 'utf8')).toContain('<IconScope icons={linkPageIcons}>');
  });

  it('holds every curated object icon, so IconPicker can draw each one', () => {
    for (const name of OBJECT_ICONS) expect(Object.keys(icons)).toContain(name);
  });

  it('has an icon for every attribute type the artifact lists, plus AI', () => {
    for (const name of [
      'globe',
      'tag',
      'calendar',
      'circle-dollar-sign',
      'users',
      'building',
      'user',
      'star',
      'map-pin',
      'phone',
      'at-sign',
      'hash',
      'sparkles',
    ]) {
      expect(Object.keys(icons)).toContain(name);
    }
  });
});

describe('Hue', () => {
  it('lists exactly the hues tokens.json has tag tokens for', () => {
    const tagHues = tokens.color.tokens.flatMap((token) => /^tag-(.+)-bg$/.exec(token.name)?.[1] ?? []);
    expect([...HUES]).toEqual(tagHues);
  });
});
