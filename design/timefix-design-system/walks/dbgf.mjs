import { createRequire } from 'node:module';
const require = createRequire('/Users/brijraj/Desktop/brijraj/crm/packages/ui/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(4000);
await p.goto('http://127.0.0.1:5391/app.html?r=' + Date.now()); await p.waitForTimeout(1500);
await p.locator('nav').getByText('Companies', { exact: true }).locator('visible=true').first().click(); await p.waitForTimeout(500);
const btns = await p.locator('.tf-fbar button').allInnerTexts(); console.log('fbar buttons', JSON.stringify(btns));
await p.locator('.tf-fbar button').first().click(); await p.waitForTimeout(400); console.log(JSON.stringify((await p.getByRole('menuitem').allInnerTexts()).slice(0, 12)), JSON.stringify((await p.getByRole('option').allInnerTexts()).slice(0, 12)));
await p.getByRole('menuitem', { name: 'Industry' }).click(); await p.waitForTimeout(400); console.log(JSON.stringify((await p.getByRole('menuitem').allInnerTexts()).slice(0, 12)), JSON.stringify((await p.getByRole('option').allInnerTexts()).slice(0, 12)), JSON.stringify((await p.getByRole('checkbox').allInnerTexts()).slice(0, 12)));
console.log('fbar now', JSON.stringify(await p.locator('.tf-fbar').innerText()), JSON.stringify(await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))));
console.log('popover', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[data-trigger], .tf-popover, [role=dialog], [role=listbox], [role=menu]')].map((e) => e.getAttribute('role') + ':' + e.className + ':' + e.textContent.slice(0, 160)))));
const items = await p.getByRole('menuitem').allInnerTexts(); if (items.length) { await p.getByRole('menuitem').first().click(); await p.waitForTimeout(400); console.log('after op', JSON.stringify((await p.getByRole('menuitem').allInnerTexts()).slice(0, 12)), JSON.stringify((await p.getByRole('menuitemcheckbox').allInnerTexts()).slice(0,12)), JSON.stringify((await p.getByRole('option').allInnerTexts()).slice(0,12))); }
await p.screenshot({ path: '/private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/6d00fdda-415e-4de5-9bf6-b1c0f80cd086/scratchpad/proto/rt/sweep/dbgf.png' });
await b.close();
