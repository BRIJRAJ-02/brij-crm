// The four templates (spec 0068): what each fixes, how a look switches to one, and the move of every old look to its
// nearest template (AC-6805), held to the migration that ran the same table in SQL.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_THEME,
  nearestTemplate,
  PAGE_TEMPLATES,
  PAGE_THEME_PRESETS,
  PageTheme,
  sameTheme,
  TEMPLATE_LOOKS,
  themeForTemplate,
} from './page-theme.ts';

const MIGRATION = readFileSync(new URL('../../../db/migrations/0170_page_templates.sql', import.meta.url), 'utf8');

/** What the spec says each old preset moves to (AC-6805), with no cover photo. */
const EXPECTED = {
  plain: 'classic',
  paper: 'classic',
  quiet: 'classic',
  ocean: 'classic',
  mint: 'classic',
  editorial: 'studio',
  dawn: 'studio',
  gallery: 'studio',
  ink: 'night',
  bold: 'night',
  studio: 'classic',
  night: 'night',
  peach: 'studio',
  graphite: 'night',
} as const;

describe('the four templates', () => {
  it('are classic, studio, night and split, and each fixes the same six names', () => {
    expect(PAGE_TEMPLATES).toEqual(['classic', 'studio', 'night', 'split']);
    for (const template of PAGE_TEMPLATES) {
      expect(Object.keys(TEMPLATE_LOOKS[template]).sort()).toEqual(
        ['fill', 'font', 'ground', 'header', 'mode', 'shape'].sort(),
      );
    }
  });

  it('switches a look to a template, keeping the hue, the avatar and the layout and dropping the note', () => {
    const moved: PageTheme = { ...DEFAULT_PAGE_THEME, hue: 'green', avatar: 'rounded', layout: 'grid', moved: true };
    const next = themeForTemplate('night', moved);
    expect(next).toMatchObject({ ...TEMPLATE_LOOKS.night, hue: 'green', avatar: 'rounded', layout: 'grid' });
    expect(next.template).toBe('night');
    expect(next).not.toHaveProperty('moved');
    expect(PageTheme.safeParse(next).success).toBe(true);
  });

  it('never hides the face', () => {
    expect(themeForTemplate('classic', { ...DEFAULT_PAGE_THEME, avatar: 'none' }).avatar).toBe('circle');
  });

  it('parses a template and the move note, and refuses anything else', () => {
    expect(PageTheme.safeParse({ ...DEFAULT_PAGE_THEME, template: 'studio', moved: true }).success).toBe(true);
    expect(PageTheme.safeParse({ ...DEFAULT_PAGE_THEME, template: 'gallery' }).success).toBe(false);
    expect(PageTheme.safeParse({ ...DEFAULT_PAGE_THEME, moved: false }).success).toBe(false);
  });

  it('tells two looks apart by their template and note too', () => {
    expect(sameTheme(DEFAULT_PAGE_THEME, { ...DEFAULT_PAGE_THEME, template: 'classic' })).toBe(false);
    expect(sameTheme(DEFAULT_PAGE_THEME, { ...DEFAULT_PAGE_THEME, moved: true })).toBe(false);
  });
});

describe('the move to templates (AC-6805)', () => {
  it('moves each old look to the template the spec names, whatever its hue', () => {
    for (const preset of PAGE_THEME_PRESETS) {
      expect(nearestTemplate({ ...preset.theme, hue: 'purple' }, false), preset.id).toBe(EXPECTED[preset.id]);
    }
  });

  it('moves a look that is no preset to Split with a cover, else Classic', () => {
    const own: PageTheme = { ...DEFAULT_PAGE_THEME, font: 'display', ground: 'tint' };
    expect(nearestTemplate(own, true)).toBe('split');
    expect(nearestTemplate(own, false)).toBe('classic');
    // A preset keeps its own template with a cover too: only the unmatched take Split.
    expect(nearestTemplate(DEFAULT_PAGE_THEME, true)).toBe('classic');
  });

  it('runs the same table as the migration', () => {
    for (const preset of PAGE_THEME_PRESETS) {
      const t = preset.theme;
      const row = `('${preset.id}', '${t.ground}', '${t.mode}', '${t.shape}', '${t.fill}', '${t.font}', '${t.gradient}', '${t.pattern}', '${t.header}', '${t.avatar}')`;
      expect(MIGRATION, preset.id).toContain(row);
      const target = EXPECTED[preset.id];
      if (target !== 'classic') expect(MIGRATION, preset.id).toContain(`when '${preset.id}' then '${target}'`);
    }
    for (const id of ['plain', 'paper', 'quiet', 'ocean', 'mint'])
      expect(MIGRATION).toContain(`when '${id}' then 'classic'`);
    expect(MIGRATION).toContain("else case when p.cover_path is not null then 'split' else 'classic' end");
  });
});
