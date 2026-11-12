import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, done } = await open(theme, 'clean.html');
await t('guest day picked', async () => {
  await nav('Booking pages'); await p.waitForTimeout(500);
  await p.getByText('Product demo', { exact: true }).first().click(); await p.waitForTimeout(700);
  await p.getByRole('button', { name: /See it as a guest/ }).first().click(); await p.waitForTimeout(1200);
  const d = p.locator('.tf-booking__day[data-selected]').first();
  console.log('selected', await d.textContent(), await d.evaluate((e) => getComputedStyle(e).backgroundColor));
  await p.screenshot({ path: `${out}fixday-${theme}.png` });
});
await done();
