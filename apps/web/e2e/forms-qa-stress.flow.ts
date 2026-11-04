// Forms QA, stress (5 November 2026, "bulletproof before release"): a 50 question form opens in the builder,
// publishes and is filled and sent; a 10,000 character answer is stopped on the page; bad input in each kind of
// field shows its message and sends nothing; a file too big or of the wrong type is refused before any send; Send
// pressed twice sends once; a connection dropped at Send keeps the answers and the retry stores one submission,
// even when the first send reached the server and only its answer was lost; a form closed while someone fills it
// tells them plainly with their answers still on screen; two editors saving the same form never lose an edit
// silently; and deleting a question a rule reads warns in the builder.
import { expect, test } from '@playwright/test';
import {
  asOwner,
  countSubmits,
  expectThanks,
  isSubmit,
  liveForm,
  makeOwner,
  q,
  rpc,
  send,
  submissionsOf,
  visitorOn,
  type FormView,
  type Owner,
} from './forms-qa.ts';
import { randomUUID } from 'node:crypto';

let owner: Owner;

test.describe('forms QA: stress', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The stress checks run at desktop width.');
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    owner = await makeOwner(browser, testInfo, 'stress');
  });

  test('a 50 question form opens in the builder, publishes, and is filled and sent', async ({ page, browser }) => {
    test.setTimeout(300_000);
    await asOwner(page, owner);
    const extra = Array.from({ length: 47 }, (_, index) =>
      q(`q${String(index + 4)}`, `Question number ${String(index + 4)}`, index % 2 === 0 ? 'short_text' : 'long_text'),
    );
    const form = await liveForm(page, owner, `Fifty ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [...draft.questions, ...extra],
    }));
    // The builder holds all fifty, and offers no 51st.
    await page.goto(`/w/${owner.slug}/captures/forms/${form.id}`);
    await expect(page.getByRole('grid', { name: 'Questions' }).getByRole('row')).toHaveCount(50, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Add a question' })).toBeDisabled();

    const visitor = await visitorOn(browser, form);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-fifty-${form.id.slice(-6)}@example.com`);
    for (let number = 4; number <= 50; number += 1) {
      await visitor.getByLabel(new RegExp(`^Question number ${String(number)}\\b`)).fill(`Answer ${String(number)}`);
    }
    await send(visitor);
    await expectThanks(visitor);
    await visitor.context().close();
    await expect.poll(async () => (await submissionsOf(page, owner, form)).length, { timeout: 30_000 }).toBe(1);
  });

  test('a 10,000 character answer is stopped on the page and never sent', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Long ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [...draft.questions, q('story', 'Tell us your story', 'long_text')],
    }));
    const visitor = await visitorOn(browser, form);
    const sentBodies: number[] = [];
    visitor.on('request', (request) => {
      if (isSubmit(request)) sentBodies.push(request.postData()?.length ?? 0);
    });
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-long-${form.id.slice(-6)}@example.com`);
    const story = visitor.getByLabel(/Tell us your story/);
    await story.fill('x'.repeat(10_000));
    // Either the field takes no more than its 2,000 characters, or the page says it is too long and holds the send.
    const kept = (await story.inputValue()).length;
    await send(visitor);
    if (kept > 2_000) {
      await expect(visitor.getByText('That is longer than this question takes.').first()).toBeVisible();
      await expect(visitor.getByRole('heading', { name: /Thanks, we got it/ })).toHaveCount(0);
    }
    expect(
      sentBodies.every((length) => length < 9_000),
      'a 10,000 character answer went to the server',
    ).toBe(true);
    await visitor.context().close();
  });

  // Forms QA, 5 November 2026: typing a bad answer and pressing Send straight away used to lose that press (leaving
  // the field drew its error line, which pushed Send down between the press and its release). The line now waits
  // for the press to end, so the first press checks everything.
  test('bad input in each kind of field shows its message and sends nothing, on the first press of Send', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Bad input ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [
        ...draft.questions,
        q('site', 'Company website', 'website', { required: true }),
        q('seats', 'How many seats', 'number', { required: true }),
        q('start', 'Start date', 'date', { required: true, options: { earliest: '2026-01-01' } }),
      ],
    }));
    const visitor = await visitorOn(browser, form);
    const submits = countSubmits(visitor);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill('ada@');
    await visitor.getByLabel(/Company website/).fill('not a site');
    await visitor.getByLabel(/How many seats/).fill('ten');
    await send(visitor);
    await expect(visitor.getByText('Enter an email address, such as ada@example.com.').first()).toBeVisible();
    await expect(visitor.getByText('Enter a web address, such as acme.com.').first()).toBeVisible();
    // A number field may refuse letters as they are typed; either way the send is held.
    const seats = await visitor.getByLabel(/How many seats/).inputValue();
    if (seats !== '') await expect(visitor.getByText('Enter a number, such as 1500.').first()).toBeVisible();
    // The start date is required and empty.
    await expect(visitor.getByText('Answer this question.').filter({ visible: true }).first()).toBeVisible();
    // Each problem is said under its own question (no summary repeats them), and focus went to the first.
    await expect(visitor.getByLabel(/Work email/)).toBeFocused();
    expect(submits()).toBe(0);
    await visitor.context().close();
  });

  test('a file too big or of a type forms refuse is stopped before anything is sent', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Files ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [...draft.questions, q('cv', 'Your CV', 'file', { required: true })],
    }));
    const visitor = await visitorOn(browser, form);
    const uploads: number[] = [];
    visitor.on('response', (response) => {
      if (/\/uploads$/.test(new URL(response.url()).pathname)) uploads.push(response.status());
    });
    const submits = countSubmits(visitor);
    const input = visitor.locator('input[type="file"]').first();
    // An SVG named as a PNG: its bytes say otherwise.
    await input.setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    });
    await expect(visitor.getByText(/photo\.png uploaded\./)).toHaveCount(0);
    // Five megabytes, past the four a form takes.
    const big = Buffer.alloc(5 * 1024 * 1024, 0x20);
    big.write('%PDF-1.7\n');
    await input.setInputFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: big });
    await expect(visitor.getByText(/huge\.pdf uploaded\./)).toHaveCount(0);
    // A program, whatever it is called.
    await input.setInputFiles({ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(visitor.getByText(/setup\.exe uploaded\./)).toHaveCount(0);
    expect(
      uploads.filter((status) => status === 201),
      'a refused file was stored',
    ).toEqual([]);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-files-${form.id.slice(-6)}@example.com`);
    await send(visitor);
    // Still required: the form holds the send.
    await expect(visitor.getByRole('heading', { name: /Thanks, we got it/ })).toHaveCount(0);
    expect(submits()).toBe(0);
    await visitor.context().close();
  });

  test.fixme('a question that takes several files refuses one past its most', () => {
    // Waits on wip/forms-fixes (uploads): a file question takes one file today, so "too many files" has no control
    // to press. Once a question takes several, pick one more than its most: the page says how many it takes, keeps
    // the ones already chosen, and the send stores only those.
  });

  test('Send pressed twice sends once', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Twice ${randomUUID().slice(0, 6)}`);
    const visitor = await visitorOn(browser, form);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-twice-${form.id.slice(-6)}@example.com`);
    await visitor.waitForTimeout(3_000);
    const submits = countSubmits(visitor);
    await visitor.getByRole('button', { name: 'Send', exact: true }).dblclick();
    await expectThanks(visitor);
    expect(submits()).toBe(1);
    await visitor.context().close();
    await expect.poll(async () => (await submissionsOf(page, owner, form)).length, { timeout: 30_000 }).toBe(1);
  });

  test('a connection dropped at Send keeps the answers, and the retry stores one submission', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Dropped ${randomUUID().slice(0, 6)}`);
    const visitor = await visitorOn(browser, form);
    const email = `ada-dropped-${form.id.slice(-6)}@example.com`;
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(email);
    // First the request never leaves; then it reaches the server and only the answer is lost.
    let drops = 0;
    await visitor.route(/\/api\/public\/forms\/[^/]+\/submissions$/, async (route) => {
      drops += 1;
      if (drops === 1) return route.abort('internetdisconnected');
      if (drops === 2) {
        await route.fetch();
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await visitor.waitForTimeout(3_000);
      await visitor.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(visitor.getByRole('alert').filter({ hasText: /did not go through/ })).toBeVisible();
      // Nothing typed is lost.
      await expect(visitor.getByLabel(/Your name/)).toHaveValue('Ada Lovelace');
      await expect(visitor.getByLabel(/Work email/)).toHaveValue(email);
    }
    await send(visitor);
    await expectThanks(visitor);
    await visitor.context().close();
    // The send that reached the server and the retry are one submission.
    await expect.poll(async () => (await submissionsOf(page, owner, form)).length, { timeout: 30_000 }).toBe(1);
  });

  // Forms QA, 5 November 2026: a send to a form paused mid fill used to swap the whole form for the closed line, and
  // everything the visitor typed was gone. Now the form stays, the line shows above Send, and Copy my answers keeps it.
  test('a form closed while someone fills it in says so plainly, with their answers still on screen', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Closing ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [...draft.questions, q('story', 'Tell us your story', 'long_text')],
    }));
    const visitor = await visitorOn(browser, form);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-closing-${form.id.slice(-6)}@example.com`);
    await visitor.getByLabel(/Tell us your story/).fill('A long story I would hate to type again.');
    await rpc<FormView>(page, 'forms/setStatus', {
      workspace: owner.slug,
      formId: form.id,
      status: 'paused',
      mutationId: randomUUID(),
    });
    await visitor.waitForTimeout(3_000);
    await visitor.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(visitor.getByText(/isn’t taking enquiries right now|closed/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // No surprise loss: what they wrote is still there to copy.
    await expect(
      visitor.getByText('A long story I would hate to type again.').or(visitor.getByLabel(/Tell us your story/)),
    ).toBeVisible();
    const story = visitor.getByLabel(/Tell us your story/);
    if ((await story.count()) > 0) await expect(story).toHaveValue('A long story I would hate to type again.');
    await expect(visitor.getByRole('heading', { name: /Thanks, we got it/ })).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: 'Copy my answers' })).toBeVisible();
    await visitor.context().close();
  });

  test('two editors saving one form never lose an edit silently', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Shared ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [
        ...draft.questions,
        q('first', 'First extra', 'short_text'),
        q('second', 'Second extra', 'short_text'),
      ],
    }));
    const url = `/w/${owner.slug}/captures/forms/${form.id}`;
    const other = await browser.newPage();
    await other.context().addCookies([...owner.cookies]);
    await page.goto(url);
    await other.goto(`${new URL(page.url()).origin}${url}`);
    const card = (p: typeof page, label: string) => p.getByRole('button', { name: new RegExp(`^${label}`) }).first();
    const question = (p: typeof page) => p.getByLabel('Question', { exact: true }).last();
    await card(page, 'First extra').click({ timeout: 30_000 });
    await question(page).fill('Edited by one');
    await card(other, 'Second extra').click({ timeout: 30_000 });
    await question(other).fill('Edited by two');
    // Each save settles (a second after the last keystroke), then one of: both edits kept, or the second editor is
    // told plainly that someone else changed the form and offered their version.
    await page.waitForTimeout(4_000);
    const told = other.getByText('Someone else changed this form.').or(other.getByText(/changed this form/));
    await other.waitForTimeout(2_000);
    const warned = await told.first().isVisible();
    await page.reload();
    const rows = page.getByRole('grid', { name: 'Questions' }).getByRole('row');
    await expect(rows).toHaveCount(5, { timeout: 30_000 });
    const labels = await rows.allInnerTexts();
    const bothKept =
      labels.some((text) => text.includes('Edited by one')) && labels.some((text) => text.includes('Edited by two'));
    expect(bothKept || warned, `rows after both saves: ${labels.join(' | ')}`).toBe(true);
    await other.context().close();
  });

  test('deleting a question a rule reads blocks the publish with the reason, and the live form keeps working', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Ruled ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      questions: [
        ...draft.questions,
        q('budget', 'Budget', 'choice', { choices: ['Small', 'Large'] }),
        q('detail', 'Tell us about the budget', 'long_text', {
          showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        }),
      ],
    }));
    await page.goto(`/w/${owner.slug}/captures/forms/${form.id}`);
    await page
      .getByRole('button', { name: /^Budget/ })
      .first()
      .click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/Deleted “Budget”/).first()).toBeVisible();
    // Publishing it as it is is refused, saying why; the live form is never broken.
    await expect(page.getByText(/Live · edited|edited/).first()).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('button', { name: /^Publish/ })
      .first()
      .click();
    await expect(page.getByText(/no longer on the form|reads a question/).first()).toBeVisible({ timeout: 15_000 });

    const visitor = await visitorOn(browser, form);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-ruled-${form.id.slice(-6)}@example.com`);
    await visitor.getByText('Large', { exact: true }).click();
    await visitor.getByLabel(/Tell us about the budget/).fill('Quite large');
    await send(visitor);
    await expectThanks(visitor);
    await visitor.context().close();
  });

  test.fixme('deleting a question a rule reads warns at the delete, naming the rule', () => {
    // Waits on wip/forms-builder (logic): today the delete goes through quietly and the problem only shows at
    // Publish. Intended: Delete on a question a Show only if or a jump reads asks first ("Tell us about the budget
    // shows only if Budget is Large. Delete Budget and that rule?"), or the rule shows its problem at once on its
    // card, with Undo putting both back.
  });
});
