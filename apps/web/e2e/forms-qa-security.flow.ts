// Forms QA, security edges (5 November 2026): the spam trap is out of everyone's reach but a bot's; markup a
// visitor types reaches Submissions, the team's email and the CSV export as the characters it is, never as markup or
// a formula; and the sixth send in a minute from one address is turned away and stored nowhere. A file whose bytes
// aren't what its name says is checked in forms-qa-stress.flow.ts (the upload) and in the api's uploads.test.ts.
// The rate limit check runs last: it spends this address's minute.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { MAILPIT_URL } from './mailpit.ts';
import {
  asOwner,
  countSubmits,
  expectThanks,
  HUMAN_PACE_MS,
  liveForm,
  makeOwner,
  q,
  rpc,
  baseOf,
  uuidv7,
  send,
  submissionsOf,
  TRY_AGAIN,
  visitorOn,
  type Owner,
} from './forms-qa.ts';

/** The trap's input name (`HONEYPOT_INPUT_NAME` in `@crm/contracts/forms`). */
const HONEYPOT = 'tf-trap';

let owner: Owner;
const IMG = '<img src=x onerror="window.__formsQaXss=1">';
const SCRIPT = '<script>window.__formsQaXss=2</script>';

test.describe('forms QA: security edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the security edges.');
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    owner = await makeOwner(browser, testInfo, 'sec');
  });

  test('the spam trap is hidden from sight, from Tab and from screen readers', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Trap ${randomUUID().slice(0, 6)}`);
    const visitor = await visitorOn(browser, form);
    const trap = visitor.locator(`input[name="${HONEYPOT}"]`);
    await expect(trap).toHaveCount(1);
    await expect(trap).toHaveAttribute('tabindex', '-1');
    expect(await trap.evaluate((input) => input.closest('[aria-hidden="true"]') !== null)).toBe(true);
    // Visually hidden: clipped to nothing, whatever box it keeps for the bots.
    expect(
      await trap.evaluate((input) => {
        const box = input.getBoundingClientRect();
        const clipped = (element: Element | null): boolean => {
          if (element === null) return false;
          const style = getComputedStyle(element);
          return (
            style.clipPath === 'inset(50%)' ||
            style.getPropertyValue('clip') === 'rect(0px, 0px, 0px, 0px)' ||
            (element.getBoundingClientRect().width <= 1 && style.overflow === 'hidden') ||
            clipped(element.parentElement)
          );
        };
        return (box.width <= 1 && box.height <= 1) || clipped(input);
      }),
    ).toBe(true);
    // Tab through the whole form: it never stops on the trap.
    for (let press = 0; press < 25; press += 1) {
      await visitor.keyboard.press('Tab');
      expect(await trap.evaluate((input) => input === document.activeElement)).toBe(false);
    }
    // Not in the accessibility tree.
    await expect(visitor.getByRole('textbox', { name: 'Leave this empty' })).toHaveCount(0);
    await visitor.context().close();
  });

  test('markup typed into a form reads as text in Submissions, the team’s email and the CSV', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await asOwner(page, owner);
    const formName = `Markup ${randomUUID().slice(0, 6)}`;
    const form = await liveForm(page, owner, formName, (draft) => ({
      ...draft,
      questions: [...draft.questions, q('story', 'Tell us your story', 'long_text')],
    }));
    const email = `ada-markup-${form.id.slice(-6)}@example.com`;
    const visitor = await visitorOn(browser, form);
    await visitor.getByLabel(/Your name/).fill(`Ada ${IMG}`);
    await visitor.getByLabel(/Work email/).fill(email);
    await visitor.getByLabel(/Tell us your story/).fill(`${SCRIPT}\n=HYPERLINK("http://evil.example","x")`);
    await send(visitor);
    await expectThanks(visitor);
    // The read back of what was sent shows it as text, and runs nothing.
    await expect(visitor.getByText(IMG, { exact: false }).first()).toBeVisible();
    expect(await visitor.evaluate(() => (globalThis as { __formsQaXss?: number }).__formsQaXss)).toBeUndefined();
    await visitor.context().close();

    // Submissions: the row and its detail show the characters, and nothing ran.
    await page.goto(`/w/${owner.slug}/captures/forms/${form.id}?tab=submissions`);
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.click();
    await expect(page.getByText(SCRIPT, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (globalThis as { __formsQaXss?: number }).__formsQaXss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);

    // The team's email (the form's maker is told): the HTML part escapes it.
    const ownerEmail = `${owner.slug}@example.com`;
    let html = '';
    await expect
      .poll(
        async () => {
          const list = (await (await page.request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as {
            messages: { ID: string; Subject: string; To: { Address: string }[] | null }[];
          };
          const found = list.messages.find(
            (message) =>
              message.Subject.includes(formName) &&
              (message.To ?? []).some((to) => to.Address.toLowerCase() === ownerEmail),
          );
          if (found === undefined) return false;
          html = (
            (await (await page.request.get(`${MAILPIT_URL}/api/v1/message/${found.ID}`)).json()) as { HTML: string }
          ).HTML;
          return true;
        },
        { timeout: 90_000, message: 'the new submission email in Mailpit' },
      )
      .toBe(true);
    expect(html).not.toContain(IMG);
    expect(html).not.toMatch(/<script>window\.__formsQaXss/);
    expect(html).toContain('&lt;img');

    // The CSV: no cell a spreadsheet would run. Started as the Export button starts it, then downloaded once the
    // job has written it (the button's own toast is the UI's business; the file is what matters here).
    const started = await rpc<{ downloadPath: string }>(page, 'submissions/export', {
      workspace: owner.slug,
      id: uuidv7(),
      formId: form.id,
      select: { kind: 'filter' },
      mutationId: randomUUID(),
    });
    let csv = '';
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${baseOf()}${started.downloadPath}`);
          csv = response.ok() ? await response.text() : '';
          return response.status();
        },
        { timeout: 90_000, message: 'the CSV export to finish' },
      )
      .toBe(200);
    const cells = [...csv.replace(/^\uFEFF/u, '').matchAll(/("([^"]|"")*"|[^,\r\n]*)(,|\r\n|$)/gu)].map((match) => {
      const raw = match[1] ?? '';
      return raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw;
    });
    expect(cells.filter((cell) => /^[=+\-@\t\r]/u.test(cell))).toEqual([]);
    expect(cells.some((cell) => cell.includes(SCRIPT))).toBe(true);
  });

  test('the sixth send in a minute from one address is turned away and stored nowhere', async ({ page, browser }) => {
    test.setTimeout(300_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Limit ${randomUUID().slice(0, 6)}`);
    // Start from a fresh minute, so the earlier sends of this run don't count.
    await page.waitForTimeout(61_000);
    const visitor = await visitorOn(browser, form);
    const submits = countSubmits(visitor);
    let turnedAway = false;
    for (let sent = 1; sent <= 6 && !turnedAway; sent += 1) {
      if (sent > 1) await visitor.goto(visitor.url());
      await visitor.getByLabel(/Your name/).fill(`Visitor ${String(sent)}`);
      await visitor.getByLabel(/Work email/).fill(`v${String(sent)}-${form.id.slice(-6)}@example.com`);
      await visitor.waitForTimeout(HUMAN_PACE_MS);
      await visitor.getByRole('button', { name: 'Send', exact: true }).click();
      const outcome = await Promise.race([
        visitor
          .getByRole('heading', { name: /Thanks, we got it/ })
          .first()
          .waitFor({ timeout: 15_000 })
          .then(() => 'sent'),
        visitor
          .getByText(TRY_AGAIN)
          .waitFor({ timeout: 15_000 })
          .then(() => 'away'),
      ]);
      turnedAway = outcome === 'away';
    }
    expect(turnedAway, 'six sends in a minute all went through').toBe(true);
    expect(submits()).toBeLessThanOrEqual(6);
    // At most five stored: the one turned away left nothing behind.
    expect((await submissionsOf(page, owner, form)).length).toBeLessThanOrEqual(5);
    await visitor.context().close();
    // Leave the minute spent for no one after this file.
    await page.waitForTimeout(61_000);
  });
});
