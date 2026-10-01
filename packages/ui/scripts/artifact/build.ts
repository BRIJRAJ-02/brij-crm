// `pnpm ui:artifact [--check]`: builds the design system artifact's component
// files from code (spec 0003, AC-17), into packages/ui/.artifact/project/:
//
//   components/lib/react.js, react-dom.js   React 19 as classic scripts that set
//                                           window.React and window.ReactDOM
//   components/bundle.js                    the library as one classic script
//                                           that sets window.Workspace
//   components/bundle.css                   the reset, base and components layers
//   components/index.d.ts                   the rolled up types
//   components/<Card>/preview.html          the card's flagged stories, live
//   components/<Card>/README.md             the component's README
//
// plus .artifact/publish.json: the cards, the libraries entry for the index,
// and every file to send. The agent publishes them after your OK. With
// --check (CI) it builds into a temporary folder, checks the type's caps and
// rules, and keeps nothing. tokens.json, the fonts and the brand book are
// never written here: tokens flow the other way (spec 0002), and the page
// itself generates manifest.json and the api/ cards.
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';
import { build, type Plugin, type Rolldown } from 'vite';
import { LIBRARY_DEFINES, uiVite } from '../../src/vite.ts';
import { readStoryCard, type StoryCard } from './stories.ts';

const UI = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(UI, 'src');
const HERE = import.meta.dirname;
const RUNTIME = path.join(HERE, 'preview-runtime.tsx');
const TEST_STUB = path.join(HERE, 'story-test-stub.ts');
const NAMESPACE = 'Workspace';
const GROUP_ORDER = ['Atoms', 'Molecules', 'Modules'];

const KB = 1024;
const MB = KB * KB;
/** The type's caps (format.md), by file kind. */
const CAPS = { lib: 2 * MB, bundle: 6 * MB, css: 2 * MB, types: 1.5 * MB, preview: 256 * KB } as const;

/** React's modules, and the global each one comes from in the preview frame. */
const GLOBALS: Readonly<Record<string, string>> = {
  react: 'React',
  'react/jsx-runtime': 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
};

const check = process.argv.includes('--check');
const OUT = check ? mkdtempSync(path.join(tmpdir(), 'crm-artifact-')) : path.join(UI, '.artifact');
const PROJECT = path.join(OUT, 'project');
// Entries sit inside the package, even for --check, so they resolve its dependencies.
const ENTRIES = path.join(UI, '.artifact', '.entries');
const problems: string[] = [];

interface Built {
  readonly code: string;
  readonly css: string | undefined;
  /** The names each external module is imported for, from the bundler. */
  readonly bindings: Readonly<Record<string, readonly string[]>>;
}

function cleanPath(id: string): string {
  return id.split('?')[0] ?? id;
}

/**
 * Points React's modules at the globals the library scripts set. A shim
 * module, not an external: React DOM and some dependencies are CommonJS, and
 * a bundler leaves `require()` of an external as is, which a browser lacks.
 */
function reactGlobals(modules: readonly string[]): Plugin {
  const PREFIX = '\0crm-global:';
  return {
    name: 'crm-artifact-react-globals',
    enforce: 'pre',
    resolveId: (source) => (modules.includes(source) ? `${PREFIX}${source}` : null),
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      return `module.exports = window.${GLOBALS[id.slice(PREFIX.length)] ?? 'undefined'};`;
    },
  };
}

/** Notes every name ES modules import from React's modules, after TypeScript and JSX are compiled away. */
function reactBindings(bindings: Record<string, string[]>): Plugin {
  const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](react|react\/jsx-runtime|react-dom|react-dom\/client)["']/g;
  return {
    name: 'crm-artifact-react-bindings',
    enforce: 'post',
    transform(code) {
      for (const match of code.matchAll(NAMED_IMPORT)) {
        const source = match[2] ?? '';
        const names = (match[1] ?? '')
          .split(',')
          .map((part) => part.trim().split(/\s+as\s+/)[0] ?? '')
          .filter((name) => name !== '');
        bindings[source] = [...(bindings[source] ?? []), ...names];
      }
      return null;
    },
  };
}

