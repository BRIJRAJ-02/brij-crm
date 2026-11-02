// What a lazy import preloads (spec 0063, AC-6331). Vite lists, beside every dynamic import, every chunk the
// imported chunk reaches, so the browser can fetch them at once. A chunk the importer itself already imports
// statically is loaded by the time its `import()` runs, so listing it fetches nothing: it only costs its file name in
// the importer's code. On the hosted form that was about 0.6 kB gzipped of names in a Classic form's first load, for
// its step layouts, its countdown on to book and its file question (31 October 2026, measured). This keeps every
// preload that can fetch something and drops the ones that never can: scripts through `resolveDependencies`, and
// stylesheets, which Vite lists whatever that answers, by taking the ones the importer already has out of the list
// Vite wrote. A stylesheet the import brings with it stays, so styles still arrive with their chunk.
import type { OutputBundle } from 'rolldown';
import type { Plugin } from 'vite';

/** Every chunk `host` imports statically, itself included: what is loaded once it runs. */
export function staticallyLoaded(bundle: OutputBundle, host: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const chunk = bundle[file];
    if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
  };
  visit(host);
  return seen;
}

/** Every stylesheet the chunks in `loaded` bring: what is on the page once they run. */
function stylesOf(bundle: OutputBundle, loaded: ReadonlySet<string>): ReadonlySet<string> {
  const styles = new Set<string>();
  for (const file of loaded) {
    const chunk = bundle[file];
    if (chunk?.type !== 'chunk') continue;
    const metadata = (chunk as { readonly viteMetadata?: { readonly importedCss?: ReadonlySet<string> } }).viteMetadata;
    for (const css of metadata?.importedCss ?? []) styles.add(css);
  }
  return styles;
}

/** The file list Vite writes at the top of a chunk with lazy imports, and each import's indexes into it. */
const DEPS_LIST = /^const __vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=\[([^\]]*)\]/;
const DEPS_CALL = /__vite__mapDeps\(\[([\d,]*)\]\)/g;

/**
 * `code` with the stylesheets in `present` taken out of Vite's preload lists. Each edit is padded with spaces to its
 * old length, so every later column, and so the hidden source map, stays where it was.
 */
export function withoutPresentStyles(code: string, present: ReadonlySet<string>): string {
  const list = DEPS_LIST.exec(code);
  if (list === null) return code;
  // Every entry a plain quoted name, or nothing is touched: an expression (`renderBuiltUrl`, a relative `base`)
  // would shift the indexes this reads.
  if (!/^("[^"]*"(,"[^"]*")*)?$/.test(list[1] ?? '')) return code;
  const files = [...(list[1] ?? '').matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
  const kept = files.flatMap((file, index) => (file.endsWith('.css') && present.has(file) ? [] : [index]));
  if (kept.length === files.length) return code;
  const at = new Map(kept.map((old, index) => [old, index]));
  const pad = (text: string, length: number) => text + ' '.repeat(Math.max(0, length - text.length));
  // The list's own brackets: the match ends on its `]`.
  const listText = `[${list[1] ?? ''}]`;
  const listStart = list.index + list[0].length - listText.length;
  const newList = pad(`[${kept.map((index) => JSON.stringify(files[index])).join(',')}]`, listText.length);
  const head = code.slice(0, listStart) + newList + code.slice(listStart + listText.length);
  return head.replace(DEPS_CALL, (call, indexes: string) => {
    const mapped = indexes
      .split(',')
      .filter((each) => each !== '')
      .flatMap((each) => {
        const index = at.get(Number(each));
        return index === undefined ? [] : [String(index)];
      });
    return pad(`__vite__mapDeps([${mapped.join(',')}])`, call.length);
  });
}

/**
 * A plugin that reads the finished bundle, and the `modulePreload.resolveDependencies` that uses it to leave out
 * what an import's own host has loaded already. The plugin's `generateBundle` runs first (`order: 'pre'`), before
 * Vite's import analysis asks `resolveDependencies`.
 */
export function preloadsNotLoaded(): {
  readonly plugin: Plugin;
  /** Runs after Vite's import analysis: takes the stylesheets an importer already has out of its preload lists. */
  readonly styles: Plugin;
  readonly resolveDependencies: (
    file: string,
    deps: string[],
    context: { readonly hostId: string; readonly hostType: 'html' | 'js' },
  ) => string[];
} {
  let bundle: OutputBundle | undefined;
  return {
    plugin: {
      name: 'crm:preloads-not-loaded',
      apply: 'build',
      generateBundle: {
        order: 'pre',
        handler(_options, output) {
          bundle = output;
        },
      },
    },
    styles: {
      name: 'crm:preload-styles-not-loaded',
      apply: 'build',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, output) {
          for (const chunk of Object.values(output)) {
            if (chunk.type !== 'chunk' || !chunk.code.startsWith('const __vite__mapDeps=')) continue;
            chunk.code = withoutPresentStyles(chunk.code, stylesOf(output, staticallyLoaded(output, chunk.fileName)));
          }
        },
      },
    },
    resolveDependencies: (_file, deps, { hostId, hostType }) => {
      if (bundle === undefined || hostType !== 'js') return deps;
      const loaded = staticallyLoaded(bundle, hostId);
      return deps.filter((dep) => !loaded.has(dep));
    },
  };
}
