// Every sidebar page of the app (team, salon, restaurant), plus Bookings and Business pages: no page errors, and the page itself never scrolls.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, workspace, done } = await open(theme);
const still = async (n) => { const h = await p.evaluate(() => [document.scrollingElement.scrollHeight - innerHeight, document.scrollingElement.scrollWidth - innerWidth]); if (h[0] > 1 || h[1] > 1) throw new Error(`${n} page scrolls ${h}`); };
const pages = async (label) => { const count = await p.locator('.tf-nav__label').locator('visible=true').count(); const names = []; for (let i = 0; i < count; i++) names.push((await p.locator('.tf-nav__label').locator('visible=true').nth(i).innerText()).trim());
  for (const n of [...new Set(names)]) { if (!n || /^(Search)$/.test(n)) continue;
    await t(`${label} › ${n}`, async () => { await p.keyboard.press('Escape'); await p.locator('.tf-nav__label').locator('visible=true').filter({ hasText: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click(); await p.waitForTimeout(450); await still(n); }); }
  await p.screenshot({ path: `${out}smoke-${theme}-${label}.png` }); };
await pages('team');
// A fresh page for each workspace, so nothing a page left open blocks the switch.
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
await fresh(); await t('to salon', () => workspace('Appointments')); await pages('salon');
await fresh(); await t('to restaurant', () => workspace('Tables')); await pages('restaurant');
for (const u of ['bp.html', 'biz.html']) await t(u, async () => { await p.goto(`http://127.0.0.1:5391/${u}?r=${Date.now()}`); await p.waitForTimeout(1300); await still(u); });
await done();
