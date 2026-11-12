// Wave H: a computed attribute changes kind (a formula switched to a rollup: the warning, the confirm, every value worked out again,
// Undo; a switch that changes the result type names and drops the view sort that no longer fits), and a Spanish form's last English
// guest words (the phone's country picker, the Country question's names, the thank-you read-back). Shots in sweep/wH-<theme>-*.png.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t: t0, nav, done, res } = await open(theme);
const t = (n, f) => t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wH-${theme}-FAIL-${n.split(' ')[0]}.png` }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); throw e; } });
const shot = (n) => p.screenshot({ path: `${out}wH-${theme}-${n}.png`, timeout: 12000 });
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();
const main = () => p.locator('main').last();
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
const back = async () => { if (await p.getByText('Back to app').count()) { await p.getByText('Back to app').first().click(); await p.waitForTimeout(400); } };
/** The Deals table's cells under one column, by its header's name. */
const column = async (name) => p.evaluate((n) => {
  const grid = document.querySelector('.tf-rec__grid');
  const heads = [...(grid?.querySelectorAll('[role=columnheader]') ?? [])];
  const idx = heads.findIndex((h) => (h.textContent ?? '').trim().startsWith(n)); if (idx < 0) return [];
  return [...grid.querySelectorAll('tr[role=row]')].filter((r) => r.querySelector('[role=gridcell]')).map((r) => (r.querySelectorAll(':scope > td, :scope > th')[idx]?.textContent ?? '').trim()).slice(0, 6);
}, name);
const openDeals = async () => { await back(); await nav('Deals'); await p.waitForTimeout(500); await p.getByRole('radio', { name: 'Table' }).click(); await p.waitForTimeout(500); };
const openAttr = async (name) => { await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400); await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('row', { name: new RegExp(name) }).or(p.getByRole('listitem', { name: new RegExp(name) })).first().click(); await p.waitForTimeout(500); };

await t('1 formula to rollup: warning, confirm, values worked out again', async () => {
  await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'More kinds' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Formula/ }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Double amount');
  const ed = dialog().locator('[contenteditable=true], textarea, input').nth(1); await ed.click(); await p.keyboard.type('2 * 3'); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Create formula' }).click(); await p.waitForTimeout(500);
  await openDeals(); const before = await column('Double amount');
  if (!before.length || !before.every((x) => x === '6')) throw new Error(`formula values not 6: ${JSON.stringify(before)}`);
  await openAttr('Double amount');
  if (await dialog().getByText(/It stays a formula/).count()) throw new Error('the old "It stays a formula" line is still there');
  await dialog().getByRole('button', { name: /Kind/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Rollup/ }).click(); await p.waitForTimeout(400);
  await need(dialog().getByText(/Views, filters and sorts on it keep working only if the result type stays the same/), 'the warning');
  await need(dialog().getByRole('button', { name: /Through/ }), 'rollup settings: through'); await need(dialog().getByRole('button', { name: /Work out/ }), 'rollup settings: work out');
  await need(dialog().getByText(/^Gives/), 'rollup preview'); await shot('01-switch-to-rollup');
  // The ask is in the same dialog (no dialog on a dialog): the warning says what happens, the main button names the change.
  await need(dialog().getByText(/get this value worked out again/), 'the warning says every value is worked out again');
  if (await dialog().getByText(/These go when you save/).count()) throw new Error('a same-type switch should drop nothing');
  if (await p.getByRole('alertdialog').count()) throw new Error('a second dialog opened on top');
  await shot('02-confirm'); await dialog().getByRole('button', { name: 'Make it a rollup' }).click(); await p.waitForTimeout(600);
  await need(p.getByText(/Double amount is a rollup now · \d+ values worked out again/), 'toast with the count'); await shot('03-toast');
  await openDeals(); const after = await column('Double amount');
  if (!after.length || after.some((x) => x === '6') || !after.every((x) => /^\d+$/.test(x))) throw new Error(`values not worked out again: ${JSON.stringify(after)}`);
  res.push(`  info: Double amount ${JSON.stringify(before)} -> ${JSON.stringify(after)}`); await shot('04-recomputed');
});

await t('2 rollup to lookup: the sort that no longer fits is named, dropped, and Undo brings it back', async () => {
  // Sort the open view by the rollup, then switch it to a lookup (text): the sort is listed in the confirm.
  await p.getByRole('columnheader', { name: /Double amount/ }).click(); await p.waitForTimeout(400);
  const sortOn = async () => (await p.getByRole('columnheader', { name: /Double amount/ }).getAttribute('aria-sort')) ?? 'none';
  if ((await sortOn()) === 'none') { await p.getByRole('columnheader', { name: /Double amount/ }).click(); await p.waitForTimeout(400); }
  const save = main().getByRole('button', { name: /^Save( view| for everyone)?$/ });
  if (await save.count()) { await save.first().click(); await p.waitForTimeout(500); }
  res.push(`  info: sort on Double amount: ${await sortOn()}`);
  await openAttr('Double amount');
  await dialog().getByRole('button', { name: /Kind/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Lookup/ }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('button', { name: /Show their/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Industry' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText(/gives text now/), 'the warning says the result type changes');
  await need(dialog().getByText(/These go when you save/), 'drop list'); await need(dialog().getByText(/View “.+”: its sort/), 'the view sort named');
  await shot('05-confirm-drops'); await dialog().getByRole('button', { name: 'Make it a lookup' }).click(); await p.waitForTimeout(600);
  await need(p.getByText(/Double amount is a lookup now/), 'lookup toast');
  await openDeals();
  if ((await sortOn()) !== 'none') throw new Error('the sort on it was not dropped');
  const looked = await column('Double amount'); if (looked.some((x) => /^\d+$/.test(x))) throw new Error(`lookup values not worked out: ${JSON.stringify(looked)}`);
  await shot('06-lookup-no-sort');
  const undos = await p.getByRole('button', { name: 'Undo' }).count();
  await p.locator('.tf-toast, [role=status], [role=alert]').filter({ hasText: /is a lookup now/ }).getByRole('button', { name: 'Undo' }).first().click(); await p.waitForTimeout(600);
  res.push(`  info: undo buttons ${undos}`);
  await nav('Home'); await p.waitForTimeout(300); await openDeals();
  const undone = await column('Double amount');
  if (!undone.every((x) => /^\d+$/.test(x))) throw new Error(`Undo did not bring the rollup back: ${JSON.stringify(undone)}`);
  if ((await sortOn()) === 'none') throw new Error('Undo did not bring the sort back');
  res.push(`  info: lookup ${JSON.stringify(looked.slice(0, 3))}, after Undo ${JSON.stringify(undone.slice(0, 3))}, sort ${await sortOn()}`);
});

await t('3 Spanish form: phone country picker, Country question, thank-you read-back', async () => {
  await fresh(); await nav('Forms'); await p.waitForTimeout(500);
  const all = main().getByRole('button', { name: 'All forms' }); if (await all.count()) { await all.click(); await p.waitForTimeout(400); }
  await main().getByRole('link', { name: 'Talk to sales', exact: true }).click(); await p.waitForTimeout(700);
  await main().getByRole('tab', { name: /^Settings/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /Form language/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Spanish' }).click(); await p.waitForTimeout(300);
  await main().getByRole('radio', { name: 'Classic: one page' }).click(); await p.waitForTimeout(300);
  await main().getByRole('tab', { name: /^Questions/ }).click(); await p.waitForTimeout(600);
  const qset = main().locator('.tf-qset');
  for (const [find, opt] of [['phone', 'Phone'], ['country', 'Country'], ['yes', 'Yes or no']]) {
    await main().getByRole('button', { name: 'Add question' }).click(); await p.waitForTimeout(400);
    await p.getByRole('searchbox', { name: 'Find a question type' }).fill(find); await p.waitForTimeout(200); await p.getByRole('option', { name: opt, exact: true }).click(); await p.waitForTimeout(500);
    await qset.getByRole('textbox', { name: 'Question' }).fill(opt === 'Phone' ? 'Teléfono' : opt === 'Country' ? 'País' : '¿Quieres una demo?'); await p.waitForTimeout(200);
    await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  }
  await main().getByRole('listitem', { name: 'How big is your team?' }).first().click(); await p.waitForTimeout(500);
  await qset.getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(450);
  await qset.getByRole('switch', { name: 'Add Other' }).evaluate((e) => e.click()); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  // The full page preview takes answers and shows the thank you.
  await main().getByRole('button', { name: 'More for this form' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Preview/ }).click(); await p.waitForTimeout(700);
  const form = p.locator('.tf-hform').last();
  // The phone's country picker.
  await form.locator('.tf-phone__code').locator('visible=true').first().click(); await p.waitForTimeout(500);
  await need(p.locator('input[placeholder="País o prefijo"]'), 'Spanish search placeholder');
  await need(p.getByRole('searchbox', { name: 'Buscar países' }), 'Spanish search name');
  for (const c of ['Estados Unidos', 'Reino Unido', 'Alemania', 'España']) await need(p.getByRole('option', { name: new RegExp(`^${c}`) }), `country ${c}`);
  await need(p.getByRole('option', { name: /\+44/ }), 'dial code kept'); await shot('10-phone-picker');
  await p.keyboard.type('zzz'); await p.waitForTimeout(300); await need(p.getByText('Ningún país coincide.'), 'Spanish no match'); await shot('11-phone-nomatch');
  await p.locator('.tf-phone__search-input').fill('Espa'); await p.waitForTimeout(300); await p.getByRole('option', { name: /^España/ }).click(); await p.waitForTimeout(500);
  await need(form.getByRole('button', { name: /Prefijo del país/ }), 'Spanish chip name');
  await form.locator('.tf-phone__input').fill('612345678'); await p.waitForTimeout(200);
  // The Country question: names in Spanish, sorted with the Spanish collator.
  await form.locator('.tf-hq__trigger').last().click(); await p.waitForTimeout(500);
  const names = await p.locator('.tf-hq__options [role=option]').allTextContents();
  const sorted = [...names].sort(new Intl.Collator('es-ES').compare);
  if (!names.includes('España') || !names.includes('Estados Unidos') || names.includes('United States')) throw new Error(`country names not Spanish: ${names.slice(0, 6).join(', ')}`);
  if (names.join('|') !== sorted.join('|')) throw new Error(`not sorted: ${names.slice(0, 6).join(', ')}`);
  await shot('12-country-list'); await p.getByRole('option', { name: 'España', exact: true }).click(); await p.waitForTimeout(400);
  // Fill the rest and send.
  await form.getByRole('textbox', { name: /Your name/ }).fill('Ana'); await form.getByRole('textbox', { name: /Work email/ }).fill('ana@ejemplo.com');
  await form.getByRole('radio', { name: 'Otro' }).evaluate((e) => e.click()); await p.waitForTimeout(300); await form.locator('input[placeholder="Escribe el tuyo"]').fill('nueve');
  await form.getByRole('radio', { name: 'Sí' }).evaluate((e) => e.click()); await p.waitForTimeout(200);
  await form.locator('.tf-hform__submit').click(); await p.waitForTimeout(1200);
  const sent = p.locator('.tf-hform__sent').last(); await need(sent, 'sent answers');
  const text = (await sent.textContent()) ?? '';
  for (const w of ['Otro: nueve', 'España', 'Sí', '+34']) if (!text.includes(w)) throw new Error(`read-back lacks ${w}: ${text}`);
  for (const w of ['Other:', 'Spain', 'Yes']) if (text.includes(w)) throw new Error(`read-back still English (${w}): ${text}`);
  await sent.scrollIntoViewIfNeeded(); await shot('13-readback');
  await p.getByRole('button', { name: 'Back to editor' }).click(); await p.waitForTimeout(400);
});
await done();
