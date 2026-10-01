// Intl formatters are slow to build and never change once built, so each one
// is built once per language and options, then reused: a grid screen formats
// hundreds of values per scroll step. It memoises pure values, so nothing
// behaves differently for what it holds.
const built = new Map<string, unknown>();

/** The formatter for `key` (its kind, language and options), built by `make` the first time. */
export function memoIntl<T>(key: string, make: () => T): T {
  if (built.has(key)) return built.get(key) as T;
  const made = make();
  built.set(key, made);
  return made;
}
