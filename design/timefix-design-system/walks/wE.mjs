// Wave E: settings, sign in, admin and the house-rule leftovers. Every new screen and dialog once, with a check that it's really there;
// shots in sweep/wE-<theme>-*.png. Args: theme [only-prefix].
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light';
const only = process.argv[3];
const { p, t: t0, nav, done } = await open(theme);
const t = (n, f) => (only && !n.startsWith(only) ? Promise.resolve() : t0(n, async () => { try { await f(); } catch (e) { await p.screenshot({ path: `${out}wE-${theme}-FAIL-${n.split(':')[0].replace(/\W+/g, '-')}.png` }); await esc(3); throw e; } }));
const shot = (n) => p.screenshot({ path: `${out}wE-${theme}-${n}.png`, timeout: 12000 });
const need = async (loc, what) => { if (!(await loc.count())) throw new Error(`missing: ${what}`); };
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); } };
const dialog = () => p.locator('[role=dialog]:not(.tf-rpanel):not(.tf-popover), [role=alertdialog]').last();
const main = () => p.locator('main').last();
const app = async () => { const back = p.locator('nav').getByText('Back to app', { exact: true }).locator('visible=true'); if (await back.count()) { await back.first().click(); await p.waitForTimeout(500); } };
const settings = async (label) => { if (!(await p.locator('nav').getByText('Back to app', { exact: true }).locator('visible=true').count())) { await nav('Settings'); await p.waitForTimeout(500); } await nav(label); await p.waitForTimeout(600); };
const demo = async (label) => { await app(); await nav('Meetings'); await p.waitForTimeout(500); await p.getByRole('button', { name: 'Demo' }).first().click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: label }).click(); await p.waitForTimeout(700); };
const door = async (label) => { await app(); await p.keyboard.press('Meta+k'); await p.waitForTimeout(400); await p.keyboard.type(label); await p.waitForTimeout(700); await p.keyboard.press('Enter'); await p.waitForTimeout(900); };
const leaveDoor = async () => { const b = p.getByRole('button', { name: 'Back to the app' }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(500); } };

await t('17 tiles: form templates and meeting places are one TileGrid', async () => {
  await nav('Forms'); await p.waitForTimeout(500); await main().getByRole('button', { name: /^New form/ }).first().click(); await p.waitForTimeout(500);
  await need(dialog().locator('.tf-tile--action'), 'template tiles'); await shot('17-templates'); await esc();
  await app(); await p.locator('nav').getByText('Bookings', { exact: true }).locator('visible=true').first().click().catch(() => undefined); await p.waitForTimeout(600);
});

await t('17b 17c brand look, guest back pill, narrow toolbars without reaching into library parts', async () => {
  await settings('Brand'); await need(main().getByRole('radio', { name: /Night/ }), 'GuestLook in Brand'); await main().getByRole('radio', { name: /Slate/ }).click({ force: true }); await p.waitForTimeout(400); await shot('17-brand');
  await app(); await nav('Forms'); await p.waitForTimeout(500); await main().getByRole('link', { name: 'Talk to sales', exact: true }).click(); await p.waitForTimeout(700);
  const see = main().getByRole('button', { name: /See it as a visitor|Preview|See it/ }).first(); if (await see.count()) { await see.click(); await p.waitForTimeout(600); }
  await p.setViewportSize({ width: 560, height: 900 }); await p.waitForTimeout(400); await p.getByText('Bookings', { exact: true }).last().click(); await p.waitForTimeout(900);
  const coll = await p.locator('.tf-btn--collapse-narrow').count(); const leak = await p.evaluate(() => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules].map((r) => r.cssText); } catch { return []; } }).filter((c) => /tf-bkf[^{]*\.tf-(btn__label|seg__item)|tf-forms__build \.tf-qbuilder|\.tf-hform--look/.test(c) && /tf-bkf|tf-forms/.test(c.split('{')[0])).length);
  await shot('17-narrow'); await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(400);
  if (leak) throw new Error(`${leak} screen rules still reach into library parts`); if (!coll) throw new Error('no collapsing toolbar button');
});

