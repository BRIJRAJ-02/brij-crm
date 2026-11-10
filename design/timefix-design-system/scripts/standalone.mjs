// Builds standalone/<name>.tsx into one self-contained HTML page: tokens, styles and script inline.
import { build } from '/Users/brijraj/Desktop/brijraj/crm/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
const [name, title, outFile] = process.argv.slice(2);
const tmp = `../standalone-out-${name}`;
await build({ entryPoints: { app: `standalone/${name}.tsx` }, bundle: true, format: 'iife', minify: process.env.NOMIN ? false : true, target: 'es2022', outdir: tmp, jsx: 'automatic',
  loader: { '.svg': 'text', '.png': 'dataurl' }, nodePaths: ['/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules', '/Users/brijraj/Desktop/brijraj/crm/node_modules'],
  alias: { react: '/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules/react', 'react-dom': '/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules/react-dom' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning' });
const t = JSON.parse(readFileSync('../ds/project/tokens.json', 'utf8'));
const v = (x, th) => (typeof x === 'string' ? x : x[th] ?? x.light);
const themed = (th) => [...t.color.tokens, ...t.shadow.tokens].map((c) => `--${c.name}:${v(c.value, th)};`).join('');
const other = ['spacing', 'radius', 'size', 'duration', 'easing', 'distance', 'scale', 'blur', 'zIndex', 'opacity', 'borderWidth'].filter((k) => t[k]).flatMap((k) => t[k].tokens).map((x) => `--${x.name}:${x.value};`).join('')
  + Object.entries(t.type.families).map(([k, s]) => `--font-${k}:${s};`).join('');
const tokens = `:root{${other}} :root,[data-theme="light"]{${themed('light')}} [data-theme="dark"]{${themed('dark')}}`;
let css = readFileSync(`${tmp}/app.css`, 'utf8');
const imports = (css.match(/@import url\([^)]*\);/g) ?? []).join('\n');
css = css.replace(/@import url\([^)]*\);/g, '');
const js = readFileSync(`${tmp}/app.js`, 'utf8').replaceAll('</script', '<\\/script');
// The Timefix mark as the tab icon, beside the page's title.
const mark = readFileSync('src/components/Logo/mark.svg', 'utf8').replace(/\s+/g, ' ').trim();
const icon = `data:image/svg+xml,${encodeURIComponent(mark)}`;
const html = `<title>${title}</title>
<link rel="icon" type="image/svg+xml" href="${icon}">
<script>try{var l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.href=${JSON.stringify(icon)};document.head.appendChild(l);}catch(e){}</script>
<style>${imports}
${tokens}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${themed('dark')} color-scheme: dark; } }
[data-theme="dark"] { color-scheme: dark; }
html, body { height: 100%; overflow: hidden; }
body { margin: 0; background: var(--canvas); color: var(--text); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
#root { height: 100%; }
*, *::before, *::after { box-sizing: border-box; }
${css.replaceAll('</style', '<\\/style')}</style>
<script>
/* Follow the viewer's theme: an explicit choice on the root wins; otherwise mirror the system setting so components keyed on [data-theme] match. */
(function () { try { var r = document.documentElement, m = window.matchMedia('(prefers-color-scheme: dark)'); var own = r.hasAttribute('data-theme'); var sync = function () { if (!own) r.setAttribute('data-theme', m.matches ? 'dark' : 'light'); }; sync(); m.addEventListener('change', sync); } catch (e) {} })();
</script>
<div id="root"></div>
<script>${js}</script>
`;
mkdirSync(outFile.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(outFile, html);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', outFile, (html.length / 1024).toFixed(0) + ' KB');
