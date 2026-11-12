// Builds standalone/<name>.tsx into one self-contained HTML page: tokens, styles and script inline.
import { build } from '/Users/brijraj/Desktop/brijraj/crm/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
const [name, title, outFile] = process.argv.slice(2);
const tmp = `../standalone-out-${name}`;

// React Aria places popovers from on-screen rects, but the popover layer draws at 88%, so every placed length would
// shrink again and land short of its trigger. Patch its maths at build time: measure the popover on screen too, divide
// the result by the popover's effective zoom, and size --trigger-width from the trigger's own layout width.
const zoomHelper = `
function __tfZoom(opts, r) {
  let z = 1;
  for (let n = opts.overlayNode; n && n.nodeType === 1; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
  if (!r || z === 1) return r;
  const d = (v) => (typeof v === 'number' ? v / z : v);
  const position = {};
  for (const k in r.position) position[k] = d(r.position[k]);
  return { ...r, position, maxHeight: d(r.maxHeight), arrowOffsetLeft: d(r.arrowOffsetLeft), arrowOffsetTop: d(r.arrowOffsetTop) };
}`;
const zoomFix = { name: 'zoom-fix', setup(b) {
  b.onLoad({ filter: /react-aria[\\/]dist[\\/]private[\\/]overlays[\\/]calculatePosition\.mjs$/ }, (a) => {
    let src = readFileSync(a.path, 'utf8');
    const head = 'function $954926fb6168ae2a$export$b3ceb0cbf1056d98(opts) {';
    const size = 'let overlaySize = $954926fb6168ae2a$var$getOffset(overlayNode, true);';
    if (!src.includes(head) || !src.includes(size)) throw new Error('zoom-fix: react-aria calculatePosition changed');
    src = src.replace(head, head + '\n    return __tfZoom(opts, __tfCalc(opts));\n}\nfunction __tfCalc(opts) {').replace(size, 'let overlaySize = $954926fb6168ae2a$var$getOffset(overlayNode, false);') + zoomHelper;
    return { contents: src, loader: 'js', resolveDir: a.path.replace(/[\\/][^\\/]*$/, '') };
  });
  b.onLoad({ filter: /react-aria-components[\\/]dist[\\/]private[\\/]Popover\.mjs$/ }, (a) => {
    const src = readFileSync(a.path, 'utf8'); const w = 'props.triggerRef.current.getBoundingClientRect().width';
    if (!src.includes(w)) throw new Error('zoom-fix: react-aria-components Popover changed');
    return { contents: src.replace(w, 'props.triggerRef.current.offsetWidth'), loader: 'js', resolveDir: a.path.replace(/[\\/][^\\/]*$/, '') };
  });
} };
await build({ entryPoints: { app: `standalone/${name}.tsx` }, bundle: true, format: 'iife', minify: process.env.NOMIN ? false : true, target: 'es2022', outdir: tmp, jsx: 'automatic',
  loader: { '.svg': 'text', '.png': 'dataurl' }, nodePaths: ['/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules', '/Users/brijraj/Desktop/brijraj/crm/node_modules'],
  alias: { react: '/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules/react', 'react-dom': '/Users/brijraj/Desktop/brijraj/crm/packages/ui/node_modules/react-dom' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning', plugins: [zoomFix] });
const t = JSON.parse(readFileSync('../ds/project/tokens.json', 'utf8'));
const v = (x, th) => (typeof x === 'string' ? x : x[th] ?? x.light);
const themed = (th) => [...t.color.tokens, ...t.shadow.tokens].map((c) => `--${c.name}:${v(c.value, th)};`).join('');
const other = ['spacing', 'radius', 'size', 'duration', 'easing', 'distance', 'scale', 'blur', 'zIndex', 'opacity', 'borderWidth'].filter((k) => t[k]).flatMap((k) => t[k].tokens).map((x) => `--${x.name}:${x.value};`).join('')
  + Object.entries(t.type.families).map(([k, s]) => `--font-${k}:${s};`).join('');
const tokens = `:root{${other}} :root,[data-theme="light"]{${themed('light')}} [data-theme="dark"]{${themed('dark')}}`;
let css = readFileSync(`${tmp}/app.css`, 'utf8');
// Font imports become <link> tags at the top: an @import left inside the bundle sits after other rules, where browsers ignore it.
const importRe = /@import\s*(?:url\()?\s*["']([^"']+)["']\s*\)?\s*;?/g;
const fontLinks = [...css.matchAll(importRe)].map((m) => `<link rel="stylesheet" href="${m[1]}">`).join('\n');
css = css.replace(importRe, '');
const imports = '';
const js = readFileSync(`${tmp}/app.js`, 'utf8').replaceAll('</script', '<\\/script');
// The Timefix mark as the tab icon, beside the page's title.
const mark = readFileSync('src/components/Logo/mark.svg', 'utf8').replace(/\s+/g, ' ').trim();
const icon = `data:image/svg+xml,${encodeURIComponent(mark)}`;
const html = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLinks}
<link rel="icon" type="image/svg+xml" href="${icon}">
<script>try{var l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.href=${JSON.stringify(icon)};document.head.appendChild(l);}catch(e){}</script>
<style>${imports}
${tokens}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${themed('dark')} color-scheme: dark; } }
[data-theme="dark"] { color-scheme: dark; }
/* The dashboard draws at 88% (owner, 11 Nov: 80% for smaller type and padding, then type 10% larger); public pages step back to 100%.
   The app and each overlay layer (popovers, menus, dialogs, toasts: React Aria portals them into body) are zoomed on
   their own, never the root, so React Aria measures the page in one coordinate space; the zoom-fix build plugin
   converts its placed lengths into each popover's own zoomed space. */
html:not([data-guest]) #root, html:not([data-guest]) body > :not(#root) { zoom: 0.88; }
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
