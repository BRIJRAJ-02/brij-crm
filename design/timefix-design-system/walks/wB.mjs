// Wave B: the CRM core. Every new screen, dialog and popover once, with a check that it's really there, shots in sweep/wB-<theme>-*.png.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const { p, t: t0, nav, done, res } = await open(theme);
const t = (n, f) => t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wB-${theme}-FAIL-${n.split(':')[0].replace(/\W+/g, '-')}.png` }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); throw e; } });
const shot = (n) => p.screenshot({ path: `${out}wB-${theme}-${n}.png` });
const rows = () => p.locator('.tf-rec__grid [role=row]').count();
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();

await t('table: group rows, calc footer, column reorder', async () => {
  await nav('People'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: /^Email: no calculation/ }).first().click(); await p.waitForTimeout(300);
  await p.getByRole('menuitemradio', { name: 'Count filled' }).click(); await p.waitForTimeout(400);
  await need(p.getByText(/^Filled \d+/), 'calc text'); await shot('03-calc');
  await p.getByRole('button', { name: 'View', exact: true }).click(); await p.waitForTimeout(400);
  await need(p.getByText('drag to reorder'), 'reorder hint'); await shot('01-view-popover');
  await p.getByRole('button', { name: /Group rows by/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('option', { name: 'Owner' }).click(); await p.waitForTimeout(400); await esc();
  await need(p.locator('.tf-rec__grouphead'), 'group heads'); await shot('02-grouped');
  const before = await p.locator('.tf-rec__grouphead').count(); res.push(`  groups: ${before}`);
  await need(p.getByText(/^Filled \d+/).nth(1), 'calc per group');
  await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
});
await t('filters: through a relationship, a group, dates', async () => {
  const all = await rows();
  await p.getByRole('button', { name: 'Filter', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'Company › Industry' }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'is', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitemcheckbox', { name: 'Software' }).click(); await p.waitForTimeout(300); await esc();
  const sw = await rows(); res.push(`  people at software companies: ${sw} of ${all}`); if (!(sw < all && sw > 1)) throw new Error('relationship filter did nothing');
  await p.getByRole('button', { name: 'Filter', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Add a filter group/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'Job title', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'contains', exact: true }).click(); await p.waitForTimeout(300);
  await p.keyboard.type('CTO'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  await need(p.locator('.tf-fbar__group'), 'filter group'); await shot('04-filter-group');
  res.push(`  with group: ${await rows()}`);
  await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
  await nav('Deals'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Filter', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'Close date', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'in the next', exact: true }).click(); await p.waitForTimeout(300);
  await p.keyboard.type('30'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  await need(p.getByRole('group', { name: /Close date in the next 30 days/ }), 'date chip'); await shot('05-date-filter');
  await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
});
await t('board: group by any field, totals, card fields', async () => {
  await p.getByRole('button', { name: 'View', exact: true }).click(); await p.waitForTimeout(400);
  await need(p.getByText('Cards show'), 'card fields'); await shot('06-board-options');
  await p.getByRole('button', { name: /Columns by/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Owner' }).click(); await p.waitForTimeout(400); await esc();
  await need(p.getByText('Priya Raman').first(), 'owner columns'); await shot('07-board-owner');
  await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
});
await t('saved views: who sees it, lock, private section', async () => {
  await nav('People'); await p.waitForTimeout(500);
  await p.locator('.tf-rec__view').click(); await p.waitForTimeout(300);
  await need(p.getByText('Only you'), 'private section'); await shot('08-view-menu');
  await p.getByRole('menuitem', { name: /Who can see it/ }).click(); await p.waitForTimeout(400);
  await need(p.getByRole('radio', { name: /only admins edit/ }), 'access radios'); await shot('09-view-access'); await esc();
  await p.locator('.tf-rec__view').click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Lock view' }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'View', exact: true }).click(); await p.waitForTimeout(300); await p.getByRole('switch', { name: 'Show Email' }).evaluate((e) => e.click()); await p.waitForTimeout(300); await esc();
  await need(p.getByRole('button', { name: 'Save as new view' }), 'locked save'); await shot('10-locked');
  await p.getByRole('button', { name: 'Discard' }).click(); await p.waitForTimeout(400);
  await p.locator('.tf-rec__view').click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Unlock view' }).click(); await p.waitForTimeout(400);
});
await t('bulk edit and delete ask first', async () => {
  await p.waitForTimeout(8500);
  await p.locator('.tf-rec__grid [role=row]').nth(1).locator('label').first().click(); await p.locator('.tf-rec__grid [role=row]').nth(2).locator('label').first().click(); await p.waitForTimeout(300);
  await need(p.getByRole('button', { name: /Select all \d+/ }), 'select all matching');
  await p.getByRole('button', { name: 'Edit', exact: true }).click(); await p.waitForTimeout(400);
  await need(dialog().getByRole('button', { name: 'Change another field' }), 'bulk rows'); await dialog().getByRole('button', { name: 'Change another field' }).click(); await p.waitForTimeout(300); await shot('11-bulk-edit'); await esc();
  await p.getByRole('button', { name: 'Delete', exact: true }).click(); await p.waitForTimeout(400);
  await need(p.getByRole('alertdialog').or(p.getByRole('dialog')).getByText(/Trash for 30 days/), 'delete confirm'); await shot('12-bulk-delete'); await esc();
  await p.getByRole('button', { name: 'Clear selection' }).click(); await p.waitForTimeout(300);
});
await t('new record: add more fields', async () => {
  await p.getByRole('button', { name: 'New person' }).first().click(); await p.waitForTimeout(400);
  await dialog().getByRole('button', { name: /Add more fields/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'Phone' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText('Phone'), 'phone row'); await shot('13-new-record'); await esc();
});
await t('record page: stats, duplicate, activity filter, log call', async () => {
  await p.locator('.tf-rec__grid [role=row]').filter({ hasText: 'liam@acme.com' }).first().click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Open full page' }).click(); await p.waitForTimeout(700);
  await need(p.getByText('Last contacted'), 'stat strip'); await need(p.getByText(/Possible duplicate of/), 'duplicate banner'); await shot('14-record');
  await p.getByRole('tab', { name: /Activity/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Log', exact: true }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: 'What about' }).fill('Pricing follow-up'); await shot('15-log-call');
  await dialog().getByRole('button', { name: /How it went/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Connected' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Log call' }).click(); await p.waitForTimeout(500);
  await p.getByRole('radio', { name: /^Calls/ }).click(); await p.waitForTimeout(300);
  await need(p.getByText('Pricing follow-up'), 'logged call'); await shot('16-activity-calls');
  await p.getByRole('button', { name: 'More for call' }).first().click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Edit' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByRole('button', { name: 'Save' }), 'edit call'); await esc();
});
await t('related: link and create', async () => {
  await p.getByRole('button', { name: 'Add to deals' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByRole('button', { name: /Create deal/ }), 'link dialog'); await shot('17-link'); await esc();
});
await t('comments: edit with history, resolved threads', async () => {
  await p.getByRole('tab', { name: /Comments/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('textbox', { name: 'Comment' }).fill('Checking the plan with Liam.'); await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(500);
  await p.locator('.tf-comment').last().hover(); await p.getByRole('button', { name: 'Edit', exact: true }).last().click(); await p.waitForTimeout(300);
  await p.getByRole('textbox', { name: 'Edit comment' }).fill('Checked the plan with Liam.'); await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(400);
  await need(p.getByRole('button', { name: /^Edited/ }), 'edited mark'); await p.getByRole('button', { name: /^Edited/ }).click(); await p.waitForTimeout(300); await shot('18-comment-history'); await esc();
  await p.locator('.tf-comment').last().hover(); await p.getByRole('button', { name: 'Delete', exact: true }).last().click(); await p.waitForTimeout(300);
  await need(p.getByText('Delete this thread?'), 'delete confirm'); await shot('19-comment-delete'); await esc();
  await p.getByRole('button', { name: /^Back/ }).first().click(); await p.waitForTimeout(400);
});
await t('inbox and tasks', async () => {
  await nav('Inbox'); await p.waitForTimeout(400); await need(p.getByRole('button', { name: 'Notification settings' }), 'notification link');
  await p.getByRole('button', { name: /Kind/ }).first().click(); await p.waitForTimeout(300); await need(p.getByRole('option', { name: 'Form submissions' }), 'form kind'); await shot('20-inbox-kinds'); await esc();
  await nav('Tasks'); await p.waitForTimeout(400); await p.getByRole('radio', { name: 'Created by me' }).click(); await p.waitForTimeout(300); await shot('21-tasks-made');
});
await t('automations: list, builder, runs, really run', async () => {
  await nav('Settings'); await p.waitForTimeout(500); await nav('Automations'); await p.waitForTimeout(500); await shot('22-automations');
  await p.getByRole('button', { name: 'New automation' }).click(); await p.waitForTimeout(400); await need(dialog().getByText('Only if'), 'builder'); await shot('23-builder'); await esc();
  await p.getByRole('tab', { name: /Runs/ }).click(); await p.waitForTimeout(300); const before = await p.locator('.tf-auto__runs li').count(); await shot('24-runs');
  await nav('Back to app'); await p.waitForTimeout(400); await nav('Deals'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Layout|Table/ }).first().click().catch(() => undefined);
  await p.getByRole('radio', { name: 'Table' }).click(); await p.waitForTimeout(400);
  await p.locator('.tf-rec__grid [role=row]').filter({ hasText: 'Stark stores' }).first().click(); await p.waitForTimeout(500);
  await p.locator('.tf-rpanel').getByRole('button', { name: /^Stage: / }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Won' }).or(p.getByRole('menuitemradio', { name: 'Won' })).first().click(); await p.waitForTimeout(600);
  await nav('Settings'); await p.waitForTimeout(400); await nav('Automations'); await p.waitForTimeout(400); await p.getByRole('tab', { name: /Runs/ }).click(); await p.waitForTimeout(300);
  const after = await p.locator('.tf-auto__runs li').count(); res.push(`  runs ${before} -> ${after}`); if (after <= before) throw new Error('automation did not run');
  await nav('Back to app'); await p.waitForTimeout(300);
});
await t('objects: formula, relationship, stage rules, archive warning', async () => {
  await nav('Settings'); await p.waitForTimeout(400); await nav('Objects'); await p.waitForTimeout(400); await shot('25-objects');
  await p.getByRole('button', { name: /^Deals/ }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'More kinds' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Formula/ }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Seats value'); await shot('26-formula'); await esc();
  await p.getByRole('button', { name: 'More kinds' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Rollup/ }).click(); await p.waitForTimeout(400); await shot('27-rollup'); await esc();
  await p.getByRole('button', { name: 'More kinds' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Relationship/ }).click(); await p.waitForTimeout(400); await shot('28-relationship'); await esc();
  await p.getByRole('row', { name: /Close date/ }).click(); await p.waitForTimeout(400); await dialog().getByRole('button', { name: 'Archive' }).click(); await p.waitForTimeout(400);
  await need(p.getByText(/Used by:/), 'impact'); await shot('29-archive-impact'); await p.getByRole('button', { name: /^Archive Close date/ }).click(); await p.waitForTimeout(400);
  await need(p.getByText('Archived attributes'), 'archived list'); await shot('30-archived'); await p.getByRole('button', { name: 'Restore' }).click(); await p.waitForTimeout(300);
  await p.getByRole('tab', { name: 'Configuration' }).click(); await p.waitForTimeout(400); await need(p.getByText(/Won and lost stages end a pipeline/), 'stage rules'); await shot('31-stage-rules');
});
await t('trash: filter, select, open read only', async () => {
  await nav('Trash'); await p.waitForTimeout(400); await need(p.getByText(/Select all/), 'select all'); await shot('32-trash');
  await p.locator('.tf-trash__open').first().click(); await p.waitForTimeout(500); await need(p.getByText(/In Trash:/), 'read only record'); await shot('33-trashed-record');
  await p.getByRole('button', { name: /^Back/ }).first().click(); await p.waitForTimeout(300); await nav('Back to app'); await p.waitForTimeout(300);
});
await t('import deals with checks, details page', async () => {
  await nav('Deals'); await p.waitForTimeout(400); await p.getByRole('button', { name: 'More for deals' }).click(); await p.getByRole('menuitem', { name: 'Import deals' }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Use a sample file' }).click(); await p.waitForTimeout(400); await shot('34-import-map');
  await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(400); await need(p.getByText(/isn’t a stage|No company called/), 'row errors'); await shot('35-import-check');
  await p.getByRole('button', { name: /^Import \d+ deal/ }).click(); await p.waitForTimeout(500); await shot('36-import-done');
  await p.getByRole('button', { name: 'See rows and errors' }).click(); await p.waitForTimeout(500); await need(p.getByText(/Row \d/).first(), 'import details'); await shot('37-import-details');
  await nav('Back to app'); await p.waitForTimeout(300);
});
await t('reports and forecast', async () => {
  await nav('Insights'); await p.waitForTimeout(400); await p.getByRole('tab', { name: /Reports/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'New report' }).first().click(); await p.waitForTimeout(400); await need(dialog().getByText('Show as'), 'chart type'); await shot('38-report-dialog');
  await dialog().getByRole('button', { name: /Grouped by/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'Close date' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: /Show as/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'A line' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Save report' }).click(); await p.waitForTimeout(500); await shot('39-report-line');
  await p.getByRole('tab', { name: /Forecast/ }).click(); await p.waitForTimeout(400); await need(p.getByText('Weighted forecast'), 'forecast'); await shot('40-forecast');
});
await t('custom object: table, record page, command menu', async () => {
  await p.getByRole('button', { name: 'New object' }).first().click(); await p.waitForTimeout(300);
  await dialog().getByRole('textbox', { name: 'One' }).fill('Project'); await dialog().getByRole('button', { name: 'Create object' }).click(); await p.waitForTimeout(600);
  await need(p.locator('.tf-rec__view'), 'views on custom object'); await p.getByRole('button', { name: 'New project' }).first().click(); await p.waitForTimeout(300);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Website relaunch'); await dialog().getByRole('button', { name: 'Create project' }).click(); await p.waitForTimeout(500); await shot('41-custom-table');
  await p.keyboard.press('Meta+k'); await p.waitForTimeout(400); await p.keyboard.type('Website'); await p.waitForTimeout(400); await need(p.getByRole('dialog').getByText('Website relaunch'), 'custom record in ⌘K'); await shot('42-cmdk');
  await p.keyboard.press('Enter'); await p.waitForTimeout(600); await need(p.getByText('Last activity'), 'custom record page'); await shot('43-custom-record');
  await p.keyboard.press('Meta+k'); await p.waitForTimeout(300); await p.keyboard.type('theme'); await p.waitForTimeout(300); await need(p.getByRole('dialog').getByText(/dark theme/), 'theme switch'); await esc();
});
await done();
