import { open } from './head.mjs';
const { p, nav, done, res } = await open('light');
await nav('People'); await p.waitForTimeout(500);
await p.evaluate(() => { window.__log = []; const O = window.MutationObserver; new O((ms) => { for (const m of ms) { const t = m.target; if (t.nodeType === 1 && t.hasAttribute && t.hasAttribute('data-placement')) window.__log.push(m.type + ' ' + (m.oldValue || '').match(/top: [^;]*/)?.[0] + ' -> ' + t.style.top); } }).observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style'] }); });
await p.locator('main').getByRole('button', { name: /All people/ }).first().click(); await p.waitForTimeout(600);
res.push(JSON.stringify(await p.evaluate(() => window.__log)));
await done();
