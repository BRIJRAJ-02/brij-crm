// Measures React Aria's raw placement under the per-layer zoom with the correction script switched off.
import { open } from './head.mjs';
const { p, nav, done, res } = await open('light');
await p.addInitScript(() => { window.MutationObserver = class { observe() {} disconnect() {} }; });
await p.reload(); await p.waitForTimeout(1500);
await nav('People'); await p.waitForTimeout(500);
for (const name of [/All people/, /^Sort/]) {
  const tr = p.locator('main').getByRole('button', { name }).first(); await tr.click(); await p.waitForTimeout(500);
  res.push(name + ' ' + JSON.stringify(await p.evaluate(() => { const pop = [...document.querySelectorAll('[data-placement]')].pop(); const r = pop.getBoundingClientRect(); const t = document.querySelector('[aria-expanded="true"]').getBoundingClientRect(); return { style: pop.getAttribute('style'), pop: [r.left, r.top, r.width], trig: [t.left, t.bottom, t.right], z: [...(function* () { for (let n = pop; n; n = n.parentElement) yield getComputedStyle(n).zoom; })()].join(',') }; })));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
}
await done();
