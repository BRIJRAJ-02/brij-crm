// Every popup lines up with the control that opened it. For each trigger: open it, then measure the popup's nearest
// horizontal edge to the trigger's edge and the vertical gap between them (either side). Fails over 6px / 16px.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, done, res } = await open(theme);
const gap = async (trigger, name) => {
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await p.waitForTimeout(450);
  const a = await trigger.evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  const b = await p.evaluate(() => { const pop = [...document.querySelectorAll('[data-placement]')].pop(); if (!pop) return null; const r = pop.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, place: pop.getAttribute('data-placement') }; });
  if (!b) throw new Error(`${name}: no popup`);
  const dx = Math.round(Math.min(Math.abs(b.l - a.l), Math.abs(b.r - a.r), Math.abs((b.l + b.r) / 2 - (a.l + a.r) / 2)));
  const dy = Math.round(Math.min(Math.abs(b.t - a.b), Math.abs(a.t - b.b)));
  res.push(`  ${name} dx ${dx} dy ${dy} ${b.place}`); await p.screenshot({ path: `${out}popalign-${theme}-${name}.png` });
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  if (dx > 6 || dy > 16) throw new Error(`${name} off: dx ${dx} dy ${dy}`);
};
await t('view menu (left)', async () => { await nav('People'); await p.waitForTimeout(500); await gap(p.locator('main').getByRole('button', { name: /All people/ }).first(), 'view'); });
await t('sort (right)', async () => { await gap(p.locator('main').getByRole('button', { name: /^Sort/ }).first(), 'sort'); });
await t('workspace switcher (top)', async () => { await gap(p.locator('.tf-switcher').first(), 'switcher'); });
await t('account menu (bottom, opens up)', async () => { await gap(p.locator('.tf-sidebar__foot button').first(), 'account'); });
await t('select (Meetings filter)', async () => { await nav('Meetings'); await p.waitForTimeout(700); const sel = p.locator('main button[aria-haspopup="listbox"]').first(); await gap(sel, 'select');
  const w = await p.evaluate(() => { const pop = [...document.querySelectorAll('[data-placement]')].pop(); return pop ? pop.getBoundingClientRect().width : 0; }); });
await t('select width matches its trigger', async () => { const sel = p.locator('main button[aria-haspopup="listbox"]').first(); await sel.click(); await p.waitForTimeout(400);
  const [a, b] = await p.evaluate(() => [document.querySelector('main button[aria-expanded="true"]')?.getBoundingClientRect().width ?? 0, [...document.querySelectorAll('[data-placement]')].pop()?.getBoundingClientRect().width ?? 0]);
  res.push(`  select widths ${Math.round(a)} / ${Math.round(b)}`); await p.keyboard.press('Escape'); if (b + 2 < a) throw new Error('select narrower than its trigger'); });
await done();
