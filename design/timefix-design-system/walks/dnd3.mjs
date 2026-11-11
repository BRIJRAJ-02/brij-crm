import { open } from './head.mjs';
const { p, t, nav, done } = await open('light', 'clean.html');
p.on('console', (m) => { if (m.text().startsWith('[dnd]')) console.log(m.text()); });
await t('keyboard', async () => {
  await nav('Deals'); await p.waitForTimeout(600); const b = p.getByRole('radio', { name: /Board/ }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(600); }
  const card = p.locator('.tf-board__card').filter({ hasText: 'Stark stores' }).first(); await card.hover();
  const g = card.locator('.tf-board__grip'); await g.focus(); console.log('focused', await p.evaluate(() => document.activeElement?.getAttribute('aria-label')));
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  console.log('dragging?', await p.locator('.tf-board__card[data-dragging]').count(), 'lifted', await p.locator('.tf-board__lifted').count());
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400); await p.keyboard.press('Space'); await p.waitForTimeout(700);
  console.log('Proposal now', (await p.locator('.tf-board__col').nth(2).locator('.tf-board__cardtitle').allTextContents()).join(' | '), '| focus', await p.evaluate(() => document.activeElement?.getAttribute('aria-label')));
});
await t('offset', async () => {
  const c = p.locator('.tf-board__card').first(); const a = await c.boundingBox(); await p.mouse.move(a.x + 40, a.y + 20); await p.mouse.down();
  for (const [dx, dy] of [[100, 0], [600, 300]]) { await p.mouse.move(a.x + 40 + dx, a.y + 20 + dy, { steps: 8 }); await p.waitForTimeout(250); const o = await p.locator('.tf-board__lifted').boundingBox(); console.log(`move ${dx},${dy} off`, Math.round(o.x - (a.x + dx)), Math.round(o.y - (a.y + dy)), 'w', Math.round(o.width), Math.round(a.width)); }
  await p.keyboard.press('Escape'); await p.mouse.up();
});
await done();
