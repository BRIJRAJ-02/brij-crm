import { open, out } from './head.mjs';
const { p, workspace, done, res } = await open('light', 'app.html', 1440);
await workspace('Appointments'); await p.locator('.tf-nav__label').filter({ hasText: /^Meetings$/ }).first().click(); await p.waitForTimeout(700);
const el = p.getByText('Haircut and blow dry').first(); await el.scrollIntoViewIfNeeded();
const box = await el.evaluate((e) => { let x = e; while (x && !String(x.className).includes('event')) x = x.parentElement; const r = (x ?? e).getBoundingClientRect(); return { cls: String(e.className), parent: x ? String(x.className) : '', x: r.x, y: r.y, w: r.width, h: r.height }; });
res.push(JSON.stringify(box));
await p.screenshot({ path: `${out}haircut.png`, clip: { x: Math.max(0, box.x / 1.25 - 40), y: Math.max(0, box.y / 1.25 - 40), width: 420, height: 200 } });
await done();
