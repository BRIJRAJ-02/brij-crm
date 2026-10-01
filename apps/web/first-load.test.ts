// The first load walks index.html's static imports and never its dynamic ones.
import { describe, expect, it } from 'vitest';
import { firstLoad, type Manifest } from './first-load.ts';

const manifest: Manifest = {
  'index.html': {
    file: 'assets/index.js',
    isEntry: true,
    imports: ['_shared.js'],
    dynamicImports: ['src/routes/grid.tsx'],
    css: ['assets/index.css'],
  },
  '_shared.js': { file: 'assets/shared.js', imports: ['index.html'], css: ['assets/index.css'] },
  'src/routes/grid.tsx': { file: 'assets/grid.js', isDynamicEntry: true, imports: ['_shared.js'] },
};

describe('firstLoad', () => {
  it('collects the entry and its static imports, once each, with their CSS', () => {
    expect(firstLoad(manifest)).toEqual({
      chunks: ['index.html', '_shared.js'],
      js: ['assets/index.js', 'assets/shared.js'],
      css: ['assets/index.css'],
    });
  });

  it('refuses a manifest without the index.html entry', () => {
    expect(() => firstLoad({})).toThrow(/no index.html entry/);
  });
});
