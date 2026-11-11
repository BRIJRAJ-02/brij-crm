import { open, out } from './head.mjs';
const { p, nav, done, res } = await open('light');
await nav('Deals'); await p.waitForTimeout(600);
const tr = p.locator('main [aria-haspopup]:visible, main [aria-expanded]:visible').filter({ hasText: /Filter/ }).first();
await tr.click(); await p.waitForTimeout(500);
res.push(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[data-placement], [role="menu"], [role="dialog"]')].map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, e.getAttribute('role'), String(e.className).slice(0, 40), Math.round(r.top), Math.round(r.bottom), e.style.maxHeight, getComputedStyle(e).maxHeight, getComputedStyle(e).overflowY]; }))));
res.push('inner ' + await p.evaluate(() => innerHeight));
await p.screenshot({ path: `${out}dbgfilter.png` });
await done();
