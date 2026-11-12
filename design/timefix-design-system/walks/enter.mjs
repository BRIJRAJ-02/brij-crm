// The way in: frames of the dashboard assembling, on load and after setup. Checks the classes clear afterwards.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, done, res } = await open(theme, 'app.html', 1440);
await t('load frames', async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForSelector('.tf-assemble__surface', { state: 'attached', timeout: 5000 }); for (const ms of [0, 150, 300, 500, 800]) { await p.waitForTimeout(ms ? 150 : 0); await p.screenshot({ path: `${out}enter-${theme}-${ms}.png` }); }
  res.push('  blocks ' + await p.locator('.tf-assemble__block').count() + ' side ' + await p.locator('.tf-assemble__side').count());
  await p.waitForTimeout(2200); const left = await p.locator('.tf-assemble__block, .tf-assemble__side, .tf-assemble__surface').count(); if (left) throw new Error('left ' + left); await p.screenshot({ path: `${out}enter-${theme}-end.png` }); });
await done();
