// Settings widths and panes at a width: the layout's own width against the app body's, and which pane shows.
import { open } from './head.mjs';
const width = Number(process.argv[2] ?? 390);
const { p, nav, done } = await open('light', 'app.html', width);
if (width < 700) { await p.locator('nav').getByText('More', { exact: true }).locator('visible=true').last().click(); await p.waitForTimeout(500); await p.locator('main').last().getByRole('button', { name: /^Settings/ }).first().click(); }
else { await nav('Settings'); }
await p.waitForTimeout(600);
const m = () => p.evaluate(() => { const s = document.querySelector('.tf-settings'); const b = document.querySelector('.tf-app__body'); const c = s?.querySelector(':scope > .tf-settings__content'); const n = s?.querySelector(':scope > :not(.tf-settings__content)');
  const cs = b ? getComputedStyle(b) : undefined; return { set: s?.getBoundingClientRect().width, body: b ? b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : undefined, content: c && getComputedStyle(c).display, contentPad: c && getComputedStyle(c).padding, nav: n && getComputedStyle(n).display, navW: n?.getBoundingClientRect().width }; });
console.log('list', JSON.stringify(await m()));
if (width < 700) { await p.locator('main').last().getByRole('link', { name: 'General' }).first().click(); await p.waitForTimeout(500); console.log('page', JSON.stringify(await m())); }
await done();
