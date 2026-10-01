// The component library's public surface: what screens import from '@crm/ui'.
// The theme logic stays on its own subpath, '@crm/ui/theme', so the boot script
// test and other tools can load it without React. AC-9.
import { describe, expect, it } from 'vitest';
import * as ui from './index.ts';

describe('@crm/ui', () => {
  it('exports the Icon atom and the data hues', () => {
    expect(typeof ui.Icon).toBe('function');
    expect(ui.HUES).toEqual(['gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple']);
  });

  it('keeps the theme logic and the icon registry off the main entry', () => {
    expect(Object.keys(ui).sort()).toEqual(['HUES', 'Icon']);
  });
});
