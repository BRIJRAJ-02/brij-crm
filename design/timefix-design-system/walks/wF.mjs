// Wave F, the finishing pass: calm question settings with chips, outcome-based Won/Lost, required-when on table cells, form language
// for answer checks, guest look fonts, Paste the page import, computed kinds, menu look on business and reservation pages, a fuller
// Insights log, and the QR "View menu". Every new screen and dialog shot once in sweep/wF-<theme>-*.png; fails loudly.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const only = process.argv[3];
const { p, t: t0, nav, done, res, workspace } = await open(theme);
const t = (n, f) => (only && !only.split(',').some((o) => n.startsWith(o)) ? Promise.resolve() : t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wF-${theme}-FAIL-${n.split(':')[0].replace(/\W+/g, '-')}.png` }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); throw e; } }));
const shot = (n) => p.screenshot({ path: `${out}wF-${theme}-${n}.png`, timeout: 12000 });
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const seen = async (loc, what) => { if (!(await loc.first().isVisible().catch(() => false))) throw new Error(`not visible: ${what}`); };
const unseen = async (loc, what) => { if (await loc.first().isVisible().catch(() => false)) throw new Error(`should be folded away: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();
const main = () => p.locator('main').last();
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500); };
const back = async () => { if (await p.getByText('Back to app').count()) { await p.getByText('Back to app').first().click(); await p.waitForTimeout(400); } };
const openForm = async (name) => { await nav('Forms'); await p.waitForTimeout(500); const all = main().getByRole('button', { name: 'All forms' }); if (await all.count()) { await all.click(); await p.waitForTimeout(400); } await main().getByRole('link', { name, exact: true }).click(); await p.waitForTimeout(700); };
const qset = () => main().locator('.tf-qset');
const fontOf = (sel) => p.locator(sel).first().evaluate((e) => getComputedStyle(e).fontFamily);

