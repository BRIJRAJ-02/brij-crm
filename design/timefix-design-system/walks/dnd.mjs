import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, nav, done } = await open(theme, process.argv[3] ?? 'clean.html'); p.on('console', (m) => { if (m.text().startsWith('[dnd]')) console.log(m.text()); });
const lane = (n) => p.locator('.tf-board__col').nth(n);
const card = (name) => p.locator('.tf-board__card').filter({ hasText: name }).first();
const names = async (n) => (await lane(n).locator('.tf-board__cardtitle').allTextContents()).join(' | ');
await t('setup', async () => { await nav('Deals'); await p.waitForTimeout(600); const b = p.getByRole('radio', { name: /Board/ }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(600); } });
await t('drop the sort', async () => { const x = p.getByRole('button', { name: /Remove sort/ }); if (await x.count()) { await x.first().click(); await p.waitForTimeout(500); } });
await t('within a lane: cards slide aside, drop reorders', async () => {
  console.log('Q before', await names(1));
  const a = await card('Globex platform').boundingBox(); const last = await lane(1).locator('.tf-board__card').last().boundingBox();
  await p.mouse.move(a.x + 60, a.y + 30); await p.mouse.down(); await p.mouse.move(a.x + 64, a.y + 40, { steps: 3 });
  await p.mouse.move(last.x + 60, last.y + last.height - 10, { steps: 20 }); await p.waitForTimeout(350);
  const ov = await p.locator('.tf-board__lifted').boundingBox(); console.log('overlay vs pointer', Math.round(ov.x - (last.x + 60)), Math.round(ov.y - (last.y + last.height - 10)), 'size', Math.round(ov.width), Math.round(a.width));
  const gap = await lane(1).locator('.tf-board__card[data-dragging]').boundingBox(); const tops = await lane(1).locator('.tf-board__card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))); console.log('gap', JSON.stringify(gap && { y: Math.round(gap.y), h: Math.round(gap.height) }), 'tops', tops.join(','));
  await p.screenshot({ path: `${out}dnd-${theme}-1-within.png` });
  await p.mouse.up(); await p.waitForTimeout(500);
  console.log('Q after', await names(1));
});
await t('across lanes: joins at the pointer', async () => {
  console.log('P before', await names(2));
  const a = await card('Wayne fleet').boundingBox(); const tgt = await lane(2).locator('.tf-board__card').first().boundingBox();
  await p.mouse.move(a.x + 60, a.y + 30); await p.mouse.down(); await p.mouse.move(a.x + 70, a.y + 40, { steps: 3 });
  await p.mouse.move(tgt.x + 60, tgt.y + tgt.height - 8, { steps: 25 }); await p.waitForTimeout(350);
  await p.screenshot({ path: `${out}dnd-${theme}-2-across.png` });
  await p.mouse.up(); await p.waitForTimeout(500);
  console.log('P after', await names(2)); console.log('toast', await p.locator('.tf-toast, [role=status]').allTextContents().then((x) => x.join(' / ').slice(0, 120)));
});
await t('click still opens', async () => { await card('Initech pilot').click(); await p.waitForTimeout(600); console.log('panel', await p.locator('.tf-rpanel[data-open]').count()); await p.keyboard.press('Escape'); await p.waitForTimeout(400); });
await t('keyboard drag on the grip', async () => {
  await card('Stark stores').hover(); const g = card('Stark stores').locator('.tf-board__grip'); await g.focus();
  await p.keyboard.press('Space'); await p.waitForTimeout(200); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); await p.keyboard.press('Space'); await p.waitForTimeout(600);
  console.log('P has Stark', await lane(2).getByText('Stark stores').count());
});
await done();
