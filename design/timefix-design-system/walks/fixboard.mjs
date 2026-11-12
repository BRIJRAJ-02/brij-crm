import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, done } = await open(theme, 'clean.html');
await t('deals board lanes full height, peek floats', async () => {
  await nav('Deals'); await p.waitForTimeout(600);
  const board = p.getByRole('radio', { name: /Board/ }); if (await board.count()) { await board.first().click(); await p.waitForTimeout(600); }
  const cols = await p.locator('.tf-board__col').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  const lists = await p.locator('.tf-board__list').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  console.log('col heights', cols.join(','), 'list heights', lists.join(','));
  const before = await p.locator('.tf-board').boundingBox();
  await p.locator('.tf-board__card').filter({ hasText: 'Pied Piper starter' }).first().click(); await p.waitForTimeout(700);
  const after = await p.locator('.tf-board').boundingBox();
  console.log('board width before/after', Math.round(before.width), Math.round(after.width));
  await p.screenshot({ path: `${out}fixboard-${theme}.png` });
  // drag Initech pilot into the bottom of Proposal lane (below its cards)
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  const card = p.locator('.tf-board__card').filter({ hasText: 'Initech pilot' }).first();
  const lane = p.locator('.tf-board__col').nth(2); const lb = await lane.boundingBox(); const cb = await card.boundingBox();
  await p.mouse.move(cb.x + 40, cb.y + 20); await p.mouse.down(); await p.mouse.move(cb.x + 60, cb.y + 40, { steps: 5 });
  await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height - 40, { steps: 15 }); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}fixboard-${theme}-drag.png` });
  await p.mouse.up(); await p.waitForTimeout(800);
  console.log('proposal now has initech', await lane.getByText('Initech pilot').count());
});
await done();
