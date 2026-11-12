// Pixel diff of before/after pairs: changed pixel count and bounding box.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/brijraj/Desktop/brijraj/crm/node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs/package.json');
const { PNG } = require('pngjs');
const dir = new URL('./sweep/', import.meta.url).pathname;
for (const f of readdirSync(dir).filter((x) => x.startsWith('hr-before-'))) {
  const g = f.replace('before', 'after');
  let a, b; try { a = PNG.sync.read(readFileSync(dir + f)); b = PNG.sync.read(readFileSync(dir + g)); } catch { continue; }
  if (a.width !== b.width || a.height !== b.height) { console.log(f, 'SIZE', a.width, a.height, b.width, b.height); continue; }
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) { const i = (y * a.width + x) * 4; if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  if (n) console.log(f.replace('hr-before-', ''), n, `box ${x0},${y0}-${x1},${y1}`);
}
