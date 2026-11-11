import { open } from './head.mjs';
const { p, nav, done } = await open('light');
await nav('Meetings'); await p.waitForTimeout(600);
console.log('rows', await p.locator('main').last().locator('.tf-meetings__row').count(), await p.getByRole('button', { name: 'Show more' }).count(), await p.locator('.tf-bkf-more').innerText().catch(() => 'none'));
await done();