/** Builds `entry` as one minified IIFE named `name`. `bundleReact` builds React itself (or React DOM over the React global). */
async function buildScript(
  entry: string,
  name: string,
  options: { plugins?: Plugin[]; bundleReact?: 'react' | 'react-dom' } = {},
): Promise<Built> {
  const shimmed =
    options.bundleReact === 'react' ? [] : options.bundleReact === 'react-dom' ? ['react'] : Object.keys(GLOBALS);
  const bindings: Record<string, string[]> = {};
  const result = await build({
    configFile: false,
    root: UI,
    logLevel: 'warn',
    mode: 'production',
    plugins: [reactGlobals(shimmed), ...(options.plugins ?? []), react(), uiVite(), reactBindings(bindings)],
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), ...LIBRARY_DEFINES },
    build: {
      write: false,
      minify: true,
      sourcemap: false,
      cssCodeSplit: false,
      emptyOutDir: false,
      lib: { entry, name, formats: ['iife'], fileName: () => `${name}.js` },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const files = outputs.flatMap((output) => output.output);
  const chunk = files.find((file): file is Rolldown.OutputChunk => file.type === 'chunk');
  if (chunk === undefined) throw new Error(`Building ${entry} produced no script.`);
  if (/\brequire\(/.test(chunk.code))
    problems.push(`${path.basename(entry)} still calls require(), which a browser lacks.`);
  const asset = files.find(
    (file): file is Rolldown.OutputAsset => file.type === 'asset' && file.fileName.endsWith('.css'),
  );
  const css =
    asset === undefined
      ? undefined
      : typeof asset.source === 'string'
        ? asset.source
        : new TextDecoder().decode(asset.source);
  return { code: chunk.code, css, bindings };
}

/** Runs classic scripts in one bare context and returns its globals, for the binding checks. */
function evaluate(scripts: readonly string[]): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    TextEncoder,
    TextDecoder,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  for (const script of scripts) vm.runInContext(script, context);
  return sandbox;
}

/** Flags a file over its cap, or holding text that would end the element it is inlined into. */
function checkFile(label: string, text: string, cap: number, forbidden: readonly RegExp[]) {
  const size = Buffer.byteLength(text);
  if (size > cap) problems.push(`${label} is ${(size / KB).toFixed(0)} KB, over its ${(cap / KB).toFixed(0)} KB cap.`);
  for (const pattern of forbidden) {
    if (pattern.test(text))
      problems.push(`${label} holds ${pattern.source}, which would end the element it is inlined into.`);
  }
}

/** Makes script text safe to inline: no `</script` and no `<!--`, written so they mean the same. */
function inlineSafe(code: string): string {
  return code.replaceAll(/<\/script/gi, '<\\/script').replaceAll('<!--', '\\x3C!--');
}

function write(relative: string, text: string) {
  const file = path.join(PROJECT, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeEntry(name: string, code: string): string {
  mkdirSync(ENTRIES, { recursive: true });
  const file = path.join(ENTRIES, name);
  writeFileSync(file, code);
  return file;
}

/** The first sentence of a README after its heading: the card's summary on the artifact page. */
function summaryOf(readme: string): string {
  const body = readme
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join(' ')
    .trim();
  return /^(.+?[.!?])(\s|$)/.exec(body)?.[1] ?? body.slice(0, 160);
}

function listStories(): { card: StoryCard; file: string }[] {
  const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.stories.tsx'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  const cards = files.flatMap((file) => {
    const card = readStoryCard(file, readFileSync(file, 'utf8'));
    return card === undefined || !GROUP_ORDER.includes(card.group) ? [] : [{ card, file }];
  });
  return cards.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.card.group) - GROUP_ORDER.indexOf(b.card.group) || a.card.name.localeCompare(b.card.name),
  );
}

/** Points the stories' and the runtime's library imports at window.Workspace, and storybook/test at the stub. */
function workspaceImports(names: readonly string[], importers: ReadonlySet<string>): Plugin {
  const VIRTUAL = '\0crm-artifact:workspace';
  return {
    name: 'crm-artifact-workspace',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === 'storybook/test') return TEST_STUB;
      if (importer === undefined || !importers.has(cleanPath(importer))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;
      const file = cleanPath(resolved.id);
      // Play helpers (src/workbench/*.ts) stay in the preview, where the dropped
      // play functions leave them unused.
      if (path.dirname(file) === path.join(SRC, 'workbench')) return null;
      return file.startsWith(SRC + path.sep) && !importers.has(file) ? VIRTUAL : null;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      return names.map((name) => `export const ${name} = window.${NAMESPACE}.${name};`).join('\n');
    },
  };
}

