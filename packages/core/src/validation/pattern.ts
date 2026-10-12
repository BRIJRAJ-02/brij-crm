// The server's pattern engine for validation rules (spec 0013, AC-258): RE2
// semantics through `re2js`, linear time, so no pattern a customer writes can
// stall a write. The only file on the server that imports `re2js`.
import type { PatternTest } from '@crm/contracts/validation';
import { RE2JS } from 're2js';

/**
 * Compiles a full pattern (already wrapped as `^(?:…)$`) under RE2's rules,
 * with "Ignore case" when asked. Throws RE2's own error, whose message says
 * why a pattern can't be used ("error parsing regexp: missing closing )").
 */
export function compilePattern(source: string, ignoreCase: boolean): PatternTest {
  const compiled = RE2JS.compile(source, ignoreCase ? RE2JS.CASE_INSENSITIVE : 0);
  return { test: (text) => compiled.matches(text) };
}
