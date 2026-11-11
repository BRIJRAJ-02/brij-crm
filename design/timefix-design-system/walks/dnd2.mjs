import { open } from './head.mjs';
const { p, t, nav, done } = await open('light', 'clean.html');
await t('offset vs distance', async () => {
  await nav('Deals'); await p.waitForTimeout(600); const b = p.getByRole('radio', { name: /Board/ }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(600); }
  const c = p.locator('.tf-board__card').first(); const a = await c.boundingBox();
  const sx = a.x + 40, sy = a.y + 20; await p.mouse.move(sx, sy); await p.mouse.down();
  for (const [dx, dy] of [[10, 10], [100, 0], [0, 100], [300, 200], [600, 300]]) {
    await p.mouse.move(sx + dx, sy + dy, { steps: 8 }); await p.waitForTimeout(250);
    const o = await p.locator('.tf-board__lifted').boundingBox();
    console.log(`move ${dx},${dy} -> overlay off by`, Math.round(o.x - (a.x + dx)), Math.round(o.y - (a.y + dy)));
  }
  console.log('styles', await p.locator('.tf-board__lifted').evaluate((e) => { const w = e.parentElement; return w.getAttribute('style'); }));
  await p.keyboard.press('Escape'); await p.mouse.up();
});
await done();
