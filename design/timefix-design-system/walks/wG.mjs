// Wave G, three finishing fixes: a double-click edits a table cell without the record panel flashing open (a single click still
// opens it, once no second click follows); a Spanish form's own words (placeholders, Other, its line, hints); and a link page's
// popups wearing its look (a Night page's age gate dialog). Shots in sweep/wG-<theme>-*.png; fails loudly.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t: t0, nav, done } = await open(theme);
const t = (n, f) => t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wG-${theme}-FAIL-${n.split(' ')[0]}.png` }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); throw e; } });
const shot = (n) => p.screenshot({ path: `${out}wG-${theme}-${n}.png`, timeout: 12000 });
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();
const main = () => p.locator('main').last();
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
const panelOpen = async () => (await p.locator('.tf-rec__peekdock').count()) > 0;

await t('1 double-click edits without the panel; a click still opens it', async () => {
  await nav('Deals'); await p.waitForTimeout(500); await p.getByRole('radio', { name: 'Table' }).click(); await p.waitForTimeout(500);
  const row = (name) => p.locator('.tf-rec__grid [role=row]').filter({ hasText: name }).first();
  // Watch the whole double-click: the panel must never mount, not even for a frame.
  await p.evaluate(() => { window.__peeked = false; new MutationObserver(() => { if (document.querySelector('.tf-rec__peekdock')) window.__peeked = true; }).observe(document.body, { subtree: true, childList: true }); });
  for (const col of ['stage', 'name']) {
    await row('Wayne fleet').locator(`[data-edit$="|${col}"]`).dblclick(); await p.waitForTimeout(700);
    if (await p.evaluate(() => window.__peeked)) throw new Error(`the panel flashed open on a double-click (${col})`);
    await need(p.locator('.tf-grid__editor'), `editor open on ${col}`);
    if (col === 'stage') await shot('01-dblclick-edit');
    await esc(); await p.waitForTimeout(300);
  }
  if (await panelOpen()) throw new Error('the panel opened after a double-click');
  await row('Stark stores').locator('[data-edit$="|stage"]').click(); await p.waitForTimeout(800);
  if (!(await panelOpen())) throw new Error('a single click no longer opens the panel');
  await shot('02-click-opens'); await esc();
});

await t('2 Spanish form: placeholders, Other and its line, hints', async () => {
  await fresh(); await nav('Forms'); await p.waitForTimeout(500);
  const all = main().getByRole('button', { name: 'All forms' }); if (await all.count()) { await all.click(); await p.waitForTimeout(400); }
  await main().getByRole('link', { name: 'Talk to sales', exact: true }).click(); await p.waitForTimeout(700);
  await main().getByRole('tab', { name: /^Settings/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /Form language/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Spanish' }).click(); await p.waitForTimeout(300);
  await main().getByRole('radio', { name: 'Classic: one page' }).click(); await p.waitForTimeout(300);
  await main().getByRole('tab', { name: /^Questions/ }).click(); await p.waitForTimeout(600);
  const qset = main().locator('.tf-qset');
  await main().getByRole('listitem', { name: 'How big is your team?' }).first().click(); await p.waitForTimeout(500);
  await qset.getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(450);
  await qset.getByRole('switch', { name: 'Add Other' }).evaluate((e) => e.click()); await p.waitForTimeout(400);
  const form = main().locator('.tf-forms__preview');
  await need(form.locator('input[placeholder="Escribe tu respuesta"]'), 'Spanish placeholder');
  await need(form.locator('textarea[placeholder="Escribe tu respuesta"]'), 'Spanish long placeholder');
  await need(form.getByText('Mayús + Intro para una línea nueva'), 'Spanish new-line hint');
  await need(form.getByText('Pulsa una letra para elegir.'), 'Spanish letter hint');
  if (await form.locator('input[placeholder="Type your answer"], textarea[placeholder="Type your answer"]').count()) throw new Error('an English placeholder is left');
  await form.getByRole('radio', { name: 'Otro' }).evaluate((e) => e.click()); await p.waitForTimeout(400);
  await need(form.locator('input[placeholder="Escribe el tuyo"]'), 'Spanish Other line');
  await need(form.getByRole('textbox', { name: 'Otro, con tus palabras' }), 'Spanish Other label');
  await form.locator('input[placeholder="Escribe el tuyo"]').scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
  await form.screenshot({ path: `${out}wG-${theme}-03-spanish-form.png` });
  // The preview's last button is edited in place: its placeholder is the language's Submit.
  await need(form.locator('input[placeholder="Enviar"]').or(form.getByRole('button', { name: 'Enviar' })), 'Spanish submit');
});

await t('3 Night link page: the age gate dialog wears the page look', async () => {
  await fresh(); await nav('Links'); await p.waitForTimeout(500);
  await main().getByRole('button', { name: 'Edit page: Link page' }).or(main().getByRole('button', { name: 'Open Link page' })).first().click(); await p.waitForTimeout(800);
  if (await main().getByText('Claim your link').count()) { await main().getByRole('textbox', { name: 'Your link' }).fill('priya-raman'); await main().getByRole('button', { name: 'Claim' }).click(); await p.waitForTimeout(400); }
  const panel = () => main().locator('.tf-linked__pane[data-pos=current]');
  await main().getByRole('button', { name: 'Add block' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Video or music/ }).click(); await p.waitForTimeout(500);
  await panel().getByRole('textbox', { name: 'Address' }).fill('https://youtube.com/watch?v=calm'); await panel().getByRole('button', { name: 'More options', exact: true }).click(); await p.waitForTimeout(200);
  await panel().getByRole('button', { name: /Ask first/ }).click(); await p.waitForTimeout(200); await p.getByRole('option', { name: /18 and over/ }).click(); await p.waitForTimeout(300);
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /^Design/ }).click(); await p.waitForTimeout(500);
  await panel().getByRole('radio', { name: 'Night', exact: true }).click(); await p.waitForTimeout(300);
  await panel().locator('button').filter({ hasText: /^Modern$/ }).first().click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Editorial/ }).click(); await p.waitForTimeout(400);
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('toolbar', { name: 'Publish' }).getByRole('button', { name: 'Publish' }).click(); await p.waitForTimeout(1200);
  await main().getByRole('button', { name: 'See it as a guest' }).click(); await p.waitForTimeout(600);
  await main().getByRole('button', { name: /18\+/ }).first().click(); await p.waitForTimeout(500);
  await need(dialog().getByText(/18 or older/), 'age gate');
  const look = await p.locator('.tf-dialog').last().evaluate((e) => ({ theme: e.getAttribute('data-theme'), font: getComputedStyle(e.querySelector('.tf-dialog__title') ?? e).fontFamily, bg: getComputedStyle(e).backgroundColor }));
  const page = await p.locator('.tf-linkpage__name').last().evaluate((e) => getComputedStyle(e).fontFamily);
  if (look.theme !== 'dark') throw new Error(`the gate dialog is not dark: ${JSON.stringify(look)}`);
  if (look.font !== page) throw new Error(`the gate dialog's face ${look.font} is not the page's ${page}`);
  await shot('05-night-gate'); await esc();
  await main().getByRole('button', { name: 'Back to editing' }).click(); await p.waitForTimeout(300);
});
await done();
