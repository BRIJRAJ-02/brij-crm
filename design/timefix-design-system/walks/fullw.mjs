// Every sidebar page: does the content reach the main area's right edge? Flags pages whose content stops well short, and shoots each.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, workspace, done, res } = await open(theme);
const measure = () => p.evaluate(() => { const m = document.querySelector('main') ?? document.querySelector('[class*="__main"]'); if (!m) return 'no main'; const mr = m.getBoundingClientRect();
  let right = 0; for (const el of m.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue; if (r.right > right && r.right <= mr.right + 1) right = r.right; }
  return { main: Math.round(mr.right - mr.left), gap: Math.round(mr.right - right) }; });
const pages = async (label) => { const loc = p.locator('.tf-nav__label').locator('visible=true'); const names = [...new Set(await loc.allInnerTexts())].map((s) => s.trim()).filter((n) => n && n !== 'Search');
  for (const n of names) await t(`${label} › ${n}`, async () => { await p.keyboard.press('Escape'); await loc.filter({ hasText: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click(); await p.waitForTimeout(450);
    const m = await measure(); res.push(`   ${JSON.stringify(m)}`); await p.screenshot({ path: `${out}fw-${theme}-${label}-${n.replace(/\W+/g, '_')}.png`, scale: 'css' }); }); };
await pages('team');
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
await fresh(); await workspace('Appointments'); await pages('salon');
await fresh(); await workspace('Tables'); await pages('restaurant');
await done();
