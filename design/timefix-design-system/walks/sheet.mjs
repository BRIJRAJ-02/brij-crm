import { chromium } from './head.mjs'; import { readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('./sweep/', import.meta.url).pathname; const fs = readdirSync(dir).filter((f) => f.startsWith(process.argv[2] ?? 'fw-light-')).sort();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1300 } });
for (let k = 0; k < fs.length; k += 16) { const html = `<body style="margin:0;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font:12px sans-serif">${fs.slice(k, k + 16).map((f) => `<div><div>${f.slice(0, -4)}</div><img src="file://${dir}${f}" style="width:100%;border:1px solid #999"></div>`).join('')}</body>`;
  writeFileSync(dir + 'sheet.html', html); await p.goto('file://' + dir + 'sheet.html'); await p.waitForTimeout(500); await p.screenshot({ path: `${dir}${process.argv[3] ?? 'sheet'}${k / 16}.png`, fullPage: true }); }
await b.close();
