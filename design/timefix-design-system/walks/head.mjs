// Shared walk setup: a browser, a page in a theme, a step runner and the app's sidebar nav.
import { createRequire } from 'node:module';
const require = createRequire('/Users/brijraj/Desktop/brijraj/crm/packages/ui/package.json');
export const { chromium } = require('playwright');
export const out = new URL('./sweep/', import.meta.url).pathname;
export async function open(theme, url = 'app.html', width = 1440) {
  const b = await chromium.launch(); const errs = []; const res = [];
  const p = await b.newPage({ viewport: { width, height: 900 }, colorScheme: theme }); p.setDefaultTimeout(4000); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:5391/${url}?r=${Date.now()}`); await p.waitForTimeout(1500);
  const t = async (n, f) => { try { await f(); res.push('ok ' + n); } catch (e) { res.push('FAIL ' + n + ': ' + String(e.message).split('\n').slice(0, 3).join(' | ')); } };
  const nav = (n) => p.locator('nav').getByText(n, { exact: true }).locator('visible=true').first().click();
  const workspace = async (kind) => { await p.keyboard.press('Meta+k'); await p.keyboard.type('First run'); await p.waitForTimeout(200); await p.keyboard.press('Enter'); await p.waitForTimeout(500); await p.getByRole('button', { name: new RegExp('^' + kind) }).click(); await p.waitForTimeout(900); };
  const done = async () => { console.log(res.join('\n')); console.log('errors', JSON.stringify(errs.slice(0, 5))); await b.close(); };
  return { b, p, t, nav, workspace, done, res };
}