function previewHtml(card: StoryCard, script: string): string {
  const height = 32 + card.previews.length * 72;
  return [
    `<!-- @dsCard group="${card.group}" height=${String(height)} -->`,
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${card.name}</title></head>`,
    '<body>',
    '<div id="root"></div>',
    `<script>${script}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const REACT_VERSION = (
  JSON.parse(readFileSync(path.join(UI, 'node_modules/react/package.json'), 'utf8')) as { version: string }
).version;

rmSync(PROJECT, { recursive: true, force: true });

// 1. React 19 as two classic scripts. It ships no global build, so we make one.
const reactLib = await buildScript(
  // The CommonJS exports object whole, internals included, so React DOM finds them.
  writeEntry(
    'react.ts',
    "import React from 'react';\nimport { jsx, jsxs } from 'react/jsx-runtime';\nexport default { ...React, jsx, jsxs };\n",
  ),
  'React',
  { bundleReact: 'react' },
);
const reactDomLib = await buildScript(
  writeEntry(
    'react-dom.ts',
    "import ReactDOM from 'react-dom';\nimport { createRoot, hydrateRoot } from 'react-dom/client';\nexport default { ...ReactDOM, createRoot, hydrateRoot };\n",
  ),
  'ReactDOM',
  { bundleReact: 'react-dom' },
);
const react19 = inlineSafe(reactLib.code);
const reactDom19 = inlineSafe(reactDomLib.code);
write('components/lib/react.js', react19);
write('components/lib/react-dom.js', reactDom19);
checkFile('components/lib/react.js', react19, CAPS.lib, [/<\/script/i, /<!--/]);
checkFile('components/lib/react-dom.js', reactDom19, CAPS.lib, [/<\/script/i, /<!--/]);

// 2. The library as window.Workspace, with its stylesheet.
const stories = listStories();
const bundle = await buildScript(path.join(HERE, 'bundle-entry.ts'), NAMESPACE);
const header = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: NAMESPACE, components: stories.map(({ card }) => ({ name: card.name })) })} */`;
const bundleJs = `${header}\n${inlineSafe(bundle.code)}`;
write('components/bundle.js', bundleJs);
checkFile('components/bundle.js', bundleJs, CAPS.bundle, [/<\/script/i, /<!--/]);

const bundleCss = `@layer reset, tokens, base, components, utilities;\n${bundle.css ?? ''}`;
write('components/bundle.css', bundleCss);
checkFile('components/bundle.css', bundleCss, CAPS.css, [/<\/style/i]);

// Every name the bundle takes from React must be one the two scripts set.
const globals = evaluate([react19, reactDom19, bundleJs]);
const workspace = globals[NAMESPACE];
if (typeof workspace !== 'object' || workspace === null)
  problems.push(`components/bundle.js doesn't set window.${NAMESPACE}.`);
const workspaceNames = Object.keys(workspace ?? {}).sort();

function checkBindings(label: string, built: Built) {
  for (const [source, names] of Object.entries(built.bindings)) {
    const globalName = GLOBALS[source];
    if (globalName === undefined) {
      problems.push(`${label} imports ${source}, which no library script provides.`);
      continue;
    }
    const provided = globals[globalName] as Record<string, unknown> | undefined;
    for (const name of new Set(names)) {
      if (name !== 'default' && name !== '*' && provided?.[name] === undefined) {
        problems.push(`${label} uses ${globalName}.${name}, which components/lib doesn't set.`);
      }
    }
  }
}
checkBindings('components/bundle.js', bundle);

// 3. The rolled up types: documentation for the page's props panels.
const typesBuild = await rolldown({
  input: path.join(SRC, 'index.ts'),
  plugins: [dts({ emitDtsOnly: true, tsconfig: path.join(UI, 'tsconfig.json') })],
  external: (id) => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
  logLevel: 'silent',
});
const typesOutput = await typesBuild.generate({ format: 'es' });
const types = typesOutput.output.find((file) => file.type === 'chunk' && file.fileName.endsWith('.d.ts'));
if (types === undefined || types.type !== 'chunk') throw new Error('The types build produced no .d.ts.');
write('components/index.d.ts', types.code);
checkFile('components/index.d.ts', types.code, CAPS.types, []);

