// Wave D2: smooth drag everywhere, business, menus, services, staff, shifts, table QR, reservations, managed pages. Fails loudly.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const only = process.argv[3];
const { p, t, nav, workspace, done } = await open(theme);
const shot = (n) => p.screenshot({ path: `${out}wD2-${theme}-${n}.png` });
const must = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const settings = async (label) => { if (!(await p.getByText('Back to app').count())) { await nav('Settings'); await p.waitForTimeout(400); } await p.locator('.tf-settings, main').getByRole('button', { name: new RegExp(`^${label}`) }).or(p.getByRole('link', { name: new RegExp(`^${label}$`) })).first().click(); await p.waitForTimeout(500); };
const go = (n) => !only || only.split(',').includes(n);

const main = () => p.locator('main');
const back = async () => { if (await p.getByText('Back to app').count()) { await p.getByText('Back to app').click(); await p.waitForTimeout(400); } };
const drag = async (from, to, dy = -6) => { await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox(); const b = await to.boundingBox(); await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.mouse.move(a.x + a.width / 2 + 4, a.y + a.height / 2 + 8, { steps: 3 }); await p.mouse.move(b.x + 40, b.y + (dy < 0 ? b.height + dy : dy), { steps: 18 }); await p.waitForTimeout(350); };
if (go('drag')) {
  await t('drag: a SortableList by pointer, keyboard and Esc, with announcements', async () => {
    await settings('Objects'); const rows = p.locator('.tf-sortable__row'); const names = async () => (await rows.locator('strong').allTextContents()).join('|');
    const before = await names(); await rows.nth(0).hover(); await drag(rows.nth(0).locator('.tf-drag-handle'), rows.nth(2)); await shot('drag-sortable');
    if (!(await p.locator('.tf-drag-lift').count())) throw new Error('no lifted copy'); if (!(await p.locator('[data-drag-row][data-dragging]').count())) throw new Error('no dashed gap');
    await p.mouse.up(); await p.waitForTimeout(500); const after = await names(); if (after === before) throw new Error('pointer drop did not reorder');
    await rows.nth(0).locator('.tf-drag-handle').focus(); await p.keyboard.press('Space'); await p.waitForTimeout(250);
    const said = await p.locator('[id^="DndLiveRegion"], [role=status][aria-live]').allTextContents(); if (!/Picked up|position \d+ of \d+/.test(said.join(' '))) throw new Error('no announcement: ' + said.join(' / ').slice(0, 80));
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300); await p.keyboard.press('Space'); await p.waitForTimeout(500); if ((await names()) === after) throw new Error('keyboard did not reorder');
    const k = await names(); await rows.nth(0).locator('.tf-drag-handle').focus(); await p.keyboard.press('Space'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    if ((await names()) !== k) throw new Error('Esc did not put it back');
    await p.getByText('Back to app').click(); await p.waitForTimeout(400);
  });
  await t('drag: form questions and link page blocks move the same way', async () => {
    await back(); await nav('Forms'); await p.waitForTimeout(500); const allf = main().getByRole('button', { name: 'All forms' }); if (await allf.count()) { await allf.click(); await p.waitForTimeout(300); }
    await main().getByRole('link', { name: 'Talk to sales', exact: true }).click(); await p.waitForTimeout(700); const qt = main().getByRole('tab', { name: /Questions/ }); if (await qt.count()) { await qt.click(); await p.waitForTimeout(400); }
    const q = p.locator('.tf-qlist__row'); const t0 = (await q.nth(0).locator('.tf-qlist__q').textContent()).trim();
    await drag(q.nth(0).locator('.tf-drag-handle'), q.nth(1)); await shot('drag-questions'); await p.mouse.up(); await p.waitForTimeout(500);
    if ((await q.nth(0).locator('.tf-qlist__q').textContent()).trim() === t0) throw new Error('question did not move');
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Discard' }).first().click({ force: true }).catch(() => undefined); await p.waitForTimeout(500); if (await p.getByRole('dialog').count()) { await p.getByRole('dialog').getByRole('button').filter({ hasText: /Discard|Leave/ }).first().click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(300); }
    await nav('Links'); await p.waitForTimeout(500); await main().getByRole('button', { name: 'Edit page: Link page' }).or(main().getByRole('button', { name: 'Open Link page' })).first().click(); await p.waitForTimeout(800);
    const b = p.locator('.tf-linked__row[data-drag-row]'); const b0 = (await b.nth(0).locator('.tf-linked__title').textContent()).trim();
    await drag(b.nth(0).locator('.tf-drag-handle'), b.nth(1)); await shot('drag-blocks'); await p.mouse.up(); await p.waitForTimeout(500);
    if ((await b.nth(0).locator('.tf-linked__title').textContent()).trim() === b0) throw new Error('block did not move');
  });
  await t('drag: a status stage moves into another group inside a dialog', async () => {
    await back(); await settings('Objects'); await p.locator('.tf-sortable__row').filter({ hasText: 'Deals' }).getByRole('button').last().click(); await p.waitForTimeout(600);
    await p.getByRole('button', { name: /^Edit Stage/ }).or(p.getByRole('button', { name: /Stage/ })).first().click(); await p.waitForTimeout(600);
    const groups = p.locator('.tf-optionseditor__group'); if ((await groups.count()) < 3) throw new Error('no stage groups');
    const src = groups.nth(1).locator('[data-drag-row]').first(); const name = await src.locator('input').inputValue(); const tgt = (await groups.nth(2).locator('[data-drag-row]').count()) ? groups.nth(2).locator('[data-drag-row]').first() : groups.nth(2).locator('ul');
    await drag(src.locator('.tf-drag-handle'), tgt); const ov = await p.locator('.tf-drag-lift').boundingBox(); const tb = await tgt.boundingBox();
    if (!ov || Math.abs(ov.y - tb.y) > 60) throw new Error(`lifted copy not under the pointer: ${ov && Math.round(ov.y)} vs ${Math.round(tb.y)}`);
    await shot('drag-stages'); await p.mouse.up(); await p.waitForTimeout(500);
    const inDone = await groups.nth(2).locator('input').evaluateAll((els) => els.map((e) => e.value)); if (!inDone.includes(name)) throw new Error(name + ' did not join Done');
    await p.getByRole('dialog').getByRole('button', { name: 'Cancel' }).last().click({ force: true }); await p.waitForTimeout(400); while (await p.getByRole('dialog').count()) { const x = p.getByRole('dialog').getByRole('button', { name: /Discard|Leave|Close|Cancel/ }).first(); if (!(await x.count())) break; await x.click({ force: true }); await p.waitForTimeout(300); }
    await back();
  });
  await t('drag: reduced motion keeps the drag but drops the slide', async () => {
    await p.emulateMedia({ reducedMotion: 'reduce' }); await p.reload(); await p.waitForTimeout(1200); await settings('Objects');
    const rows = p.locator('.tf-sortable__row'); await rows.nth(0).hover(); await drag(rows.nth(0).locator('.tf-drag-handle'), rows.nth(2));
    const tr = await rows.nth(1).evaluate((e) => e.style.transition); await p.mouse.up(); await p.waitForTimeout(300);
    if (tr && tr !== 'none' && tr !== '') throw new Error('rows still slide: ' + tr);
    await p.emulateMedia({ reducedMotion: 'no-preference' }); await p.getByText('Back to app').click(); await p.waitForTimeout(400);
  });
}
if (go('biz')) {
  await t('business: profile, places, setup', async () => {
    await workspace('Appointments'); await settings('Business');
    await must(p.getByRole('heading', { name: 'Businesses' }), 'Businesses section'); await must(p.getByRole('heading', { name: 'Places' }), 'Places');
    await shot('biz-home');
  });
  await t('business: add with the setup card, switch back, copy, remove asks', async () => {
    await p.getByRole('button', { name: 'Add business' }).click(); await p.waitForTimeout(300);
    const dlg = p.getByRole('dialog'); await dlg.getByLabel('Name').fill('Lumen Juhu'); await dlg.getByLabel('Address of the first place').fill('22 Juhu Tara Road'); await shot('biz-card');
    await p.getByRole('button', { name: 'Create business' }).click(); await p.waitForTimeout(500);
    await must(p.getByText('Lumen Juhu added and shown'), 'added toast');
    await must(p.getByText('Finish setting up Lumen Juhu'), 'business setup card'); await shot('biz-setup');
    await settings('Services'); await must(p.getByText('Set up Appointments'), 'appointments checklist'); await shot('svc-setup'); await settings('Business');
    await p.getByRole('button', { name: 'Switch' }).first().click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'More for Lumen Juhu' }).click(); await p.getByRole('menuitem', { name: /Remove business/ }).click(); await p.waitForTimeout(300);
    await must(p.getByRole('dialog').getByText(/stops working/), 'remove asks'); await shot('biz-remove'); await p.getByRole('button', { name: 'Remove business' }).click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'More for Lumen Hair Studio' }).click(); await p.getByRole('menuitem', { name: /Copy business/ }).click(); await p.waitForTimeout(300); await shot('biz-copy');
    await p.getByRole('button', { name: 'Make copy' }).click(); await p.waitForTimeout(400); await must(p.getByText('Lumen Hair Studio copy'), 'copy row');
  });
  await t('apps: turning one off asks, shows what depends on it, admins only', async () => {
    await settings('Apps and connections'); await must(p.getByText('Only owners and admins turn apps on or off.'), 'admins line');
    await p.getByRole('switch', { name: 'Appointments' }).click({ force: true }); await p.waitForTimeout(300);
    await must(p.getByRole('dialog').getByText(/Clients and Roster leave Bookings/), 'dependencies'); await shot('apps-off'); await p.getByRole('button', { name: 'Turn off' }).click(); await p.waitForTimeout(400);
    await must(p.getByText('Appointments is off'), 'off toast'); await p.getByRole('switch', { name: 'Appointments' }).click({ force: true }); await p.waitForTimeout(300); await settings('Business');
  });
  await t('business: profile save', async () => {
    await p.getByLabel('Website').fill('lumen.studio'); await p.getByRole('button', { name: 'Save', exact: true }).first().click(); await p.waitForTimeout(300); await must(p.getByText('Profile saved'), 'saved');
  });
  await t('business: a place page with special days', async () => {
    await p.getByRole('button', { name: /^Open Bandra/ }).click(); await p.waitForTimeout(400);
    await must(p.getByRole('heading', { name: /hours/ }), 'hours'); await p.getByRole('button', { name: 'Add special day' }).click(); await p.waitForTimeout(300);
    await p.getByRole('dialog').getByLabel('Note').fill('Diwali'); await shot('biz-specialday'); await p.getByRole('button', { name: 'Add day' }).click(); await p.waitForTimeout(400);
    await must(p.getByText(/Diwali/), 'special day row'); await shot('biz-place');
    await p.getByRole('button', { name: 'Lumen Hair Studio', exact: true }).click(); await p.waitForTimeout(300);
  });
  await t('business: the page as a draft, gallery drag, publish', async () => {
    await p.getByRole('button', { name: 'Edit page' }).click(); await p.waitForTimeout(500);
    await must(p.getByRole('heading', { name: 'Gallery' }), 'gallery'); await must(p.getByRole('heading', { name: 'Amenities' }), 'amenities');
    await p.getByRole('checkbox', { name: 'Parking' }).or(p.getByRole('button', { name: 'Parking' })).first().click(); await p.waitForTimeout(300);
    const tiles = p.locator('.tf-bizset__photo[data-drag-row]'); const n = await tiles.count(); if (n < 2) throw new Error('gallery tiles ' + n);
    const g = tiles.nth(0).locator('.tf-drag-handle'); await tiles.nth(0).scrollIntoViewIfNeeded(); const a = await g.boundingBox(); const b = await tiles.nth(1).boundingBox();
    await p.mouse.move(a.x + 10, a.y + 10); await p.mouse.down(); await p.mouse.move(a.x + 20, a.y + 14, { steps: 3 }); await p.mouse.move(b.x + b.width - 20, b.y + 40, { steps: 15 }); await p.waitForTimeout(300);
    await shot('biz-gallery-drag'); await p.mouse.up(); await p.waitForTimeout(400);
    await must(p.getByText(/unpublished|Publish/), 'publish bar'); await shot('biz-page');
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Publish', exact: true }).click({ force: true }); await p.waitForTimeout(1200); await shot('biz-published');
    if (await p.getByRole('dialog').count()) await p.keyboard.press('Escape');
  });
}
if (go('svc')) {
  await t('services: categories, drag across, bulk, archive and restore', async () => {
    if (await p.getByText('Back to app').count()) { await p.getByText('Back to app').click(); await p.waitForTimeout(400); } await workspace('Appointments'); await settings('Services');
    await must(p.getByRole('region', { name: 'Hair' }), 'Hair category'); await shot('svc');
    const rows = p.getByRole('region', { name: 'Hair' }).locator('[data-drag-row]'); const src = rows.nth(0); await src.scrollIntoViewIfNeeded();
    const name = (await src.locator('strong').first().textContent()).trim();
    const g = src.locator('.tf-drag-handle'); const a = await g.boundingBox(); const tgt = p.getByRole('region', { name: 'Colour' }).locator('[data-drag-row]').nth(0); const b = await tgt.boundingBox();
    await p.mouse.move(a.x + 8, a.y + 10); await p.mouse.down(); await p.mouse.move(a.x + 12, a.y + 20, { steps: 3 }); await p.mouse.move(b.x + 80, b.y + b.height - 6, { steps: 20 }); await p.waitForTimeout(350);
    await shot('svc-drag'); await p.mouse.up(); await p.waitForTimeout(500);
    if (!(await p.getByRole('region', { name: 'Colour' }).getByText(name).count())) throw new Error(name + ' did not move to Colour');
    await p.locator('.tf-bizset__svc .tf-check').nth(0).click(); await p.locator('.tf-bizset__svc .tf-check').nth(1).click(); await p.waitForTimeout(300);
    await must(p.locator('.tf-floatbar').getByText(/selected/), 'bulk bar'); await shot('svc-bulk');
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Archive' }).click({ force: true }); await p.waitForTimeout(400);
    await must(p.getByRole('button', { name: /Archived · / }), 'archived fold'); await p.getByRole('button', { name: /Archived · / }).click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Restore' }).first().click(); await p.waitForTimeout(300);
  });
  await t('services: drawer with what it needs and a cancellation note', async () => {
    await p.getByRole('button', { name: 'New service' }).click(); await p.waitForTimeout(400);
    const d = p.getByRole('dialog'); await d.getByLabel('Name').fill('Scalp ritual'); await must(d.getByText('What it needs'), 'needs'); await d.getByLabel(/Cancellation note/).fill('Cancel up to a day before.');
    await shot('svc-drawer'); await d.getByRole('button', { name: /Add service/ }).click(); await p.waitForTimeout(500); await must(p.getByText('Scalp ritual').first(), 'new service');
  });
  await t('services: category asks before delete', async () => {
    await p.getByRole('button', { name: 'More for Treatments' }).click(); await p.getByRole('menuitem', { name: /Delete category/ }).click(); await p.waitForTimeout(300);
    await must(p.getByRole('dialog').getByText(/Other services/), 'delete asks'); await shot('svc-delcat'); await p.getByRole('button', { name: 'Cancel' }).click();
  });
}
if (go('staff')) {
  await t('staff: list in order, add, profile', async () => {
    if (await p.getByText('Back to app').count()) { await p.getByText('Back to app').click(); await p.waitForTimeout(400); } await workspace('Appointments'); await settings('Staff and shifts');
    await must(p.getByRole('list', { name: 'Staff, in order' }), 'staff list'); await shot('staff');
    await p.getByRole('button', { name: 'Add staff' }).click(); const d = p.getByRole('dialog'); await d.getByLabel('Name').fill('Meera Joshi'); await d.getByLabel(/Title/).fill('Nail artist');
    await d.getByRole('button', { name: 'Add and open' }).click(); await p.waitForTimeout(500);
    await must(p.getByText(/Regular week at/), 'regular week'); await must(p.getByLabel('Member link'), 'member link'); await shot('staff-profile');
    await p.getByLabel('Bio', { exact: false }).fill('Gel and nail art.'); await p.waitForTimeout(200); await must(p.getByRole('button', { name: 'Save' }), 'save bar');
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Save' }).click({ force: true }); await p.waitForTimeout(900);
    await p.getByRole('button', { name: /Archive Meera/ }).click(); await p.waitForTimeout(300); await must(p.getByRole('dialog').getByText(/leave every service/), 'archive asks'); await shot('staff-archive');
    await p.getByRole('dialog').getByRole('button', { name: 'Archive' }).click(); await p.waitForTimeout(500);
  });
  await t('staff: archive refused while visits are to come', async () => {
    await p.getByRole('button', { name: 'More for Jo Mendes' }).click(); await p.getByRole('menuitem', { name: /Archive/ }).click(); await p.waitForTimeout(300);
    await must(p.getByRole('dialog').getByText(/to come/), 'refused'); await p.getByRole('button', { name: 'OK' }).click();
  });
  await t('shifts: place week, a date, copy to all weeks, copy to others, block time', async () => {
    await p.getByRole('radio', { name: /Shifts/ }).click(); await p.waitForTimeout(400); await must(p.locator('.tf-bizset__grid'), 'grid'); await shot('shifts');
    await p.locator('.tf-bizset__cell').nth(2).click(); await p.waitForTimeout(300); await shot('shifts-day'); await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(300);
    if (!(await p.locator('.tf-bizset__cell[data-own]').count())) throw new Error('own date not marked');
    await p.getByRole('button', { name: /^Shifts for / }).first().click(); await p.getByRole('menuitem', { name: 'Copy this week to all weeks' }).click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: /^Shifts for / }).first().click(); await p.getByRole('menuitem', { name: /Copy shifts to others/ }).click(); await p.waitForTimeout(300);
    await p.getByRole('dialog').getByRole('checkbox').first().click({ force: true }); await shot('shifts-copy'); await p.getByRole('dialog').getByRole('button', { name: /^Copy to/ }).click(); await p.waitForTimeout(300);
    const unlinked = p.getByRole('button', { name: 'Shifts for Meera Joshi' }); // archived, so not here; use the first person without a member link if any
    await p.getByRole('button', { name: /^Shifts for / }).last().click(); await p.waitForTimeout(200); const blk = p.getByRole('menuitem', { name: /Block time/ });
    if (await blk.isDisabled()) { await p.keyboard.press('Escape'); } else { await blk.click(); await p.waitForTimeout(300); await shot('shifts-block'); await p.getByRole('dialog').getByRole('button', { name: 'Block time' }).click(); }
  });
}
if (go('menu')) {
  await t('menu: structure, section drag, item drag across sections', async () => {
    await back(); await workspace('Tables'); await nav('Menu'); await p.waitForTimeout(700);
    await must(p.getByRole('list', { name: /sections in order/ }), 'sections list'); await shot('menu');
    const secs = p.getByRole('list', { name: /sections in order/ }).locator(':scope > li');
    const first = (await secs.nth(0).locator('h3').textContent()).trim();
    await drag(secs.nth(0).locator('.tf-bkf-menued__head .tf-drag-handle'), secs.nth(1)); await shot('menu-secdrag'); await p.mouse.up(); await p.waitForTimeout(500);
    const now = (await secs.nth(0).locator('h3').textContent()).trim(); if (now === first) throw new Error('section did not move');
    const items0 = secs.nth(0).locator('.tf-bkf-dish[data-drag-row]'); const name = (await items0.nth(0).locator('.tf-bkf-dish__name').textContent()).trim();
    await drag(items0.nth(0).locator('.tf-drag-handle'), secs.nth(1).locator('.tf-bkf-dish[data-drag-row]').nth(0)); await shot('menu-itemdrag'); await p.mouse.up(); await p.waitForTimeout(500);
    if (!(await secs.nth(1).getByText(name, { exact: false }).count())) throw new Error(name + ' did not move across');
  });
  await t('menu: sub section, search, preview at a day and time', async () => {
    const secs = p.getByRole('list', { name: /sections in order/ }).locator(':scope > li');
    await secs.nth(0).getByRole('button', { name: /^More for / }).first().click(); await p.getByRole('menuitem', { name: 'Add sub section' }).click(); await p.waitForTimeout(300);
    await p.getByRole('dialog').getByLabel('Name').fill('From the grill'); await p.getByRole('dialog').getByRole('button', { name: 'Create' }).click(); await p.waitForTimeout(400);
    await must(p.getByText('From the grill').first(), 'sub section'); await must(p.getByText('From the grill').nth(1), 'sub section in preview? (optional)').catch(() => {});
    await p.locator('.tf-bkf__toolbar').getByRole('searchbox').fill('octopus'); await p.waitForTimeout(400); await shot('menu-search');
    if ((await p.locator('.tf-bkf-dish[data-drag-row]').count()) > 3) throw new Error('search did not narrow');
    await p.locator('.tf-bkf__toolbar').getByRole('searchbox').fill(''); await p.waitForTimeout(300);
    await must(p.getByText('Preview at'), 'preview at'); await shot('menu-previewat');
  });
  await t('menu: settings with serving times per day and places', async () => {
    await p.getByRole('button', { name: 'More for this menu' }).click(); await p.getByRole('menuitem', { name: 'Menu settings' }).click(); await p.waitForTimeout(400);
    const d = p.getByRole('dialog'); await must(d.getByText('Served at', { exact: true }), 'places');
    const sw = d.getByRole('switch', { name: /Served at set times/ }); if (!(await sw.isChecked())) await sw.click({ force: true }); else { await sw.click({ force: true }); await sw.click({ force: true }); }
    await p.waitForTimeout(300); await must(d.getByText('Monday'), 'per day hours'); await shot('menu-settings'); await d.getByRole('button', { name: /Save/ }).last().click(); await p.waitForTimeout(400);
  });
  await t('menu: item drawer with photo crop, Add another and Cmd+Enter', async () => {
    const secs = p.getByRole('list', { name: /sections in order/ }).locator(':scope > li');
    await secs.nth(0).getByRole('button', { name: 'Add item' }).first().click(); await p.getByRole('menuitem', { name: 'New item' }).click(); await p.waitForTimeout(500);
    let d = p.getByRole('dialog'); await d.getByLabel('Name').fill('Grilled corn'); await d.getByRole('textbox', { name: 'Price' }).fill('350'); await d.getByRole('textbox', { name: 'Price' }).press('Tab');
    await d.getByRole('button', { name: 'Add a photo' }).click(); await p.waitForTimeout(400); await must(p.getByRole('dialog', { name: 'Item photo' }), 'photo cropper'); await shot('menu-photocrop'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await shot('menu-item'); await p.getByRole('button', { name: 'Add another' }).click(); await p.waitForTimeout(500);
    await must(p.getByText('Grilled corn added', { exact: false }), 'saved toast');
    d = p.getByRole('dialog'); await d.getByLabel('Name').fill('Charred leeks'); await d.getByRole('textbox', { name: 'Price' }).fill('420'); await d.getByRole('textbox', { name: 'Price' }).press('Tab'); await d.getByLabel('Name').press('Meta+Enter'); await p.waitForTimeout(500);
    if (await p.getByRole('dialog').count()) throw new Error('Cmd+Enter did not save');
    await must(p.getByText('Charred leeks').first(), 'second item');
  });
  await t('menu: Items tab with the Available switch', async () => {
    await p.getByRole('radio', { name: /Items/ }).click(); await p.waitForTimeout(400); await must(p.getByRole('heading', { name: 'All items' }), 'all items');
    const sw = p.locator('.tf-bkf-items').getByRole('switch').first(); await sw.click({ force: true }); await p.waitForTimeout(300); await must(p.getByText(/sold out|back on/), 'toast'); await shot('menu-items');
  });
  await t('menu: Design with presets, colours, AA check, corners', async () => {
    await p.getByRole('radio', { name: /Design/ }).click(); await p.waitForTimeout(500); await must(p.getByRole('list', { name: 'Contrast checks' }), 'AA checks');
    await p.getByRole('radio', { name: /Bistro/ }).click({ force: true }); await p.waitForTimeout(300); await shot('menu-design');
    await p.getByRole('radio', { name: 'Round' }).click({ force: true }); await p.locator('.tf-floatbar').getByRole('button', { name: 'Save' }).click({ force: true }); await p.waitForTimeout(500); await must(p.getByText('Design saved', { exact: false }), 'design saved');
  });
  await t('menu: publish review with checks', async () => {
    await p.getByRole('radio', { name: /Structure/ }).click(); await p.waitForTimeout(400);
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Publish', exact: true }).click({ force: true }); await p.waitForTimeout(400);
    await must(p.getByRole('list', { name: 'Checks' }), 'checks'); await shot('menu-review');
    const pub = p.getByRole('dialog').getByRole('button', { name: /^Publish/ }); if (await pub.isEnabled()) { await pub.click(); await p.waitForTimeout(400); await must(p.getByText('Your menu is live'), 'live'); await shot('menu-live'); }
    await p.keyboard.press('Escape');
  });
}
if (go('qr')) {
  await t('table QR: zone chips, selection, scans, print sheet in tiles and tent cards', async () => {
    await back(); await workspace('Tables'); await nav('Menu'); await p.waitForTimeout(600); await p.getByRole('radio', { name: /QR codes/ }).click(); await p.waitForTimeout(500);
    await must(p.getByRole('radio', { name: /^All · / }).or(p.getByRole('checkbox', { name: /^All · / })), 'zone chips'); await shot('qr');
    await p.getByText(/^Terrace · /).first().click(); await p.waitForTimeout(300); await must(p.getByText(/^4 of 9 tables/), 'zone filter');
    await p.locator('.tf-bkf-qrcard .tf-check').first().click(); await p.waitForTimeout(200); await must(p.getByText(/1 selected/), 'selection');
    await p.getByRole('button', { name: 'More for T6' }).click(); await p.getByRole('menuitem', { name: /Analytics/ }).click(); await p.waitForTimeout(300); await must(p.getByText('Last 30 days'), 'scans'); await shot('qr-scans'); await p.getByRole('button', { name: 'Done' }).click();
    await p.getByRole('button', { name: 'Print QR sheet' }).click(); await p.waitForTimeout(500); await must(p.locator('.tf-bkf-print__page--tiles'), 'tiles'); await shot('qr-print-tiles');
    await p.getByRole('radio', { name: /Tent cards/ }).click(); await p.waitForTimeout(300); await must(p.locator('.tf-bkf-print__page--tents'), 'tents'); await shot('qr-print-tents'); await p.keyboard.press('Escape');
  });
  await t('tables: kinds, fewest to most, new zone, drag into a zone, bulk, archive with Undo', async () => {
    await p.getByRole('radio', { name: /QR codes/ }).click(); await p.getByRole('button', { name: 'Edit tables' }).click(); await p.waitForTimeout(600);
    await must(p.getByRole('list', { name: 'Main room' }), 'zones'); await shot('tables');
    await p.getByRole('button', { name: /^Add tables/ }).click(); await p.waitForTimeout(300); const d = p.getByRole('dialog');
    await d.getByLabel('From').fill('P1'); await d.getByLabel('To').fill('P4'); await d.getByRole('button', { name: 'Zone' }).click(); await p.getByRole('option', { name: 'New zone…' }).click(); await d.getByLabel('New zone').fill('Patio');
    await shot('tables-add'); await d.getByRole('button', { name: /Create 4 tables/ }).click(); await p.waitForTimeout(500); await must(p.getByRole('list', { name: 'Patio' }), 'new zone');
    const src = p.getByRole('list', { name: 'Patio' }).locator('[data-drag-row]').first(); const tgt = p.getByRole('list', { name: 'Terrace' }).locator('[data-drag-row]').first();
    await drag(src.locator('.tf-drag-handle'), tgt); await shot('tables-drag'); await p.mouse.up(); await p.waitForTimeout(500);
    if (!(await p.getByRole('list', { name: 'Terrace' }).getByText('P1').count())) throw new Error('P1 did not move to Terrace');
    await p.getByRole('list', { name: 'Patio' }).locator('.tf-check').nth(0).click(); await p.getByRole('list', { name: 'Patio' }).locator('.tf-check').nth(1).click(); await p.waitForTimeout(200);
    await p.locator('.tf-floatbar').getByRole('button', { name: 'Archive' }).click({ force: true }); await p.waitForTimeout(400); await must(p.getByRole('button', { name: /Archived · 2/ }), 'archived'); await shot('tables-archived');
  });
}
if (go('res')) {
  await t('reservations: day timeline, month picker, switch place', async () => {
    await back(); await workspace('Tables'); await nav('Reservations'); await p.waitForTimeout(700);
    await must(p.getByRole('radio', { name: /Timeline/ }), 'timeline view'); await p.getByRole('radio', { name: /Timeline/ }).click(); await p.waitForTimeout(400);
    await must(p.locator('.tf-bkf-tl'), 'timeline'); await shot('res-timeline');
    await p.locator('.tf-bkf-tl__slot').nth(6).click(); await p.waitForTimeout(400); await must(p.getByRole('dialog'), 'new booking from a time'); await shot('res-newfromtime'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.getByRole('button', { name: /Pick a date/ }).click(); await p.waitForTimeout(300); await must(p.getByRole('grid'), 'month picker'); await shot('res-month'); await p.keyboard.press('Escape');
    await must(p.getByRole('button', { name: /^Place/ }).or(p.getByLabel('Place')), 'switch place');
  });
}
if (go('managed')) {
  await t('managed pages: group in Links, people, remove asks, delete template asks, lockable parts', async () => {
    await back(); await workspace('Northwind'); await nav('Links'); await p.waitForTimeout(700);
    const g = p.getByRole('region', { name: 'Managed pages' }); await must(g, 'managed group'); await must(g.getByText(/3 people/), 'people count'); await shot('managed');
    await g.getByRole('button', { name: /^More for / }).first().click(); await p.getByRole('menuitem', { name: /Stop managing/ }).click(); await p.waitForTimeout(300);
    await must(p.getByRole('dialog').getByText(/keep working/), 'delete asks (Links)'); await must(p.getByRole('button', { name: 'Stop managing, keep the pages' }), 'outcome in the button'); await shot('managed-delete'); await p.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(300);
    await g.getByRole('button', { name: 'Edit', exact: true }).first().click(); await p.waitForTimeout(800);
    const parts = p.getByRole('list', { name: 'Lockable parts' }); await p.getByRole('tab', { name: 'Who', exact: true }).or(p.getByRole('button', { name: 'Who', exact: true })).or(p.getByRole('link', { name: 'Who', exact: true })).first().click(); await p.waitForTimeout(600);
    await parts.scrollIntoViewIfNeeded();
    for (const part of ['Web address', 'Title and description', 'Lengths', 'Location', 'Questions', 'On booking', 'Limits', 'Working hours']) await must(parts.getByText(part, { exact: true }), 'lockable ' + part);
    await shot('managed-template');
    await p.getByRole('button', { name: /^Take .* off this page/ }).first().click(); await p.waitForTimeout(300); await must(p.getByRole('dialog').getByText(/page and its link are deleted/), 'remove asks'); await must(p.getByRole('button', { name: /^Delete .*’s page/ }), 'remove outcome'); await shot('managed-remove'); await p.getByRole('button', { name: 'Cancel' }).click();
  });
}
await done();
