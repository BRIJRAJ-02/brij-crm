import { open } from './head.mjs';
const { p, done, res } = await open('light', 'about:blank', 1440);
p.on('console', (m) => res.push('console ' + m.text()));
await p.addInitScript(() => { const o = MutationObserver; new o((ms) => { for (const m of ms) if (m.type === 'attributes' && String(m.target.className).includes('tf-assemble')) { console.log('hit ' + performance.now().toFixed(0)); } }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] }); });
await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(2500);
await done();