await t('1 calm questions: essentials, one More options, grouped, chips that open it', async () => {
  await openForm('Talk to sales');
  await need(main().getByRole('button', { name: /^Saves to Person › Name\. Open Saves to/ }), 'saves-to chip on a card');
  await need(main().getByRole('button', { name: /^Required\. Open the question/ }).first(), 'required chip on a card');
  await shot('01-cards-with-chips');
  await main().getByRole('listitem', { name: 'How big is your team?' }).first().click(); await p.waitForTimeout(500);
  for (const [loc, w] of [[qset().getByRole('button', { name: /Type$/ }), 'type'], [qset().getByRole('textbox', { name: 'Question' }), 'question'], [qset().getByRole('group', { name: 'Choices' }), 'choices'], [qset().getByRole('switch', { name: 'Required' }), 'required']]) await seen(loc, w);
  for (const [loc, w] of [[qset().getByRole('textbox', { name: /Description/ }), 'description'], [qset().getByRole('switch', { name: 'Add Other' }), 'Other'], [qset().getByText('Show only if'), 'show only if'], [qset().getByRole('switch', { name: 'Use in Insights' }), 'insights']]) await unseen(loc, w);
  await shot('02-question-calm');
  await qset().getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(450);
  for (const h of ['Answer rules', 'Logic and points', 'Saves to', 'Help text']) await seen(qset().getByRole('heading', { name: h, exact: true }), `group ${h}`);
  await seen(qset().getByRole('switch', { name: 'Add Other' }), 'Other under Answer rules'); await shot('03-more-options');
  await qset().getByRole('heading', { name: 'Saves to', exact: true }).scrollIntoViewIfNeeded(); await shot('03b-more-options-saves');
  await qset().getByRole('switch', { name: 'Add Other' }).evaluate((e) => e.click()); await p.waitForTimeout(200);
  await qset().getByRole('textbox', { name: /Description/ }).fill('Count everyone who would use it.'); await p.waitForTimeout(200);
  await need(qset().getByRole('group', { name: 'Set under More options' }).getByRole('button', { name: /^With Other/ }), 'chip in the panel');
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  const card = main().getByRole('listitem', { name: 'How big is your team?' }).first();
  await need(card.getByRole('button', { name: /^With Other/ }), 'With Other chip'); await need(card.getByRole('button', { name: /^Help text/ }), 'Help text chip');
  // A chip opens its question with More options open at its group.
  await main().getByRole('button', { name: /^Saves to Person › Name\. Open Saves to/ }).click(); await p.waitForTimeout(800);
  await seen(qset().getByRole('button', { name: 'Fewer options' }), 'fold opened by the chip'); await seen(qset().getByRole('button', { name: /Save answer to/ }), 'Save answer to in view');
  const focused = await p.evaluate(() => document.activeElement?.textContent ?? ''); if (focused !== 'Saves to') throw new Error(`chip did not focus its group: ${focused}`);
  await shot('04-chip-opens-group');
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(300);
  // A new date question: its answer rule shows as a chip.
  await main().getByRole('button', { name: 'Add question' }).click(); await p.waitForTimeout(400); await p.getByRole('searchbox', { name: 'Find a question type' }).fill('date'); await p.waitForTimeout(200); await p.getByRole('option', { name: 'Date', exact: true }).click(); await p.waitForTimeout(500);
  await qset().getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(400);
  await qset().getByRole('button', { name: /Earliest day/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Today' }).click(); await p.waitForTimeout(300);
  await need(qset().getByRole('button', { name: /^From today/ }), 'From today chip in the panel'); await shot('05-date-rule-chip');
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400); await need(main().getByRole('button', { name: /^From today\. Open Answer rules/ }), 'From today chip on the card');
  await p.getByRole('button', { name: 'Discard' }).first().click().catch(() => undefined); await p.waitForTimeout(300); if (await dialog().count()) { await dialog().getByRole('button').last().click(); await p.waitForTimeout(300); }
});
await t('1b booking page questions use the same calm settings', async () => {
  await nav('Booking pages'); await p.waitForTimeout(500);
  await main().getByRole('button', { name: 'Edit Product demo' }).click(); await p.waitForTimeout(700);
  await main().getByRole('tab', { name: 'Questions' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'Add question' }).click(); await p.waitForTimeout(400); await p.getByRole('option', { name: /How did you hear about us/ }).click(); await p.waitForTimeout(500);
  await need(qset().getByRole('button', { name: /^In Insights/ }), 'In Insights chip'); await unseen(qset().getByRole('switch', { name: 'Use in Insights' }), 'insights switch');
  await shot('06-booking-question'); await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
});
await t('1c link block: title and address first, the rest folded with chips', async () => {
  await nav('Links'); await p.waitForTimeout(500); await main().getByRole('button', { name: 'Edit page: Link page' }).or(main().getByRole('button', { name: 'Open Link page' })).first().click(); await p.waitForTimeout(800);
  const panel = () => main().locator('.tf-linked__pane[data-pos=current]');
  await p.locator('.tf-linked__row[data-drag-row]').first().click(); await p.waitForTimeout(500);
  await seen(panel().getByRole('textbox', { name: 'Title' }), 'title'); await seen(panel().getByRole('textbox', { name: 'Address' }), 'address');
  const fold = () => panel().locator('.tf-linked__more');
  await unseen(fold().getByRole('button', { name: /Shown as$/ }), 'Shown as'); await unseen(fold().getByRole('button', { name: /Icon$/ }), 'Icon'); await shot('07-link-calm');
  await panel().getByRole('button', { name: 'More options', exact: true }).click(); await p.waitForTimeout(400);
  await seen(panel().getByRole('heading', { name: 'Look' }), 'Look group'); await seen(panel().getByRole('heading', { name: 'When and who' }), 'When and who group');
  await fold().getByRole('button', { name: /Shown as$/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Tile/ }).click(); await p.waitForTimeout(300);
  await shot('08-link-more'); await panel().getByRole('button', { name: 'Fewer options' }).click(); await p.waitForTimeout(400);
  await need(panel().getByRole('button', { name: /^Tile\. Open More options/ }), 'Tile chip'); await shot('09-link-chip');
  await panel().getByRole('button', { name: /^Tile\. Open/ }).click(); await p.waitForTimeout(400); await seen(panel().getByRole('button', { name: 'Fewer options' }), 'chip opens the fold');
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
});
await t('3 link import: address says the real app fetches, Paste the page reads links from HTML', async () => {
  await main().getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: /Your page’s address/ }).fill('linktr.ee/priya'); await p.waitForTimeout(200);
  await need(dialog().getByText(/The real app opens this page/), 'real app fetches'); await shot('10-import-address');
  await dialog().getByRole('button', { name: /Paste the page instead/ }).click(); await p.waitForTimeout(200);
  const box = dialog().getByRole('textbox', { name: 'Your links' });
  if (!(await box.evaluate((e) => e === document.activeElement))) throw new Error('Paste the page instead did not focus the box');
  const html = '<main><h1>Priya Raman</h1><a href="https://dribbble.com/priya">My shots</a><a href="https://www.youtube.com/@priya">Watch my talks</a><a href="https://dribbble.com/priya/">My shots again</a><a href="https://shop.priya.design">Shop prints</a><a href="https://linktr.ee/s/about">Report</a><a href="https://linktr.ee/privacy">Privacy</a><a href="mailto:hi@priya.design">Email me</a></main>';
  const plain = 'Priya Raman\nMy shots\nWatch my talks\nShop prints\nEmail me';
  await box.evaluate((el, { html, plain }) => { const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', plain); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, { html, plain });
  await box.fill(plain); await p.waitForTimeout(200);
  await need(dialog().getByText('Page pasted with its links.'), 'html captured'); await shot('11-import-pasted');
  await dialog().getByRole('button', { name: 'Find links' }).click(); await p.waitForTimeout(300);
  const found = dialog().getByRole('list', { name: 'Links found' }).getByRole('listitem'); const n = await found.count();
  if (n !== 4) throw new Error(`expected 4 links (deduped, platform links dropped), found ${n}: ${(await found.allTextContents()).join(' / ')}`);
  await need(dialog().getByText('Watch my talks'), 'label from the page'); await shot('12-import-review');
  await dialog().getByRole('list', { name: 'Links found' }).getByRole('checkbox').nth(3).click({ force: true }); await p.waitForTimeout(150);
  await dialog().getByRole('button', { name: /^Add 3 links/ }).click(); await p.waitForTimeout(500);
  await need(main().locator('.tf-linked__row').filter({ hasText: 'Shop prints' }), 'imported block');
});
await t('4 fonts: link page Design offers the list, each in its face, and the preview takes it', async () => {
  const panel = () => main().locator('.tf-linked__pane[data-pos=current]');
  await main().getByRole('button', { name: /^Design/ }).click(); await p.waitForTimeout(500);
  await panel().getByRole('button', { name: /Font$/ }).click(); await p.waitForTimeout(300);
  for (const f of ['Phone’s own', 'Modern', 'Mono', 'Grotesk', 'Editorial', 'Classic', 'Friendly', 'Geometric', 'Display']) await need(p.getByRole('option', { name: f, exact: true }), `font ${f}`);
  const face = await p.getByRole('option', { name: 'Classic', exact: true }).locator('.tf-select__value-text').evaluate((e) => getComputedStyle(e).fontFamily);
  if (!/Newsreader/.test(face)) throw new Error(`Classic option not drawn in its face: ${face}`);
  await shot('13-link-fonts'); await p.getByRole('option', { name: 'Classic', exact: true }).click(); await p.waitForTimeout(400);
  const ff = await fontOf('.tf-linked__phone .tf-linkpage'); if (!/Newsreader/.test(ff)) throw new Error(`link page preview not in Classic: ${ff}`);
  const link = await p.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => /Fraunces/.test(l.href) && /Instrument\+Serif/.test(l.href)));
  if (!link) throw new Error('font packs stylesheet not in the page head');
  await p.waitForTimeout(800); res.push(`  info: Newsreader loaded ${await p.evaluate(() => document.fonts.check('16px Newsreader'))}`);
  await shot('14-link-font-preview'); await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(300);
});
await t('4b fonts: menu Design has Headings and Everything else, each previewed', async () => {
  await fresh(); await workspace('Tables'); await nav('Menu'); await p.waitForTimeout(700);
  await p.getByRole('radio', { name: /Design/ }).click(); await p.waitForTimeout(500);
  await main().getByRole('button', { name: /Headings$/ }).click(); await p.waitForTimeout(300); await shot('15-menu-heading-fonts');
  await p.getByRole('option', { name: 'Editorial', exact: true }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /Everything else$/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Friendly', exact: true }).click(); await p.waitForTimeout(400);
  const title = await fontOf('.tf-menupage__title'); const body = await fontOf('.tf-menupage');
  if (!/Fraunces/.test(title)) throw new Error(`menu title not Editorial: ${title}`); if (!/Bricolage/.test(body)) throw new Error(`menu body not Friendly: ${body}`);
  await p.getByRole('radio', { name: /Night/ }).click({ force: true }); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /Headings$/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Display', exact: true }).click(); await p.waitForTimeout(300);
  await shot('16-menu-fonts-preview');
  await p.locator('.tf-floatbar').getByRole('button', { name: 'Save' }).click({ force: true }); await p.waitForTimeout(500); await need(p.getByText('Design saved', { exact: false }), 'design saved');
});
await t('8 business and reservation guest pages wear the menu look', async () => {
  await nav('Your page').catch(() => nav('Booking pages')); await p.waitForTimeout(700);
  await main().getByRole('button', { name: 'See it as a guest' }).first().click(); await p.waitForTimeout(900);
  const page = p.locator('.tf-bkf-guestmode__page');
  const st = await page.evaluate((e) => ({ theme: e.getAttribute('data-theme'), surface: e.style.getPropertyValue('--surface'), bg: getComputedStyle(e).backgroundColor, font: getComputedStyle(e).fontFamily }));
  if (st.theme !== 'dark' || !/#16130F/i.test(st.surface)) throw new Error(`business page not in the Night look: ${JSON.stringify(st)}`);
  const head = await fontOf('.tf-venue__name'); if (!/Instrument Serif/.test(head)) throw new Error(`business name not in the Display heading face: ${head}`);
  await shot('17-business-page-look');
  // Its pickers open in the look too.
  const tc = p.locator('.tf-bkf-venue-table');
  await tc.getByRole('button', { name: /Guests/ }).first().click(); await p.waitForTimeout(400);
  const pop = await p.locator('.tf-popover').last().evaluate((e) => ({ theme: e.getAttribute('data-theme'), bg: getComputedStyle(e).backgroundColor }));
  if (pop.theme !== 'dark') throw new Error(`picker opened outside the look: ${JSON.stringify(pop)}`);
  await shot('17b-business-picker-look'); await esc();
  const see = tc.getByRole('button', { name: /^See / }); if (await see.count()) { await see.first().click(); await p.waitForTimeout(400); }
  await tc.locator('[role=radio], [role=checkbox], [role=option], [role=gridcell]').first().click(); await p.waitForTimeout(800);
  await need(p.getByText('Your details').first(), 'reservation details step');
  const st2 = await page.evaluate((e) => e.getAttribute('data-theme')); if (st2 !== 'dark') throw new Error('reservation step lost the look');
  const ink = await p.locator('.tf-venue-co__title').evaluate((e) => getComputedStyle(e).color); if (ink !== 'rgb(244, 238, 228)') throw new Error(`reservation title not in the look's words colour: ${ink}`);
  await shot('18-reservation-look');
  await p.getByRole('button', { name: /^Back to/ }).first().click(); await p.waitForTimeout(500);
});
await t('10 table QR: View menu', async () => {
  await nav('Menu'); await p.waitForTimeout(600); await p.getByRole('radio', { name: /QR codes/ }).click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'More for T3' }).click(); await p.waitForTimeout(300); await need(p.getByRole('menuitem', { name: /^View menu/ }), 'View menu'); await shot('19-qr-view-menu');
  await p.getByRole('menuitem', { name: /^View menu/ }).click(); await p.waitForTimeout(900); await need(p.locator('.tf-menupage'), 'menu as a guest');
  await shot('20-qr-guest-menu'); await p.getByRole('button', { name: /Back to Bookings/ }).click(); await p.waitForTimeout(400);
});
await t('2 form language: answer checks speak Spanish', async () => {
  await fresh(); await openForm('Talk to sales');
  await main().getByRole('tab', { name: /^Settings/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /Form language/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Spanish' }).click(); await p.waitForTimeout(300);
  // The builder's preview speaks the draft's language (See it as a guest shows the live form until it's published).
  await main().getByRole('tab', { name: /^Questions/ }).click(); await p.waitForTimeout(600);
  const form = main().locator('.tf-forms__preview');
  await form.getByRole('button', { name: /^Vale/ }).first().click(); await p.waitForTimeout(400);
  await need(form.getByText('Esta pregunta necesita una respuesta.'), 'Spanish required'); await shot('21-spanish-required');
  await form.getByRole('textbox', { name: /Your name/ }).fill('Ana'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  await form.getByRole('textbox', { name: /Work email/ }).fill('ana@'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  await need(form.getByText(/Ese correo parece incompleto/), 'Spanish email check'); await shot('22-spanish-email');
  await p.getByRole('button', { name: 'Discard' }).first().click().catch(() => undefined); await p.waitForTimeout(300); if (await dialog().count()) { await dialog().getByRole('button').last().click(); await p.waitForTimeout(300); }
});
await t('5 computed kinds: a formula stays a formula, said in one line', async () => {
  await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'More kinds' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Formula/ }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Double amount');
  const ed = dialog().locator('[contenteditable=true], textarea, input').nth(1); await ed.click(); await p.keyboard.type('2 * 3'); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Create formula' }).click(); await p.waitForTimeout(500);
  await p.getByRole('row', { name: /Double amount/ }).or(p.getByRole('listitem', { name: /Double amount/ })).first().click(); await p.waitForTimeout(500);
  await need(dialog().getByText(/It stays a formula: for a lookup or rollup, or a different result type, create a new attribute\./), 'kind note'); await shot('23-formula-kind'); await esc();
});
await t('6 won and lost by outcome: a second won stage counts on Home, a lost outcome asks why', async () => {
  const openTotal = async () => { await back(); await nav('Home'); await p.waitForTimeout(900); return (await main().locator('.tf-stat').filter({ hasText: 'Open pipeline' }).textContent()) ?? ''; };
  const before = await openTotal();
  await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400); await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('tab', { name: 'Configuration' }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Proposal outcome/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Won/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Qualified outcome/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Lost/ }).click(); await p.waitForTimeout(400);
  await shot('24-stage-outcomes');
  const after = await openTotal(); res.push(`  info: open pipeline ${before.replace(/\s+/g, ' ').slice(0, 60)} -> ${after.replace(/\s+/g, ' ').slice(0, 60)}`);
  if (before === after) throw new Error('Home open pipeline did not follow the outcomes');
  await shot('25-home-by-outcome');
  await nav('Deals'); await p.waitForTimeout(500); await p.getByRole('radio', { name: 'Table' }).click(); await p.waitForTimeout(500);
  const row = p.locator('.tf-rec__grid [role=row]').filter({ hasText: 'Wayne fleet' }).first();
  await row.locator('[data-edit$="|stage"]').dblclick(); await p.waitForTimeout(400);
  await p.locator('[role^=menuitem]').filter({ hasText: 'Qualified' }).first().click(); await p.waitForTimeout(900);
  await need(dialog().getByText(/Why was it lost\?/), 'lost reason by outcome'); await shot('26-lost-by-outcome'); await esc(2);
});
await t('7 required when: a cell edit that leaves it empty is refused in place, Esc puts it back', async () => {
  await fresh(); await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400); await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'New attribute' }).click(); await p.waitForTimeout(500);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Loss detail');
  await dialog().getByRole('button', { name: /Required when/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Stage' }).click(); await p.waitForTimeout(300);
  await dialog().locator('.tf-attributesettings__when').getByRole('button').nth(1).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Lost' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Create attribute' }).click(); await p.waitForTimeout(500);
  await back(); await nav('Deals'); await p.waitForTimeout(500); await p.getByRole('radio', { name: 'Table' }).click(); await p.waitForTimeout(500);
  const row = (n) => p.locator('.tf-rec__grid [role=row]').filter({ hasText: n }).first();
  await row('Stark stores').locator('[data-edit$="|stage"]').dblclick(); await p.waitForTimeout(400);
  await p.locator('.tf-grid__editor [role^=menuitem]').filter({ hasText: 'Lost' }).first().click(); await p.waitForTimeout(700);
  await need(p.locator('.tf-grid__refused').getByText(/Fill in Loss detail first: it is required when Stage is Lost\./), 'refused stage edit'); await shot('27-required-when-stage');
  await esc(); await p.waitForTimeout(300); if (await p.locator('.tf-grid__editor').count()) throw new Error('Esc left the editor open');
  if (!/Qualified/.test(await row('Stark stores').textContent())) throw new Error('stage changed despite the rule');
  if (await p.locator('.tf-rpanel[data-open]').count()) { await p.locator('.tf-rpanel[data-open]').getByRole('button', { name: 'Close', exact: true }).click(); await p.waitForTimeout(400); }
  // Clearing it on a lost deal, by keys (a click on a row opens its peek): the cell shows why.
  const col = await p.evaluate(() => { const th = [...document.querySelectorAll('.tf-rec__grid [role=columnheader]')].find((h) => /Loss detail/.test(h.textContent ?? '')); return th ? [...th.parentElement.children].indexOf(th) : -1; });
  if (col < 0) throw new Error('no Loss detail column');
  const cell = row('Hooli enterprise').locator(':scope > *').nth(col);
  const key = async (k) => { await cell.evaluate((e) => { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); e.focus(); }); await p.waitForTimeout(150); await p.keyboard.press(k); await p.waitForTimeout(400); };
  await key('Enter'); await p.keyboard.type('Budget moved'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  if (!/Budget moved/.test(await cell.textContent())) throw new Error('could not fill Loss detail');
  await key('Delete');
  await need(p.locator('.tf-grid__refused').getByText(/Loss detail is required now\./), 'refused clear'); await shot('28-required-when-clear');
  await esc(); await p.waitForTimeout(300); if (!/Budget moved/.test(await cell.textContent())) throw new Error('clear went through');
  await key('Enter'); await p.keyboard.press('Meta+A'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await need(p.locator('.tf-grid__refused'), 'refused typed clear'); await shot('29-required-when-typed'); await esc();
  if (!/Budget moved/.test(await cell.textContent())) throw new Error('typed clear went through');
});
await t('9 insights: the period before is full, deltas read true', async () => {
  await nav('Insights'); await p.waitForTimeout(700);
  const visits = (await main().locator('.tf-stat').filter({ hasText: 'Visits' }).first().textContent()) ?? '';
  const pct = /([+-]?\d+)%/.exec(visits); res.push(`  info: visits card ${visits.replace(/\s+/g, ' ').slice(0, 50)}`);
  if (!pct || Math.abs(Number(pct[1])) > 40) throw new Error(`Visits delta still looks inflated: ${visits}`);
  await shot('30-insights');
});
await done();
