import { open } from './head.mjs';
const { p, done, res } = await open('light', 'app.html', 1440);
await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`);
for (let i = 0; i < 12; i++) { await p.waitForTimeout(100); res.push(i * 100 + ' ' + JSON.stringify(await p.evaluate(() => ({ b: document.querySelectorAll('.tf-assemble__block').length, s: document.querySelectorAll('.tf-assemble__side').length, m: !!document.querySelector('.tf-app__keep .tf-shell__main'), rm: matchMedia('(prefers-reduced-motion: reduce)').matches })))); }
await done();
