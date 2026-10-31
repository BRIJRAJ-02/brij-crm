import { describe, expect, it } from 'vitest';
import { withoutPresentStyles } from './preloads.ts';

const CODE =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/A.js","assets/Button.css","assets/A.css"])))=>i.map(i=>d[i]);' +
  'x(()=>import(`./A.js`),__vite__mapDeps([0,1,2]));y(()=>import(`./B.js`),__vite__mapDeps([1]));';

describe('withoutPresentStyles (spec 0063, AC-6331)', () => {
  it('takes the stylesheets the page already has out of the list and every import’s indexes, keeping the length', () => {
    const out = withoutPresentStyles(CODE, new Set(['assets/Button.css']));
    expect(out).toHaveLength(CODE.length);
    expect(out).toContain('m.f=["assets/A.js","assets/A.css"]');
    expect(out).toContain('__vite__mapDeps([0,1])');
    expect(out).toContain('__vite__mapDeps([])');
    // Only spaces fill what was taken out, so the code stays a valid script with every column where it was.
    expect(out.replace(/ +/g, '')).toBe(
      CODE.replace('"assets/Button.css",', '')
        .replace('__vite__mapDeps([0,1,2])', '__vite__mapDeps([0,1])')
        .replace('__vite__mapDeps([1])', '__vite__mapDeps([])')
        .replace(/ +/g, ''),
    );
  });

  it('leaves a chunk alone when nothing it lists is already there', () => {
    expect(withoutPresentStyles(CODE, new Set(['assets/Other.css']))).toBe(CODE);
    expect(withoutPresentStyles('const a=1;', new Set(['assets/A.css']))).toBe('const a=1;');
  });
});
