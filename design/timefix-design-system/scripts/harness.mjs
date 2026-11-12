// A local page that mounts every demo (or ?only=Name) in one theme (?theme=dark), for screenshots.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const [tokensPath, out] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tokensPath, 'utf8'));
const v = (x, th) => (typeof x === 'string' ? x : x[th] ?? x.light);
let css = '';
for (const th of ['light', 'dark']) css += `[data-theme="${th}"]{${[...t.color.tokens, ...t.shadow.tokens].map((c) => `--${c.name}:${v(c.value, th)};`).join('')}}\n`;
const other = ['spacing', 'radius', 'size', 'duration', 'easing', 'zIndex', 'opacity', 'borderWidth'].flatMap((k) => t[k].tokens).map((x) => `--${x.name}:${x.value};`).join('');
css += `:root{${other}${Object.entries(t.type.families).map(([k, s]) => `--font-${k}:${s};`).join('')}}`;
writeFileSync(`${out}/tokens.css`, css);
const names = readdirSync('src/components').filter((n) => existsSync(`src/components/${n}/${n}.demo.tsx`)).sort();
writeFileSync(`${out}/index.html`, `<!doctype html><html data-theme="light"><meta charset=utf-8><link rel=stylesheet href="tokens.css"><link rel=stylesheet href="bundle.css?v=${Date.now()}"><style>body{margin:0;background:var(--surface)} h4{margin:0;padding:8px 12px;font:600 11px monospace;color:#888;border-top:1px solid #8884}</style><body><script src="bundle.js?v=${Date.now()}"></script><script>
const q=new URLSearchParams(location.search);document.documentElement.dataset.theme=q.get('theme')||'light';
const names=${JSON.stringify(names)}.filter(n=>!q.get('only')||q.get('only').split(',').includes(n));
for(const n of names){const h=document.createElement('h4');h.id=n;h.textContent=n;document.body.append(h);const d=document.createElement('div');if(q.get('w'))d.style.cssText='width:'+q.get('w')+'px;margin:0 auto;outline:1px dashed #8886';document.body.append(d);Timefix.mount(n,d);}
</script>`);
console.log('harness:', names.length);
