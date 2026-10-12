// The browser's pattern engine for validation rules (spec 0013, AC-258): RE2
// semantics through `re2js`, the same engine the server runs, so a pattern
// can't pass here and fail there. The only file in the browser that imports
// `re2js`; the records layer loads it with `import()` only when a pattern
// rule needs checking, so the first load never carries it.
import type { PatternTest } from '@crm/contracts/validation';
import { RE2JS } from 're2js';

/** Compiles a full pattern (already wrapped as `^(?:…)$`) under RE2's rules, with "Ignore case" when asked. */
export function compilePattern(source: string, ignoreCase: boolean): PatternTest {
  const compiled = RE2JS.compile(source, ignoreCase ? RE2JS.CASE_INSENSITIVE : 0);
  return { test: (text) => compiled.matches(text) };
}
