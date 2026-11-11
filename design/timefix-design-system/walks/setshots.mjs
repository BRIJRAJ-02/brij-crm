import { open, out } from './head.mjs';
const { p, t, done } = await open(process.argv[2] ?? 'light');
await p.locator('.tf-nav__label').filter({ hasText: /^Settings$/ }).first().click(); await p.waitForTimeout(500);
for (const n of ['Profile', 'Preferences', 'General', 'Brand', 'Members and teams', 'Apps and connections', 'Availability', 'Objects', 'API keys']) await t(n, async () => { await p.locator('.tf-nav__label').filter({ hasText: new RegExp(`^${n}$`) }).first().click(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}set-${n.replace(/\W+/g, '_')}.png` }); });
await done();
