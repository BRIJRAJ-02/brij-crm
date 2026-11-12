// Bundles src into the design system artifact's components/bundle.js + bundle.css (one IIFE, React included).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
/** The repo root (this folder is design/timefix-design-system). */
const repo = fileURLToPath(new URL('../../', import.meta.url));
const uiModules = `${repo}packages/ui/node_modules`;
const req = createRequire(`${repo}packages/ui/package.json`);
/** esbuild from the repo's installs; install it with `pnpm add -D esbuild -w` if this throws. */
const { build } = await import(req.resolve('esbuild'));
const out = process.argv[2] ?? 'dist';
// Optional second argument: a comma list of component names to build alone (a builder's check), e.g. "Menu,Select".
const only = process.argv[3]?.split(',').filter(Boolean);
import { writeFileSync as w, mkdirSync as md } from 'node:fs';
let entry = 'src/index.ts';
if (only) {
  md(out, { recursive: true });
  entry = `src/.check-${process.pid}.tsx`;
  w(entry, `import './styles/base.css';\n${only.map((n) => `import { ${n}Demo } from './components/${n}/${n}.demo.tsx';\nexport * from './components/${n}/${n}.tsx';`).join('\n')}\nimport { createRoot } from 'react-dom/client';\nconst demos: Record<string, () => JSX.Element> = { ${only.map((n) => `${n}: ${n}Demo`).join(', ')} };\nexport function mount(name: string, el?: HTMLElement) { const D = demos[name]; const t = el ?? document.getElementById('root'); if (D && t) createRoot(t).render(<D />); }\n`);
}
await build({
  entryPoints: { bundle: entry },
  bundle: true, format: 'iife', globalName: 'Timefix', minify: true, target: 'es2022',
  outdir: out, jsx: 'automatic', loader: { '.svg': 'text', '.png': 'dataurl' },
  nodePaths: [uiModules, `${repo}node_modules`],
  alias: { react: `${uiModules}/react`, 'react-dom': `${uiModules}/react-dom` },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none', logLevel: 'warning',
});
// The artifact forbids a literal closing script tag or comment opener inside bundle.js.
import { readFileSync, writeFileSync } from 'node:fs';
const js = readFileSync(`${out}/bundle.js`, 'utf8').replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
writeFileSync(`${out}/bundle.js`, js);
if (only) { const { rmSync } = await import('node:fs'); rmSync(entry); }
console.log('built', (js.length / 1024).toFixed(0) + ' KB js', (readFileSync(`${out}/bundle.css`).length / 1024).toFixed(0) + ' KB css');
