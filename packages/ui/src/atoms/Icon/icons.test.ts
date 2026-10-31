// The icon registry names every icon as Lucide does, and HUES matches the tag
// tokens. The Icon atom's own behaviour is checked by its stories.
import { OBJECT_ICONS } from '@crm/contracts/values';
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HUES } from '../../hue.ts';
import { baseIcons } from './base-icons.ts';
import { editorIcons } from './editor-icons.ts';
import { icons } from './icons.ts';

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

  it('holds the base set too, named as Lucide does', () => {
    for (const [name, glyph] of Object.entries(baseIcons)) {
      expect(Object.keys(icons), name).toContain(name);
      expect(glyph, name).toBe(icons[name as keyof typeof icons]);
    }
  });

  it('gives the hosted form only base icons, since it mounts UiProviderBase, which brings no registry', () => {
    // The files the hosted page draws with (HostedFormSteps is stories only, so it is left out).
    const drawn = [
      'public-form/HostedForm.tsx',
      'public-form/FormParts.tsx',
      'public-form/FormBooking.tsx',
      'public-form/Question.tsx',
      'public-form/FileQuestion.tsx',
      'atoms/Button/Button.tsx',
      'atoms/Button/CopyButton.tsx',
      'atoms/Checkbox/Checkbox.tsx',
      'atoms/Radio/Radio.tsx',
      'atoms/Switch/Switch.tsx',
      'atoms/Link/Link.tsx',
      'atoms/Skeleton/Skeleton.tsx',
      'molecules/Field/Field.tsx',
      'molecules/FieldGroup/FieldGroup.tsx',
      'molecules/Select/Select.tsx',
      'molecules/CountryPicker/CountryPicker.tsx',
      'molecules/PhoneField/PhoneField.tsx',
      'molecules/Callout/Callout.tsx',
      'molecules/FileDrop/FileDrop.tsx',
      'molecules/FileItem/FileItem.tsx',
      'molecules/Popover/Popover.tsx',
      'provider/toasts.tsx',
    ];
    const named = /(?:<Icon name|icon|iconRight)(?:=|: |=\{)['"]([a-z0-9-]+)['"]/g;
    const toneIcons = /TONE_ICONS[^=]*=\s*\{([^}]*)\}/;
    const base = Object.keys(baseIcons);
    for (const file of drawn) {
      const source = readFileSync(path.join(SRC, file), 'utf8');
      const names = [...source.matchAll(named)].map((match) => match[1]);
      const tones = [...(toneIcons.exec(source)?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
      for (const name of [...names, ...tones]) expect(base, `${file} draws ${String(name)}`).toContain(name);
    }
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