await t('9 members: chips, invited by, bulk role, what can X do, guest impact', async () => {
  await settings('Members and teams');
  await need(main().getByText(/Invited by Sam Kim · expires in/), 'invited by and expiry'); await need(main().getByText('No 2FA').first(), '2FA chip'); await need(main().getByText(/Sales/).first(), 'works in');
  await shot('09-members');
  await main().getByRole('checkbox', { name: 'Select Jo Mendes' }).click({ force: true }); await main().getByRole('checkbox', { name: 'Select Ava Chen' }).click({ force: true }); await p.waitForTimeout(400);
  await need(p.getByRole('button', { name: /Change role for 2 people/ }), 'bulk bar'); await shot('09-bulk');
  await p.getByRole('button', { name: /Change role for 2 people/ }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: /^Admin/ }).click(); await p.waitForTimeout(400);
  await need(dialog().getByText('Make 2 people Admin?'), 'bulk confirm'); await shot('09-bulk-confirm'); await dialog().getByRole('button', { name: 'Make Admin' }).click(); await p.waitForTimeout(500);
  await need(p.getByText('2 people are now Admin.'), 'bulk toast'); await p.getByRole('button', { name: 'Undo' }).last().click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Actions for Jo Mendes' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'What Jo can do' }).click(); await p.waitForTimeout(500);
  await need(dialog().getByText('What Jo can do'), 'caps dialog'); await need(dialog().getByText('People and access'), 'areas'); await shot('09-caps'); await esc();
  await main().getByRole('button', { name: 'Role for Jo Mendes' }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Guest/ }).click(); await p.waitForTimeout(500);
  await need(dialog().getByText('Make Jo Mendes a Guest?'), 'guest confirm'); await need(dialog().getByText('What changes'), 'impact'); await shot('09-guest-impact'); await esc();
});

