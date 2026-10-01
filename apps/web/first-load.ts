// The files a first visit loads before anything is lazy: the entry chunk from
// index.html and everything it imports statically (never dynamic imports),
// with their CSS. Read from Vite's dist/.vite/manifest.json. The size budget
// (.size-limit.js) and the manifest test (build.test.ts) both use it (AC-18).

/** One chunk in Vite's build manifest. */
export interface ManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly css?: readonly string[];
}

/** Vite's build manifest: chunks by their source key. */
export type Manifest = Readonly<Record<string, ManifestChunk>>;

/** The first load: its chunks (manifest keys), JavaScript files and CSS files, relative to dist/. */
export interface FirstLoad {
  readonly chunks: readonly string[];
  readonly js: readonly string[];
  readonly css: readonly string[];
}

/** Walks the static import graph from index.html. Throws if the manifest has no index.html entry. */
export function firstLoad(manifest: Manifest): FirstLoad {
  if (manifest['index.html']?.isEntry !== true) throw new Error('The manifest has no index.html entry.');
  const chunks: string[] = [];
  const visit = (key: string) => {
    if (chunks.includes(key)) return;
    chunks.push(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };
  visit('index.html');
  const js = chunks.flatMap((key) => manifest[key]?.file ?? []);
  const css = [...new Set(chunks.flatMap((key) => manifest[key]?.css ?? []))];
  return { chunks, js, css };
}
