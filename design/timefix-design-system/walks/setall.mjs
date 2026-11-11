// Every Settings page, shot at 1440: checks nothing sits in a thin strip.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t, done } = await open(theme);
await p.locator('.tf-nav__label').filter({ hasText: /^Settings$/ }).first().click(); await p.waitForTimeout(500);
const names = [...new Set((await p.locator('.tf-nav__label').locator('visible=true').allInnerTexts()).map((s) => s.trim()))].filter((n) => n && !/^(Back to app|Search)$/.test(n));
for (const n of names) await t(n, async () => { await p.locator('.tf-nav__label').locator('visible=true').filter({ hasText: new RegExp(`^${n}$`) }).first().click(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}sa-${theme}-${n.replace(/\W+/g, '_')}.png` }); });
await done();
