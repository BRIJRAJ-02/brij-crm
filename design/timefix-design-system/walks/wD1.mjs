// Wave D1: forms, link page and insights. Every new screen, dialog and popover once, with a check that it's really there; shots in sweep/wD1-<theme>-*.png.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const only = process.argv[3];
const { p, t: t0, nav, done, res, workspace } = await open(theme);
const t = (n, f) => (only && !n.startsWith(only) ? Promise.resolve() : t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wD1-${theme}-FAIL-${n.split(':')[0].replace(/\W+/g, '-')}.png` }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); throw e; } }));
const shot = (n) => p.screenshot({ path: `${out}wD1-${theme}-${n}.png`, timeout: 12000 });
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();
const main = () => p.locator('main').last();
const tab = async (name) => { await main().getByRole('tab', { name: new RegExp(`^${name}`) }).click(); await p.waitForTimeout(400); };
const openForm = async (name) => { await nav('Forms'); await p.waitForTimeout(500); const back = main().getByRole('button', { name: 'All forms' }); if (await back.count()) { await back.click(); await p.waitForTimeout(400); } await main().getByRole('link', { name, exact: true }).click(); await p.waitForTimeout(700); };

await t('1 forms list: card menu, new badge, pause asks, delete names count, templates, arrows', async () => {
  await nav('Forms'); await p.waitForTimeout(600);
  await need(main().getByText(/^\d+ new$/), 'new badge'); await shot('01-list');
  await main().getByRole('button', { name: 'More for Talk to sales' }).click(); await p.waitForTimeout(300);
  for (const m of ['Open', 'Copy link', 'Pause', 'Duplicate', 'Delete']) await need(p.getByRole('menuitem', { name: m, exact: true }), `menu ${m}`);
  await shot('02-card-menu');
  await p.getByRole('menuitem', { name: 'Pause', exact: true }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText(/Its link says it’s closed/), 'pause asks'); await shot('03-pause-asks');
  await dialog().getByRole('button', { name: 'Pause form' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'More for Talk to sales' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Resume' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'More for Talk to sales' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Delete', exact: true }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText(/Its 9 submissions are gone for good; records stay/), 'delete names count'); await shot('04-delete-asks'); await esc();
  await main().getByRole('link', { name: 'Talk to sales', exact: true }).focus(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
  const focused = await p.evaluate(() => document.activeElement?.textContent ?? '');
  if (!/Event feedback/.test(focused)) throw new Error(`arrow did not move: ${focused}`);
  await main().getByRole('button', { name: 'New form' }).click(); await p.waitForTimeout(400);
  for (const n of ['Demo request', 'Booking intake', 'Customer onboarding']) await need(dialog().getByText(n, { exact: true }), `template ${n}`);
  await shot('05-templates');
  await dialog().getByText('Customer onboarding', { exact: true }).click(); await p.waitForTimeout(800);
  await need(main().getByText(/Step 2 · Who we work with/), 'onboarding steps');
});
await t('2 builder: steps, shown if chip, logic filter, warnings, endings, routes, score, type settings, preview edit, look', async () => {
  await need(main().getByRole('button', { name: /More for step 2/ }), 'step menu');
  await main().getByRole('button', { name: /More for step 2/ }).click(); await p.waitForTimeout(300); await need(p.getByRole('menuitem', { name: 'Merge with the step above' }), 'merge'); await p.getByRole('menuitem', { name: 'Rename step' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('textbox', { name: 'Step name' }).fill('Your team'); await shot('10-rename-step'); await dialog().getByRole('button', { name: 'Rename' }).click(); await p.waitForTimeout(300);
  await need(main().getByText(/Step 2 · Your team/), 'renamed step');
  // Preview edited in place: steps layout shows the headline and the line.
  await need(main().getByRole('textbox', { name: 'Edit the headline' }), 'headline in place');
  await main().getByRole('textbox', { name: 'Edit the line under the headline' }).fill('Three short steps, two minutes.'); await p.waitForTimeout(300);
  await shot('11-steps-builder');
  await openForm('Talk to sales');
  // Show only if on Company: when team size is 51–200.
  await main().getByRole('row', { name: 'What are you hoping to fix?' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Logic and points' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /Question/ }).filter({ hasText: 'Always show' }).click(); await p.waitForTimeout(300);
  await p.getByRole('option', { name: 'How big is your team?' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  await need(main().getByText(/Shown if How big is your team\? is Just me/), 'shown if chip');
  // A jump to an ending, and an Otherwise line.
  await main().getByRole('row', { name: 'How big is your team?' }).click(); await p.waitForTimeout(400);
  await need(main().getByRole('button', { name: 'Pick one' }).or(main().getByRole('radio', { name: 'Pick one' })), 'choice type switch');
  await need(main().getByRole('switch', { name: 'Add Other' }), 'other switch');
  await main().getByRole('switch', { name: 'Add Other' }).evaluate((e) => e.click()); await p.waitForTimeout(200);
  await need(main().getByRole('button', { name: /Save answer to/ }), 'save answer to');
  await main().getByRole('button', { name: 'Logic and points' }).click().catch(() => undefined); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /After Just me, go to/ }).click(); await p.waitForTimeout(300);
  await p.getByRole('option', { name: '→ The thank you' }).click(); await p.waitForTimeout(300);
  await need(main().getByText('Otherwise', { exact: true }), 'otherwise line');
  await main().getByRole('switch', { name: 'Give points' }).evaluate((e) => e.click()); await p.waitForTimeout(300);
  await shot('12-question-logic');
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  // After they send: an ending, and a route to it.
  await main().getByRole('button', { name: 'Add an ending' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByRole('textbox', { name: 'Heading' }), 'ending dialog'); await shot('13-ending'); await dialog().getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'Add a route' }).click(); await p.waitForTimeout(300);
  await need(main().getByRole('list', { name: 'Routes' }), 'routes'); await need(main().getByText('Everyone else'), 'everyone else');
  await need(main().getByText('Save the score to'), 'score');
  await main().locator('.tf-fp__after').scrollIntoViewIfNeeded(); await shot('14-after-send');
  // Delete a choice a jump reads: the card warns, and the Logic filter counts it.
  await main().getByRole('row', { name: 'How big is your team?' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Remove Just me' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(400);
  await need(main().getByText(/no longer a choice/).first(), 'broken logic warning');
  await main().getByRole('radio', { name: /Logic · \d+ to check/ }).click(); await p.waitForTimeout(300);
  await shot('15-logic-filter');
  await main().getByRole('radio', { name: 'All', exact: true }).click(); await p.waitForTimeout(300);
  // Type settings: date limits on a new date question.
  await main().getByRole('button', { name: 'Add question' }).click(); await p.waitForTimeout(400);
  await need(p.getByRole('listbox', { name: 'Question types' }), 'type list'); await p.getByRole('option', { name: 'Budget' }).hover(); await p.waitForTimeout(200); await shot('16a-picker-ready');
  await p.getByRole('option', { name: 'Scale', exact: true }).hover(); await p.waitForTimeout(200); await need(p.locator('.tf-qpick__preview'), 'live preview'); await shot('16b-picker-scale');
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150); await p.getByRole('searchbox', { name: 'Find a question type' }).fill('zzz'); await p.waitForTimeout(200);
  await need(p.getByText('No type matches “zzz”.'), 'no match'); await shot('16c-picker-none'); await p.getByRole('button', { name: 'Show every type' }).click(); await p.waitForTimeout(150);
  await p.getByRole('searchbox', { name: 'Find a question type' }).fill('date'); await p.waitForTimeout(200); await p.getByRole('option', { name: 'Date', exact: true }).click(); await p.waitForTimeout(400);
  await need(main().getByRole('button', { name: /Earliest day/ }), 'earliest'); await need(main().getByRole('textbox', { name: /Latest day/ }).or(main().getByRole('group', { name: /Latest day/ })), 'latest');
  await shot('16-date-limits');
  await main().getByRole('button', { name: 'All questions' }).click(); await p.waitForTimeout(300);
  // Look: corners and the workspace brand.
  await main().getByRole('button', { name: /^Look ·/ }).click(); await p.waitForTimeout(300);
  await need(p.getByRole('switch', { name: 'Use the workspace brand' }), 'brand'); await need(p.getByRole('radio', { name: 'Square' }), 'corners');
  await p.getByRole('radio', { name: 'Square' }).click(); await p.waitForTimeout(200); await shot('17-look'); await esc();
});
await t('3 settings: layout, language, save progress, round robin owner, several emails, keep asks, spam', async () => {
  await tab('Settings');
  await need(main().getByRole('radio', { name: 'Steps' }), 'steps layout'); await need(main().getByRole('button', { name: /Form language/ }), 'language'); await need(main().getByRole('switch', { name: 'Save progress' }), 'save progress');
  await main().getByRole('button', { name: /Owner/ }).click(); await p.waitForTimeout(300); await need(p.getByRole('option', { name: /Sales · round robin/ }), 'round robin owner'); await p.getByRole('option', { name: /Sales · round robin/ }).click(); await p.waitForTimeout(300);
  await need(main().getByText(/next teammate in Sales/), 'round robin hint');
  await main().getByRole('checkbox', { name: 'Sam' }).or(main().getByRole('button', { name: 'Sam', exact: true })).first().click(); await main().getByRole('checkbox', { name: 'Jo' }).or(main().getByRole('button', { name: 'Jo', exact: true })).first().click(); await p.waitForTimeout(300);
  await need(main().getByText(/2 people are emailed each one/), 'several emails');
  await need(main().getByText(/1 caught/), 'spam row');
  await shot('20-settings');
  await main().getByRole('button', { name: /Keep submissions/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: 'For 6 months' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText(/across every form/), 'keep asks'); await shot('21-keep-asks'); await esc();
  await main().getByRole('radio', { name: 'One at a time' }).click(); await p.waitForTimeout(200);
});
await t('5 submissions: filter, review, table, bulk, drawer, came from, copy', async () => {
  await tab('Responses');
  await need(main().getByRole('grid', { name: 'Submissions' }), 'table'); await need(main().getByText(/1 submission needs your review/), 'needs review'); await shot('30-submissions');
  await main().getByRole('button', { name: /^State/ }).or(main().getByRole('button', { name: /All submissions/ })).first().click(); await p.waitForTimeout(300);
  for (const s of ['Needs review', 'Not in CRM', 'Added', 'Failed', 'Spam']) await need(p.getByRole('option', { name: new RegExp(`^${s}`) }), `filter ${s}`);
  await shot('31-state-filter'); await p.getByRole('option', { name: /^Failed/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('row').filter({ hasText: 'Lena Fox' }).click(); await p.waitForTimeout(500);
  await need(dialog().getByRole('button', { name: 'Retry' }), 'retry'); await need(dialog().getByText('Where it came from').first(), 'came from'); await shot('32-failed-drawer');
  await dialog().getByRole('button', { name: 'Retry' }).click(); await p.waitForTimeout(400); await esc();
  await main().getByRole('button', { name: /^State/ }).or(main().getByRole('button', { name: /Failed/ })).first().click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^All submissions/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('row').filter({ hasText: 'Pepper Potts' }).click(); await p.waitForTimeout(500);
  await need(dialog().getByText(/saved on the record/), 'field status'); await need(dialog().getByText('UTM campaign'), 'utm'); await need(dialog().getByRole('button', { name: /^Copy / }).first(), 'copy raw value');
  await shot('33-drawer'); await esc();
  for (const who of ['Arjun', 'Neel']) await main().getByRole('row', { name: new RegExp(who) }).getByRole('checkbox').first().evaluate((e) => e.click()); await p.waitForTimeout(300);
  await need(p.getByRole('toolbar', { name: 'Bulk actions' }).or(p.locator('.tf-floatbar')).getByText('Add to CRM'), 'bulk add'); await need(p.getByText(/^Export 2$/), 'export selected'); await shot('34-bulk');
  await p.getByRole('button', { name: 'Clear selection' }).click(); await p.waitForTimeout(300);
});
await t('4 publish: live dialog, sync, embeds, developers, full preview', async () => {
  await tab('Share');
  await need(main().getByRole('radio', { name: 'Slide-in' }), 'slide-in'); await main().getByRole('radio', { name: 'Slide-in' }).click(); await p.waitForTimeout(300);
  await need(main().getByRole('switch', { name: 'Clear background' }), 'clear'); await need(main().getByRole('switch', { name: 'Hide the title' }), 'hide title'); await need(main().getByRole('textbox', { name: 'Button words' }), 'words');
  await main().locator('.tf-fp__embed').scrollIntoViewIfNeeded(); await shot('40-embed');
  await main().getByRole('button', { name: 'For developers' }).click(); await p.waitForTimeout(300);
  await need(main().getByRole('button', { name: 'Copy form HTML' }), 'own html'); await main().getByRole('textbox', { name: 'Site address' }).fill('https://northwind.com'); await main().getByRole('button', { name: 'Add site' }).click(); await p.waitForTimeout(300);
  await main().getByRole('switch', { name: 'Refuse unsigned posts' }).evaluate((e) => e.click()); await p.waitForTimeout(300);
  await main().locator('.tf-fp__dev').scrollIntoViewIfNeeded(); await shot('41-developers');
  await main().getByRole('button', { name: 'Rotate secret' }).click(); await p.waitForTimeout(300); await need(dialog().getByText('The old secret stops working at once.', { exact: false }), 'rotate asks'); await shot('42-rotate'); await esc();
  await main().getByRole('button', { name: 'Remove https://northwind.com' }).click(); await p.waitForTimeout(300); await need(dialog().getByText(/stops posting at once/), 'remove asks'); await esc();
  // A first publish: the Live dialog.
  await main().getByRole('button', { name: 'All forms' }).click(); await p.waitForTimeout(400); await main().getByRole('link', { name: 'Event feedback', exact: true }).click(); await p.waitForTimeout(600);
  await p.getByRole('toolbar', { name: 'Publish' }).getByRole('button', { name: 'Publish' }).click(); await p.waitForTimeout(500);
  await need(dialog().getByText('Event feedback is live'), 'live dialog'); for (const b of ['Email', 'WhatsApp', 'More', 'PNG', 'SVG', 'Put it on your site']) await need(dialog().getByRole('button', { name: b, exact: true }), `live ${b}`);
  await need(dialog().getByText(/Answers stay in Submissions/), 'answers go'); await shot('43-live-dialog'); await dialog().getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(300);
  // Sync earlier submissions.
  await openForm('Talk to sales'); await tab('Records');
  await main().getByRole('button', { name: 'File them' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText('Sync earlier submissions?'), 'sync dialog'); await need(dialog().getByRole('radio', { name: /Only unsaved/ }), 'scope'); await shot('44-sync'); await esc();
  // Full page preview, desktop and phone.
  await main().getByRole('button', { name: 'More for this form' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Preview/ }).click(); await p.waitForTimeout(500);
  await need(p.getByRole('button', { name: 'Back to editor' }), 'full preview'); await shot('45-preview-desktop');
  await p.getByRole('radio', { name: 'Phone' }).click(); await p.waitForTimeout(500); await shot('46-preview-phone'); await p.getByRole('button', { name: 'Back to editor' }).click(); await p.waitForTimeout(300);
});
await t('6 analytics: period, median, started, views, sources, drop-off, answers at 0', async () => {
  await tab('Results');
  for (const s of ['Views', 'Started', 'Completion', 'Median time']) await need(main().getByText(s, { exact: true }).first(), s);
  await need(main().getByText('Sources'), 'sources'); await need(main().getByText(/Where people stop/), 'drop-off');
  await main().getByRole('radio', { name: '90 days' }).click(); await p.waitForTimeout(400);
  await shot('50-analytics');
  await main().locator('.tf-recp__sec').last().scrollIntoViewIfNeeded(); await shot('51-answers');
  await tab('Settings'); await main().getByRole('radio', { name: 'Steps' }).click(); await tab('Results');
  await need(main().getByText(/by step/), 'steps drop-off'); await tab('Settings'); await main().getByRole('radio', { name: 'One at a time' }).click();
});
await t('2b guest: steps form with Other and an ending', async () => {
  await main().getByRole('button', { name: 'See it as a guest' }).click(); await p.waitForTimeout(700);
  await need(main().getByText('Talk to sales').first(), 'guest form'); await shot('60-guest'); await main().getByRole('button', { name: 'Back to the form' }).click(); await p.waitForTimeout(400);
});

/** A small photo the walk "uploads": a two-tone square drawn in the page. */
const photo = async () => Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#0F766E'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#F7C948'; g.beginPath(); g.arc(220, 90, 60, 0, 7); g.fill(); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
const upload = async (scope) => { await scope.locator('input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await photo() }); await p.waitForTimeout(600); };
const crop = async () => { await upload(dialog()); await dialog().getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(1500); };
const panel = () => main().locator('.tf-linked__pane[data-pos=current]');
await t('7 link page: profile photo, cover, background, design, details', async () => {
  await nav('Links'); await p.waitForTimeout(500); await main().getByRole('button', { name: 'Edit page: Link page' }).or(main().getByRole('button', { name: 'Open Link page' })).first().click(); await p.waitForTimeout(800);
  await need(main().getByRole('switch', { name: 'Live' }).or(main().getByText('Claim your link')), 'live switch or claim');
  await need(main().getByText('Claim your link'), 'claim a handle'); await shot('70-link-claim');
  await main().getByRole('textbox', { name: 'Your link' }).fill('priya-raman'); await main().getByRole('button', { name: 'Claim' }).click(); await p.waitForTimeout(400);
  await need(main().getByText('timefix.com/priya-raman').first(), 'claimed');
  await main().locator('.tf-linked__profile').first().click(); await p.waitForTimeout(500);
  await panel().getByRole('button', { name: 'Add a photo' }).click(); await p.waitForTimeout(400); await crop();
  await panel().getByRole('textbox', { name: /^Title/ }).fill('Head of sales'); await panel().getByRole('radio', { name: 'Rounded' }).click(); await p.waitForTimeout(200);
  await panel().getByRole('button', { name: 'Add a cover photo' }).click(); await p.waitForTimeout(400); await crop();
  await need(main().locator('.tf-linkpage__cover[data-photo] img'), 'cover in preview'); await need(main().locator('.tf-linkpage__role'), 'title in preview');
  await shot('71-profile');
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(500);
  await main().getByRole('button', { name: /^Design/ }).click(); await p.waitForTimeout(500);
  await panel().getByRole('radio', { name: 'Colour', exact: true }).click(); await p.waitForTimeout(300);
  await need(panel().getByText(/A light ground|A dark ground/), 'background colour'); await shot('72-design-colour');
  await panel().getByRole('radio', { name: 'Photo', exact: true }).click(); await p.waitForTimeout(400); await crop();
  await need(main().locator('.tf-linkpage[data-ground]'), 'background photo in preview'); await shot('73-design-photo');
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(500);
  await main().getByRole('button', { name: /^Details/ }).click(); await p.waitForTimeout(500);
  await panel().getByRole('textbox', { name: /Closing line/ }).fill('Replies within a day.'); await need(panel().getByRole('switch', { name: 'Show in search engines' }), 'indexing');
  await need(main().getByText('Replies within a day.').last(), 'closing in preview'); await shot('74-details');
  await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(500);
});
await t('7 link page: new blocks, schedule, size, ask first, archive, import', async () => {
  const add = async (label) => { await main().getByRole('button', { name: 'Add block' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click(); await p.waitForTimeout(500); };
  await main().getByRole('button', { name: 'Add block' }).click(); await p.waitForTimeout(300);
  for (const k of ['Next times', 'Video or music', 'Picture', 'Gallery', 'Banner']) await need(p.getByRole('menuitem', { name: new RegExp(`^${k}`) }), k);
  await shot('75-add-menu'); await esc();
  await add('Banner'); await panel().getByRole('textbox', { name: 'Headline' }).fill('New: weekend slots');
  await panel().getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(300);
  await need(panel().getByRole('group', { name: /Show from/ }).or(panel().getByRole('textbox', { name: /Show from/ })), 'schedule'); await need(panel().getByRole('button', { name: /Size/ }), 'size');
  await shot('76-more-options'); await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
  await add('Next times'); await need(main().getByRole('list', { name: 'Next open times' }), 'next times in preview'); await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
  await add('Video or music'); await panel().getByRole('textbox', { name: 'Address' }).fill('https://youtube.com/watch?v=calm'); await panel().getByRole('button', { name: 'More options' }).click(); await p.waitForTimeout(200);
  await panel().getByRole('button', { name: /Ask first/ }).click(); await p.waitForTimeout(200); await p.getByRole('option', { name: /18 and over/ }).click(); await p.waitForTimeout(300);
  await shot('77-media-gate'); await panel().getByRole('button', { name: 'Close' }).first().click(); await p.waitForTimeout(400);
  await add('Picture'); await upload(panel()); await panel().getByRole('textbox', { name: 'Describe it' }).fill('The studio'); await need(main().locator('.tf-linkpage__picture img'), 'picture in preview');
  await panel().getByRole('button', { name: 'Archive' }).click(); await p.waitForTimeout(500);
  await main().getByRole('button', { name: /^Archived · 1/ }).click(); await p.waitForTimeout(300); await need(main().getByRole('list', { name: 'Archived blocks' }), 'archived'); await shot('78-archived');
  await main().getByRole('list', { name: 'Archived blocks' }).getByRole('button', { name: 'Restore' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('textbox', { name: 'Your links' }).fill('My links: https://instagram.com/priya.design and www.dribbble.com/priya, plus https://linktr.ee/priya'); await dialog().getByRole('button', { name: 'Find links' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByRole('list', { name: 'Links found' }), 'found links'); await shot('79-import'); await dialog().getByRole('button', { name: /^Add 2 links/ }).click(); await p.waitForTimeout(400);
  await need(main().getByText('Dribbble').first(), 'imported link');
  await p.getByRole('toolbar', { name: 'Publish' }).getByRole('button', { name: 'Publish' }).click(); await p.waitForTimeout(1200);
});
await t('7 link page: share, insights, team pages, private, links row menu', async () => {
  await main().getByRole('button', { name: 'Share', exact: true }).click(); await p.waitForTimeout(300); for (const b of ['WhatsApp', 'X', 'LinkedIn', 'PNG']) await need(dialog().getByRole('button', { name: b, exact: true }), `share ${b}`);
  await shot('80-share'); await esc();
  await main().getByRole('button', { name: 'More for this link page' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Insights/ }).click(); await p.waitForTimeout(500); await need(dialog().getByText('Clicks by link'), 'link insights'); await shot('81-link-insights'); await esc();
  await main().getByRole('button', { name: 'More for this link page' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Team pages' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByRole('list', { name: 'Team pages' }), 'team pages'); await dialog().getByRole('textbox', { name: 'Name' }).fill('Jo Mendes'); await dialog().getByRole('textbox', { name: 'Email' }).fill('jo@northwind.com'); await shot('82-team-pages');
  await dialog().getByRole('button', { name: 'Send invite' }).click(); await p.waitForTimeout(400); await need(p.getByRole('dialog', { name: 'Team pages' }).getByText('Jo Mendes'), 'invited'); await p.getByRole('dialog', { name: 'Team pages' }).getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(400);
  await main().getByRole('switch', { name: 'Live' }).evaluate((e) => e.click()); await p.waitForTimeout(300); await need(dialog().getByText(/Make this page private/), 'private asks'); await shot('83-private-asks'); await dialog().getByRole('button', { name: 'Keep it live' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'See it as a guest' }).click(); await p.waitForTimeout(600);
  await need(main().locator('.tf-linkpage__closing'), 'closing on the live page'); await shot('84-live-page');
  await main().getByRole('button', { name: 'Gated · open' }).or(main().getByRole('button', { name: /18\+/ })).first().click(); await p.waitForTimeout(300); await need(dialog().getByText(/18 or older/), 'ask first'); await shot('85-gate'); await esc();
  await main().getByRole('button', { name: 'Back to editing' }).click(); await p.waitForTimeout(300);
  await nav('Links'); await p.waitForTimeout(500);
  await need(main().getByRole('region', { name: 'Managed pages' }), 'managed pages'); await main().getByRole('button', { name: 'More for Link page' }).click(); await p.waitForTimeout(300);
  for (const m of ['Edit page', 'QR code', 'Copy link', 'Copy to another workspace…']) await need(p.getByRole('menuitem', { name: m }), `row menu ${m}`); await shot('86-links-menu'); await esc();
});
await t('7b team and company pages: new page kinds, members, editors', async () => {
  await need(main().getByText('Company', { exact: true }), 'company kind tag');
  await main().getByRole('button', { name: 'New page' }).click(); await p.waitForTimeout(400);
  for (const k of ['Me', 'A team', 'The company']) await need(dialog().getByRole('radio', { name: new RegExp(`^${k}`) }), `kind ${k}`);
  await shot('87-new-page'); await dialog().getByRole('textbox', { name: 'Link' }).fill('northwind-sales-team'); await dialog().getByRole('button', { name: 'Create page' }).click(); await p.waitForTimeout(900);
  await need(main().getByText('timefix.com/northwind-sales-team').first(), 'team page editor'); await need(main().locator('.tf-linkpage__members'), 'members on the page');
  await shot('88-team-page');
  await main().getByRole('button', { name: 'More for this link page' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /Members and editors/ }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText('Can edit it'), 'editors'); await shot('89-members'); await dialog().getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(300);
  await nav('Links'); await p.waitForTimeout(500); await need(main().getByText('Team', { exact: true }), 'team kind tag'); await shot('90-links-kinds');
});
await t('8 insights: picker, figures, sources, funnel, sessions, share links, shared page', async () => {
  await nav('Insights'); await p.waitForTimeout(600);
  for (const s of ['Visits', 'Finishes', 'Finish rate', 'Average time to finish']) await need(main().getByText(s, { exact: true }).first(), s);
  await need(main().getByRole('grid', { name: 'Sessions' }), 'sessions'); await shot('100-insights');
  await main().getByRole('button', { name: /What/ }).first().click(); await p.waitForTimeout(300); await need(p.getByRole('option', { name: /^Link page/ }), 'link page in picker'); await p.getByRole('option', { name: /^Talk to sales/ }).click(); await p.waitForTimeout(500);
  await need(main().getByRole('list', { name: 'People reaching each step' }), 'funnel'); await main().getByRole('list', { name: 'People reaching each step' }).scrollIntoViewIfNeeded(); await shot('101-insights-form');
  await main().getByRole('grid', { name: 'Sessions' }).getByRole('row').nth(1).click(); await p.waitForTimeout(400); await need(dialog().getByText('Session details').first(), 'session drawer'); await shot('102-session'); await esc();
  await main().getByRole('button', { name: 'Share', exact: true }).click(); await p.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Create link' }).click(); await p.waitForTimeout(200); await need(dialog().getByText('Name the link, so you know it later.'), 'name required');
  await dialog().getByRole('textbox', { name: 'Name' }).fill('For the board'); await dialog().getByRole('button', { name: 'Create link' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByRole('list', { name: 'Links you’ve shared' }), 'shared list'); await shot('103-share-links');
  await dialog().getByRole('button', { name: 'Open' }).first().click(); await p.waitForTimeout(600); await need(p.getByText('Shared by Northwind'), 'shared page'); await shot('104-shared-page');
  await p.getByRole('button', { name: 'Close demo' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /^Shared$|^Share$/ }).click(); await p.waitForTimeout(300); await dialog().getByRole('button', { name: 'Revoke' }).first().click(); await p.waitForTimeout(300);
  await need(dialog().getByText(/stops working at once/), 'revoke asks'); await shot('105-revoke'); await dialog().getByRole('button', { name: 'Revoke' }).last().click(); await p.waitForTimeout(400); await p.getByRole('dialog', { name: 'Share these numbers' }).getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(400);
  await nav('Meetings'); await p.waitForTimeout(500); await p.getByRole('button', { name: 'Demo', exact: true }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /shared Insights link/ }).click(); await p.waitForTimeout(500);
  await need(p.getByText('This link doesn’t open anything'), 'gone state'); await shot('106-shared-gone'); await p.getByRole('button', { name: 'Close demo' }).click(); await p.waitForTimeout(300);
});
const cw = () => p.getByRole('dialog', { name: 'Copy to another workspace' });
await t('9 copy across workspaces: form, booking page, link page, just the look', async () => {
  await nav('Forms'); await p.waitForTimeout(500); const back = main().getByRole('button', { name: 'All forms' }); if (await back.count()) { await back.click(); await p.waitForTimeout(300); }
  await main().getByRole('button', { name: 'More for Talk to sales' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Copy to another workspace…' }).click(); await p.waitForTimeout(400);
  await need(cw().getByText('What comes along').or(cw().getByRole('list', { name: 'What comes along' })), 'comes along');
  await cw().getByRole('button', { name: 'Lumen Hair Studio To' }).click(); await p.waitForTimeout(300); await need(p.getByRole('option', { name: /Olive Kitchen/ }).filter({ hasText: 'You can’t add pages here' }), 'member-only disabled'); await p.getByRole('option', { name: /Lumen Hair Studio/ }).click(); await p.waitForTimeout(200);
  await shot('110-copy-form'); await cw().getByRole('button', { name: 'Copy to Lumen Hair Studio' }).click(); await p.waitForTimeout(400);
  await need(p.getByText('Copied to Lumen Hair Studio'), 'copied toast');
  await main().getByRole('button', { name: 'More for Event feedback' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Copy to another workspace…' }).click(); await p.waitForTimeout(300);
  await cw().getByRole('radio', { name: 'Just the look' }).click(); await p.waitForTimeout(300); await need(cw().getByRole('button', { name: /Onto/ }), 'onto picker'); await shot('111-copy-look');
  await cw().getByRole('button', { name: 'Copy the look' }).click(); await p.waitForTimeout(400);
  await nav('Booking pages'); await p.waitForTimeout(600); await main().getByRole('button', { name: /^More for / }).first().click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: 'Copy to another workspace…' }).click(); await p.waitForTimeout(300); await need(cw().getByText(/arrives Off/), 'booking copy'); await shot('112-copy-booking');
  await cw().getByRole('button', { name: 'Copy to Lumen Hair Studio' }).click(); await p.waitForTimeout(400);
  await nav('Links'); await p.waitForTimeout(500); await main().getByRole('button', { name: 'More for Link page' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Copy to another workspace…' }).click(); await p.waitForTimeout(300);
  await need(cw().getByText(/arrives Private/), 'link copy'); await shot('113-copy-link'); await cw().getByRole('button', { name: 'Copy to Lumen Hair Studio' }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Open', exact: true }).last().evaluate((e) => e.click()); await p.waitForTimeout(1800);
  await need(p.locator('.tf-switcher').filter({ hasText: 'Lumen' }), 'switched to Lumen'); await need(main().getByText(/-lumen/).first(), 'opened a copy in Lumen'); await shot('114-opened-in-lumen');
  await nav('Forms'); await p.waitForTimeout(500); const allf = main().getByRole('button', { name: 'All forms' }); if (await allf.count()) { await allf.click(); await p.waitForTimeout(400); } await need(main().getByText('Talk to sales (copy)'), 'form in Lumen'); await shot('115-lumen-forms');
  await nav('Links'); await p.waitForTimeout(500); await need(main().getByText(/timefix.com\/[a-z-]+-lumen/).first(), 'link page in Lumen'); await shot('116-lumen-links');
  await nav('Services').catch(() => nav('Booking pages')); await p.waitForTimeout(700); await shot('117-lumen-services');
});
await t('10 one publish system: booking page, menu, business page share and publish', async () => {
  await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(1500);
  await nav('Booking pages'); await p.waitForTimeout(600);
  await main().getByRole('button', { name: 'Share Discovery call' }).click(); await p.waitForTimeout(400);
  for (const b of ['Copy', 'Email', 'WhatsApp', 'More', 'PNG', 'SVG', 'Put it on your site', 'Offer specific times', 'Add to link page']) await need(p.getByRole('dialog', { name: 'Share Discovery call' }).getByRole('button', { name: b, exact: true }), `booking share ${b}`);
  await shot('120-booking-share'); await p.getByRole('dialog', { name: 'Share Discovery call' }).getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(300);
  await workspace('Tables'); await nav('Menu').catch(() => undefined); await p.waitForTimeout(700);
  await need(main().getByRole('button', { name: 'See it as a guest' }), 'menu see it'); await main().getByRole('button', { name: 'Share', exact: true }).click(); await p.waitForTimeout(400);
  await need(p.getByRole('dialog', { name: 'Share your menu' }), 'menu share'); await shot('121-menu-share'); await p.getByRole('dialog', { name: 'Share your menu' }).getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(300);
  await main().getByRole('button', { name: /^Mark .* sold out|Edit / }).first().click().catch(() => undefined); await p.waitForTimeout(200); await esc();
  await nav('Your page').catch(() => nav('Booking pages')); await p.waitForTimeout(700);
  await need(main().getByRole('button', { name: 'See it as a guest' }), 'business see it'); await shot('122-business-page');
});
await done();
