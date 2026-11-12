import { open } from './head.mjs';
const { p, t, nav, done } = await open('light', process.argv[2] ?? 'clean.html');
await t('name opens peek', async () => { await nav('People'); await p.waitForTimeout(600);
  const c = p.getByRole('gridcell', { name: /Maria Bell/ }).first(); const bb = await c.boundingBox(); console.log('cell', JSON.stringify(bb));
  await p.getByText('Maria Bell', { exact: true }).first().click(); await p.waitForTimeout(700);
  console.log('peek open', await p.locator('.tf-rpanel[data-open]').count(), 'checked', await p.locator('[role=row][aria-selected=true]').count()); });
await done();
