// The whole way in: sign in with a new email, the code, what you book, every setup step, You're live, then the app.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light'; const w = Number(process.argv[3] ?? 1440); const kind = process.argv[4] ?? 'Meetings';
const { p, t, done, res } = await open(theme, 'app.html', w);
const tag = kind.toLowerCase().slice(0, 4);
const shot = (n) => p.screenshot({ path: `${out}su-${tag}-${theme}-${w}-${n}.png` });
await t('sign in', async () => { await p.keyboard.press('Meta+k'); await p.keyboard.type('Sign in'); await p.waitForTimeout(250); await p.keyboard.press('Enter'); await p.waitForTimeout(700); await shot('01-signin'); });
await t('code', async () => { await p.getByRole('textbox', { name: 'Email' }).fill('maya.rao@lumen.studio'); await p.getByRole('button', { name: 'Continue with email' }).click(); await p.waitForTimeout(700); await shot('02-code'); await p.keyboard.type('123456'); await p.waitForTimeout(1400); });
await t('kind', async () => { await shot('03-kind'); await p.getByRole('radio', { name: new RegExp(kind) }).click({ force: true }); await p.waitForTimeout(300); await shot('03b-kind'); await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(700); });
await t('setup', async () => { let n = 4; for (;;) { if (n === 4) await p.keyboard.type('Lumen Studio'); await p.waitForTimeout(700); await shot(String(n).padStart(2, '0'));
  if (await p.getByRole('button', { name: 'Add another' }).count()) { const fin = p.getByRole('button', { name: /Finish setup/ }); const y0 = (await fin.boundingBox())?.y ?? 0; const ys = [];
    await p.getByRole('button', { name: 'Add another' }).click(); for (let i = 0; i < 8; i++) { await p.waitForTimeout(40); ys.push(Math.round((await fin.boundingBox())?.y ?? 0)); }
    res.push('  finish y ' + y0 + ' -> ' + ys.join(',')); await p.waitForTimeout(300); await shot(String(n).padStart(2, '0') + 'b'); await fin.click(); break; }
  const skip = p.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); else await p.getByRole('button', { name: 'Continue' }).click(); n++; if (n > 12) throw new Error('too many steps'); }
  await p.waitForTimeout(1200); await shot('20-live'); await p.getByRole('button', { name: 'Go to dashboard' }).click(); await p.waitForTimeout(900); await shot('21-app'); });
await done();