await t('10 roles: list, compare, new role from Viewer, role page, people, delete moves people', async () => {
  await settings('Roles and access'); await need(main().getByText('Default'), 'default badge'); await shot('10-roles');
  await main().getByRole('radio', { name: 'Compare' }).click({ force: true }); await p.waitForTimeout(500); await need(main().getByText('Manage webhooks'), 'compare powers'); await shot('10-compare');
  await main().getByRole('radio', { name: 'List' }).click({ force: true }); await p.waitForTimeout(300);
  await main().getByRole('button', { name: 'New role' }).click(); await p.waitForTimeout(400);
  await dialog().getByRole('textbox', { name: 'Name' }).fill('Auditor'); await dialog().getByRole('textbox', { name: 'Description' }).fill('Reads everything, changes nothing');
  await dialog().getByRole('button', { name: /Start from/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Viewer/ }).click(); await p.waitForTimeout(200); await shot('10-new-role');
  await dialog().getByRole('button', { name: 'Create role' }).click(); await p.waitForTimeout(600);
  await need(main().getByRole('tab', { name: /Permissions/ }), 'role page'); await need(main().getByText('See other people’s scheduling'), 'scheduling reach'); await shot('10-role-page');
  await main().getByRole('checkbox', { name: 'Build forms' }).click({ force: true }); await p.waitForTimeout(300); await need(p.locator('.tf-floatbar'), 'save bar'); await p.locator('.tf-floatbar').getByRole('button', { name: /Save/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('tab', { name: /People/ }).click(); await p.waitForTimeout(300); await need(main().getByText('Nobody has this role'), 'people tab'); await shot('10-role-people');
  await main().getByRole('button', { name: 'Roles', exact: true }).click(); await p.waitForTimeout(400);
  await settings('Members and teams'); await main().getByRole('button', { name: 'Role for Ava Chen' }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Auditor/ }).click(); await p.waitForTimeout(500);
  if (await dialog().count()) { await dialog().getByRole('button', { name: /Make Auditor/ }).click(); await p.waitForTimeout(400); }
  await settings('Roles and access'); await main().getByRole('button', { name: 'Actions for Auditor' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Delete' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByText(/1 person has Auditor now/), 'delete moves'); await shot('10-delete-role'); await dialog().getByRole('button', { name: 'Delete role' }).click(); await p.waitForTimeout(400);
  await need(p.getByText('Auditor deleted. 1 person moved.'), 'moved toast');
});

await t('12 object access: teams, records, fields, preview as, less access', async () => {
  await settings('Objects'); await p.locator('.tf-sortable__row').filter({ hasText: 'People' }).first().locator('button.tf-set__open, .tf-set__open').first().click(); await p.waitForTimeout(500);
  await main().getByRole('tab', { name: 'Access' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Add team' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Sales' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /Records Members see/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: /^Their own/ }).click(); await p.waitForTimeout(400);
  await need(main().getByText('Less access'), 'impact chips'); await shot('12-access');
  await main().getByRole('button', { name: 'Preview as' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'Jo Mendes' }).click(); await p.waitForTimeout(400);
  await need(main().getByText('Previewing as Jo Mendes'), 'preview as'); await main().getByRole('button', { name: /^Fields/ }).click(); await p.waitForTimeout(400); await shot('12-fields');
  await main().getByRole('button', { name: 'Exit preview' }).click(); await p.waitForTimeout(300);
});

await t('8 account: handle claim, Google photo, step-up, setup key, codes, devices, emails, preferences, calendars, history', async () => {
  await settings('Profile'); await need(main().getByText('Suggested. Claim it or change it.'), 'handle suggestion');
  const h = main().getByRole('textbox', { name: 'Handle' }); await h.fill('admin'); await p.waitForTimeout(200); await need(main().getByText('That handle is kept for Timefix. Pick another.'), 'reserved');
  await h.fill('priya-raman'); await main().getByRole('button', { name: 'Claim' }).click(); await p.waitForTimeout(400); await need(main().getByRole('button', { name: 'Change' }), 'claimed');
  await main().getByRole('button', { name: 'What Google answers' }).click(); await p.waitForTimeout(300); await p.getByRole('menuitem', { name: 'A different email' }).click(); await p.waitForTimeout(1000);
  await need(main().getByText(/That Google account uses a different email/), 'google result'); await shot('08-profile');
  await main().getByRole('button', { name: /Sync Google photo/ }).click(); await p.waitForTimeout(1100); await need(p.getByText(/Google photo synced/), 'synced');
  await need(main().getByRole('switch', { name: 'Show my account photo on my pages' }), 'photo switch');
  await settings('Sign in and security'); await need(main().getByText('2 sessions'), 'session count'); await need(main().getByRole('button', { name: 'Show more' }), 'show more');
  await main().getByRole('button', { name: 'Set up' }).click(); await p.waitForTimeout(400); await need(dialog().getByRole('button', { name: 'Email me a code' }), 'step-up first'); await dialog().getByRole('button', { name: 'Email me a code' }).click(); await p.waitForTimeout(300);
  await p.keyboard.type('123456'); await p.waitForTimeout(500); await need(dialog().getByText('Setup key'), 'setup key'); await need(dialog().getByRole('button', { name: 'Copy the setup key' }), 'copy key'); await shot('08-setup-key');
  await dialog().getByRole('textbox', { name: 'Code' }).fill('123456'); await dialog().getByRole('button', { name: 'Turn on' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByRole('button', { name: 'Download' }), 'download codes'); await shot('08-codes'); await dialog().getByRole('button', { name: /saved these/ }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Show more' }).click(); await p.waitForTimeout(300); await shot('08-security');
  await settings('Notifications'); await need(main().getByText('Emails about signing in, your account and your bookings always come.'), 'always note'); await need(main().getByRole('switch', { name: 'New form submissions' }), 'forms switch'); await shot('08-notifications');
  await settings('Preferences'); await main().getByRole('button', { name: /Time zone/ }).click(); await p.waitForTimeout(300); await need(p.getByRole('option', { name: /Same as the workspace/ }), 'same as workspace'); await need(p.getByRole('option', { name: /^Automatic/ }), 'automatic'); await esc();
  await settings('History'); await need(main().getByText(/sign-ins are in Sign in and security/), 'history note');
  await settings('Calendars'); await shot('08-calendars');
});

await t('5 sign in states: wait countdown, sign up closed, Google, signed out, 2FA expired, opening', async () => {
  await door('Sign in: too many codes'); await p.getByRole('button', { name: 'Continue with email' }).click(); await p.waitForTimeout(500);
  await need(p.getByText(/Too many codes sent to this email. Try again in/), 'rate limit'); const a = await p.getByText(/Try again in/).textContent(); await p.waitForTimeout(1300); const b = await p.getByText(/Try again in/).textContent(); if (a === b) throw new Error('no countdown: ' + a); await shot('05-wait'); await leaveDoor();
  await door('Sign in: sign up closed'); await p.getByRole('textbox', { name: 'Email' }).fill('nobody@else.com'); await p.getByRole('button', { name: 'Continue with email' }).click(); await p.waitForTimeout(500); await need(p.getByText(/sign up isn’t open yet/), 'closed'); await shot('05-closed'); await leaveDoor();
  await door('Sign in: Google errors'); await need(p.getByText(/Google sign in was cancelled/), 'google cancelled'); await p.getByRole('link', { name: 'Not verified' }).or(p.getByRole('button', { name: 'Not verified' })).first().click(); await p.waitForTimeout(400); await need(p.getByText(/Google hasn’t verified/), 'unverified'); await shot('05-google'); await leaveDoor();
  await door('Signed out (why)'); await p.getByRole('link', { name: 'Elsewhere' }).or(p.getByRole('button', { name: 'Elsewhere' })).first().click(); await p.waitForTimeout(400); await need(p.getByText(/from another device/), 'elsewhere'); await shot('05-signed-out'); await leaveDoor();
  await door('Two factor: sign in expired'); await need(p.getByText('This sign in has expired. Sign in again.'), '2fa expired'); await shot('05-2fa-expired'); await leaveDoor();
  await door('Opening Timefix'); await need(p.getByText('Opening Timefix').first(), 'opening'); await shot('05-opening'); await p.waitForTimeout(5300); await need(p.getByText('Still opening Timefix'), 'still opening'); await shot('05-still-opening');
  await p.getByRole('button', { name: 'Try again' }).click(); await p.waitForTimeout(1600); await need(p.getByText('Can’t open Timefix'), 'cant open'); await shot('05-cant-open'); await leaveDoor();
});

await t('6 7 welcome, invite, join', async () => {
  await door('First run (welcome)'); await p.getByRole('radio', { name: /Meetings/ }).click({ force: true }); await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(500);
  await p.getByRole('textbox', { name: /Workspace name/ }).fill('Acme'); await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(500);
  await need(p.getByRole('textbox', { name: 'Your name' }), 'your name'); await shot('06-you'); await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(2200);
  await need(p.getByRole('group', { name: 'Free addresses' }), 'free addresses'); await shot('06-free'); await p.getByRole('group', { name: 'Free addresses' }).getByRole('button').first().click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(400); await need(p.getByRole('textbox', { name: 'Your link' }), 'link page step'); await shot('06-handle');
  for (let k = 0; k < 3; k++) { await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(400); }
  await p.getByRole('button', { name: 'Connect Outlook' }).click(); await p.waitForTimeout(1100); await need(p.getByText('You didn’t give Timefix access.'), 'denied');
  await p.getByRole('button', { name: 'Connect Outlook' }).click(); await p.waitForTimeout(1100); await need(p.getByText('Couldn’t connect. Try again.'), 'failed'); await shot('06-cal-failed');
  await p.getByRole('button', { name: 'Connect Google Calendar' }).click(); await p.waitForTimeout(1100); await need(p.getByText('Your calendar is connected.'), 'connected'); await shot('06-cal-ok'); await leaveDoor();
  await door('Accept an invitation'); await need(p.getByText(/Sent to r\*\*\*@/), 'masked'); await need(p.getByRole('textbox', { name: 'Your name' }), 'name for new'); await shot('07-invite'); await leaveDoor();
  await door('Invitation to manage a link page'); await need(p.getByText('Manage your page'), 'page invite'); await p.getByRole('button', { name: 'Set up my login' }).click(); await p.waitForTimeout(900); await need(p.getByText('Your login is ready'), 'login ready'); await shot('07-page-invite'); await leaveDoor();
  await door('Ask to join by email domain'); await need(p.getByText(/Workspaces for @/), 'join list'); await p.getByRole('button', { name: /^Ask to join Northwind$/ }).click(); await p.waitForTimeout(300); await need(p.getByText('Request sent'), 'request sent'); await shot('07-join'); await leaveDoor();
  await door('Join: no workspaces'); await need(p.getByText(/None for @gmail.com/), 'join none'); await shot('07-join-none'); await leaveDoor();
});

await t('1 15 webhooks and API keys', async () => {
  await settings('Webhooks'); await need(main().getByText('Zapier'), 'endpoint'); await shot('01-webhooks');
  await main().getByRole('button', { name: 'Add endpoint' }).click(); await p.waitForTimeout(400); await dialog().getByRole('textbox', { name: 'Endpoint URL' }).fill('https://10.0.0.4/hook'); await dialog().getByRole('button', { name: 'Add' }).click(); await p.waitForTimeout(300);
  await need(dialog().getByText('Use a host name, not an IP address.'), 'url check'); await shot('01-add');
  await dialog().getByRole('textbox', { name: 'Endpoint URL' }).fill('https://hooks.make.com/abc'); await dialog().getByRole('textbox', { name: 'Name' }).fill('Make'); await dialog().getByRole('button', { name: 'Add' }).click(); await p.waitForTimeout(900);
  await need(dialog().getByText('Copy your signing secret'), 'secret once'); await shot('01-secret'); await dialog().getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: /^Zapier/ }).click(); await p.waitForTimeout(600); await need(p.getByText('Deliveries'), 'log'); await p.getByRole('button', { name: 'Resend' }).first().click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Send', exact: true }).click(); await p.waitForTimeout(900); await need(p.getByText('Delivered').first(), 'test'); await shot('01-endpoint');
  await p.getByRole('button', { name: 'Rotate' }).click(); await p.waitForTimeout(300); await need(dialog().getByText('The old secret keeps working for 24 hours.'), 'rotate asks'); await dialog().getByRole('button', { name: 'Rotate secret' }).click(); await p.waitForTimeout(400); await dialog().getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Delete endpoint' }).click(); await p.waitForTimeout(300); await need(dialog().getByText('Delete this endpoint?'), 'delete asks'); await esc(2);
  await settings('API keys'); await need(main().getByText(/last used/), 'last used'); await need(main().getByRole('link', { name: /API reference/ }), 'api reference');
  await main().getByRole('button', { name: 'Revoke Website sync' }).click(); await p.waitForTimeout(300); await p.getByRole('button', { name: 'Undo' }).last().click(); await p.waitForTimeout(400); await need(main().getByText('Website sync'), 'undo revoke'); await shot('15-keys');
});

await t('14 background jobs: count, review, progress, cancel asks', async () => {
  await settings('Imports and exports'); await main().getByRole('button', { name: 'Run a test job' }).click(); await p.waitForTimeout(1200);
  await need(main().getByRole('button', { name: 'Review' }), 'review'); await shot('14-confirm'); await main().getByRole('button', { name: 'Review' }).click(); await p.waitForTimeout(300); await dialog().getByRole('button', { name: 'Run job' }).click(); await p.waitForTimeout(1500);
  await need(main().getByText(/Running/), 'running'); await shot('14-running'); await main().getByRole('button', { name: 'Cancel', exact: true }).first().click(); await p.waitForTimeout(300); await need(dialog().getByText(/It stops after this batch/), 'cancel asks'); await shot('14-cancel'); await dialog().getByRole('button', { name: 'Cancel job' }).click(); await p.waitForTimeout(1500);
  await need(main().getByText('Cancelled').first(), 'cancelled');
});

await t('13 4 16 objects list, icon, object id, limits, general', async () => {
  await settings('Objects'); await need(main().getByText('Standard').first(), 'type column'); await shot('13-objects');
  await p.locator('.tf-sortable__row').filter({ hasText: 'Deals' }).first().locator('.tf-set__open').click(); await p.waitForTimeout(400); await need(main().getByText('Attributes').first(), 'meter'); await main().getByRole('tab', { name: 'Configuration' }).click(); await p.waitForTimeout(300);
  await need(main().getByRole('button', { name: 'Copy object ID' }), 'copy id'); await main().getByRole('button', { name: /^Icon:/ }).click(); await p.waitForTimeout(400); await shot('13-icon'); await esc();
  await demo('A workspace at its plan limits'); await settings('Objects'); await p.locator('.tf-sortable__row').filter({ hasText: 'Deals' }).first().locator('.tf-set__open').click(); await p.waitForTimeout(500); await need(main().getByText(/of \d+ used\. Archive one first/), 'at limit'); await shot('04-at-limit');
  await settings('General'); await need(main().getByText('Plan and usage'), 'usage'); await main().getByRole('textbox', { name: 'Web address' }).fill('acme'); await p.waitForTimeout(600); await need(main().getByRole('group', { name: 'Free addresses' }), 'address suggestions'); await shot('16-general');
  await main().getByRole('button', { name: /Keep submissions/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: '12 months' }).click(); await p.waitForTimeout(400); await need(dialog().getByText(/Keep submissions for 12 months/), 'retention asks'); await shot('16-retention'); await esc();
  await demo('Back to the usual plan limits');
  await settings('Members and teams'); await main().getByRole('button', { name: /^Sales/ }).click(); await p.waitForTimeout(400); await dialog().getByRole('button', { name: 'Delete team' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByText(/scheduling/), 'team scheduling warning'); await shot('16-team-delete'); await esc(2);
});

await t('3 public pages: status, email preferences expired, unsubscribe, partner connect', async () => {
  await demo('System status'); await p.waitForTimeout(900); await need(p.getByText('The API and the database are answering.'), 'status'); await shot('03-status'); await leaveDoor();
  await demo('Email preferences'); await need(p.getByText(/Choose which emails you get from/), 'prefs'); await p.getByRole('link', { name: 'An expired link' }).or(p.getByRole('button', { name: 'An expired link' })).first().click(); await p.waitForTimeout(300); await need(p.getByText('This link has expired'), 'expired'); await shot('03-expired'); await leaveDoor();
  await demo('One-click unsubscribe'); await p.getByRole('button', { name: 'Unsubscribe' }).click(); await p.waitForTimeout(900); await need(p.getByText('You’re unsubscribed'), 'unsubscribed'); await shot('03-unsub'); await leaveDoor();
  await demo('Connect a partner app'); await need(p.getByText(/will be able to/), 'consent'); await shot('03-connect'); await p.getByRole('button', { name: 'Connect', exact: true }).click(); await p.waitForTimeout(1000);
});

await t('2 super admin: gate, overview, users, one user, pages, website, partners', async () => {
  await demo('Super admin'); await need(p.getByText(/Turn on two factor to open these pages|Confirm it’s you/), 'gate'); await shot('02-gate');
  if (await p.getByRole('button', { name: 'Enter code' }).count()) { await p.getByRole('button', { name: 'Enter code' }).click(); await p.waitForTimeout(300); await p.keyboard.type('123456'); await p.waitForTimeout(600); }
  await need(p.getByText('Growth'), 'overview'); await shot('02-overview');
  await p.locator('.tf-adm__nav').getByText('Users', { exact: true }).click(); await p.waitForTimeout(500); await need(p.getByRole('grid', { name: 'Users' }).or(p.getByRole('table', { name: 'Users' })), 'users'); await shot('02-users');
  await p.locator('.tf-adm').getByRole('row', { name: /Sam Kim/ }).first().click(); await p.waitForTimeout(500);
  await need(p.getByText('Signs in with'), 'one user'); await shot('02-user');
  await p.locator('.tf-adm__nav').getByText('Booking pages', { exact: true }).click(); await p.waitForTimeout(500); await need(p.getByText('All pages'), 'pages'); await shot('02-pages');
  await p.locator('.tf-adm__nav').getByText('Website', { exact: true }).click(); await p.waitForTimeout(500); await need(p.getByText('Referrers'), 'site'); await shot('02-site');
  await p.locator('.tf-adm__nav').getByText('Partners', { exact: true }).click(); await p.waitForTimeout(500); await p.getByRole('button', { name: 'Replace secret' }).click(); await p.waitForTimeout(300); await need(dialog().getByText('Copy the client secret'), 'secret'); await shot('02-partners'); await dialog().getByRole('button', { name: 'Done' }).click();
  await p.locator('.tf-adm__nav').getByText('Back to app').click(); await p.waitForTimeout(400);
});

await t('11 sign in rules: need it yourself, session length, sign out everyone with step-up', async () => {
  await settings('Sign in rules'); await need(main().getByText(/You need it yourself first\.|set it up\./), 'need yourself or count'); await shot('11-signin');
  await main().getByRole('button', { name: /Session length/ }).click(); await p.waitForTimeout(300); await p.getByRole('option', { name: '7 days' }).click(); await p.waitForTimeout(400);
  await need(dialog().getByText('Make sessions last 7 days?'), 'shorten asks'); await dialog().getByRole('button', { name: 'Shorten sessions' }).click(); await p.waitForTimeout(400);
  await main().getByRole('button', { name: 'Sign out everyone' }).click(); await p.waitForTimeout(400); await need(dialog().getByText(/Email me a code|authenticator app|confirmed it’s you/).first(), 'step-up');
  if (await dialog().getByRole('button', { name: 'Email me a code' }).count()) { await dialog().getByRole('button', { name: 'Email me a code' }).click(); await p.waitForTimeout(300); }
  await p.keyboard.type('123456'); await p.waitForTimeout(400); await shot('11-stepup'); await dialog().getByRole('button', { name: 'Sign out everyone' }).click(); await p.waitForTimeout(400);
  await need(main().getByText(/Last done/), 'last done');
});

await done();
