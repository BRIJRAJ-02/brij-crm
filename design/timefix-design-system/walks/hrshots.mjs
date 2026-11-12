// House-rule pass shots: Settings, Meetings week/day/requests, form full preview, shared Insights. Args: tag theme width.
import { open, out } from './head.mjs';
const tag = process.argv[2] ?? 'before'; const theme = process.argv[3] ?? 'light'; const width = Number(process.argv[4] ?? 1440);
const { p, t, nav, done } = await open(theme, 'app.html', width);
const phone = width < 700;
const shot = (n) => p.screenshot({ path: `${out}hr-${tag}-${theme}-${width}-${n}.png`, timeout: 12000 });
const main = () => p.locator('main').last();
const tabbar = async (n) => { await p.locator('nav').getByText(n, { exact: true }).locator('visible=true').last().click(); await p.waitForTimeout(600); };
const go = async (n) => { if (!phone) { await nav(n); await p.waitForTimeout(600); return; } await tabbar('More'); await main().getByRole('button', { name: new RegExp('^' + n) }).first().click(); await p.waitForTimeout(600); };
const home = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
await t('settings', async () => {
  await go('Settings'); await shot('set-1-first');
  if (phone) { await main().getByRole('link', { name: 'General' }).first().click(); await p.waitForTimeout(600); await shot('set-2-page'); await main().getByRole('button', { name: 'All settings' }).click(); await p.waitForTimeout(400); await shot('set-3-back'); }
  else { await nav('General'); await p.waitForTimeout(600); await shot('set-2-page'); await nav('Members and teams'); await p.waitForTimeout(600); await shot('set-3-members'); }
});
await home();
await t('meetings', async () => {
  if (phone) { await tabbar('Bookings'); } else await go('Meetings');
  await shot('meet-1-list');
  await main().getByRole('radio', { name: 'Week', exact: true }).click(); await p.waitForTimeout(600); await shot('meet-2-week');
  if (phone) { await main().locator('.tf-week').evaluate((e) => { e.scrollLeft = 200; }); await p.waitForTimeout(200); await shot('meet-2b-week-scrolled'); }
  const day = main().getByRole('radio', { name: 'Day', exact: true }); if (await day.count()) { await day.click(); await p.waitForTimeout(600); await shot('meet-3-day'); }
});
await home();
await t('form preview', async () => {
  await go('Forms'); await main().getByRole('link', { name: 'Talk to sales', exact: true }).click(); await p.waitForTimeout(700);
  await main().getByRole('button', { name: 'More for this form' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Preview/ }).click(); await p.waitForTimeout(600);
  await shot('fp-1-desktop'); await p.getByRole('dialog', { name: 'Preview' }).getByRole('radio', { name: 'Phone' }).click(); await p.waitForTimeout(600); await shot('fp-2-phone');
});
await home();
await t('shared insights', async () => {
  await go('Insights'); const dlg = () => p.locator('[role=dialog]').last();
  await main().getByRole('button', { name: 'Share', exact: true }).click(); await p.waitForTimeout(300);
  await dlg().getByRole('textbox', { name: 'Name' }).fill('For the board'); await dlg().getByRole('button', { name: 'Create link' }).click(); await p.waitForTimeout(300);
  await dlg().getByRole('button', { name: 'Open' }).first().click(); await p.waitForTimeout(700);
  await shot('gp-1-shared'); const foot = p.locator('a', { hasText: 'Powered by' }).last(); await foot.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await shot('gp-2-foot');
});
await done();
