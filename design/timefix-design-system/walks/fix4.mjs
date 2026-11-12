import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, done } = await open(theme, process.argv[3] ?? 'app.html');
await t('people', async () => { await nav('People'); await p.waitForTimeout(600); await p.screenshot({ path: `${out}fix4-${theme}-1-bar.png` }); });
await t('peek', async () => { await p.getByRole('gridcell', { name: /Maria Bell/ }).first().click(); await p.waitForTimeout(700); await p.screenshot({ path: `${out}fix4-${theme}-2-peek.png` }); });
await t('edit', async () => { const c = p.getByRole('gridcell', { name: 'maria@acme.com' }).first(); await c.dblclick(); await p.waitForTimeout(500);
  const cell = await c.boundingBox(); const ed = await p.locator('.tf-grid__editor').boundingBox(); console.log('cell', JSON.stringify(cell), 'editor', JSON.stringify(ed));
  await p.screenshot({ path: `${out}fix4-${theme}-3-edit.png` }); });
await done();