// 4. One live preview per card, from its flagged stories, and its README.
const cards = [];
for (const { card, file } of stories) {
  const entry = writeEntry(
    `preview-${card.name}.tsx`,
    [
      `import meta, { ${card.previews.join(', ')} } from ${JSON.stringify(file)};`,
      `import { renderPreview } from ${JSON.stringify(RUNTIME)};`,
      `renderPreview(meta, [${card.previews.join(', ')}]);`,
      '',
    ].join('\n'),
  );
  const preview = await buildScript(entry, `preview${card.name}`, {
    plugins: [workspaceImports(workspaceNames, new Set([file, RUNTIME]))],
  });
  checkBindings(`components/${card.name}/preview.html`, preview);
  if (preview.css !== undefined && preview.css.trim() !== '') {
    problems.push(`components/${card.name}/preview.html carries CSS of its own; its styles must come from bundle.css.`);
  }
  for (const marker of ['@testing-library', '@vitest/', 'chai']) {
    if (preview.code.includes(marker))
      problems.push(`components/${card.name}/preview.html pulls storybook/test in (${marker}).`);
  }
  const html = previewHtml(card, inlineSafe(preview.code));
  write(`components/${card.name}/preview.html`, html);
  checkFile(`components/${card.name}/preview.html`, html, CAPS.preview, [
    /<(iframe|frame|object|embed|portal|noscript)\b/i,
  ]);
  // Links in a preview (a LinkChip's https://…) are fine; code that fetches is
  // not. What a preview actually loads is checked when it renders (step 5).
  if (/\bfetch\(|XMLHttpRequest|\bWebSocket\(|\bEventSource\(|import\(\s*['"]https?:/.test(preview.code)) {
    problems.push(`components/${card.name}/preview.html reaches the network; previews fetch nothing.`);
  }

  const readme = readFileSync(path.join(path.dirname(file), 'README.md'), 'utf8');
  write(`components/${card.name}/README.md`, readme);
  cards.push({ name: card.name, group: card.group, summary: summaryOf(readme), stories: card.previews });
}

// 5. Render every preview as the artifact's frame does (tokens.css, bundle.css,
//    the two React scripts and bundle.js preloaded) and fail on an error or an
//    empty card, so a broken preview never reaches the page.
const tokensCss = readFileSync(path.join(UI, '../tokens/tokens.css'), 'utf8');
const browser = await chromium.launch();
try {
  for (const card of cards) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (/^(https?|wss?):/.test(request.url())) errors.push(`loads ${request.url()}; previews fetch nothing`);
    });
    const html = readFileSync(path.join(PROJECT, 'components', card.name, 'preview.html'), 'utf8');
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    const frame = [
      '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">',
      `<style>${tokensCss}</style><style>${bundleCss}</style>`,
      `<script>${react19}</script><script>${reactDom19}</script><script>${bundleJs}</script>`,
      `</head><body>${body}</body></html>`,
    ].join('');
    await page.setContent(frame, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    const rendered = await page.locator('#root *').count();
    if (errors.length > 0) problems.push(`components/${card.name}/preview.html fails to render: ${errors.join(' | ')}`);
    if (rendered === 0) problems.push(`components/${card.name}/preview.html renders nothing.`);
    await page.close();
  }
} finally {
  await browser.close();
}

// 6. What the publish step needs.
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: UI, encoding: 'utf8' }).trim();
const files = readdirSync(PROJECT, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(OUT, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();
const publish = {
  namespace: NAMESPACE,
  built: { commit, at: new Date().toISOString() },
  libraries: [
    { name: 'react', version: REACT_VERSION, global: 'React', file: 'components/lib/react.js' },
    { name: 'react-dom', version: REACT_VERSION, global: 'ReactDOM', file: 'components/lib/react-dom.js' },
  ],
  components: cards,
  workspace: workspaceNames,
  files,
};
writeFileSync(path.join(OUT, 'publish.json'), `${JSON.stringify(publish, null, 2)}\n`);
rmSync(ENTRIES, { recursive: true, force: true });

const sizes = files.map(
  (file) => `  ${file}  ${(Buffer.byteLength(readFileSync(path.join(OUT, file))) / KB).toFixed(1)} KB`,
);
console.log(`Artifact files (${String(files.length)}), from ${commit}:\n${sizes.join('\n')}`);
console.log(`Cards: ${cards.map((card) => `${card.group}/${card.name}`).join(', ')}`);

if (check) rmSync(OUT, { recursive: true, force: true });
if (problems.length > 0) {
  console.error(`\n${String(problems.length)} problem(s):\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log(check ? '\nThe artifact build passes its checks.' : `\nWritten to ${path.relative(process.cwd(), OUT)}.`);
// The scripts evaluated for the checks may leave React's scheduler timers behind.
process.exit(0);
