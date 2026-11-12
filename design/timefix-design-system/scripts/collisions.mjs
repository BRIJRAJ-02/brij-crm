// Fails when two component folders define rules for the same block (the first class of a selector).
// A parent placing a child (`.tf-cmd__item > .tf-person { flex: 1 }`) belongs to the parent and is fine.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
const owner = new Map();
for (const dir of readdirSync('src/components')) {
  const f = `src/components/${dir}/${dir}.css`;
  if (!existsSync(f)) continue;
  const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const sel of css.match(/[^{}]+(?=\{)/g) ?? []) for (const part of sel.split(',')) {
    const toks = part.match(/\.tf-[A-Za-z0-9_-]+/g); if (!toks) continue;
    const cls = toks[0].replace(/(__|--).*$/, ''); // the block this rule belongs to
    (owner.get(cls) ?? owner.set(cls, new Set()).get(cls)).add(dir);
  }
}
const bad = [...owner].filter(([, s]) => s.size > 1).map(([c, s]) => `${c}: ${[...s].join(', ')}`);
if (bad.length) { console.error('Class collisions (each folder must own its classes):\n  ' + bad.join('\n  ')); process.exitCode = 1; }
else console.log('collisions: none');
