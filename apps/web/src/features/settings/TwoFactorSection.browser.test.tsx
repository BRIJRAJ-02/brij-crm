// Two factor setup in Chromium (spec 0033, A122, SA20, SA22, SA34, SA35): the check step's button says what the
// press does ("Email me a code", then "Continue"); the scan step puts the three steps and the setup key beside the QR
// code at a desktop width and under it on a phone, the key in a box that keeps its groups whole with Copy inside, and
// the code's large boxes under it all at the dialog's full width; six digits reach the codes step, ten whole codes in two columns of five;
// Done waits for "I’ve saved these", with focus on Download, and until the tick there is no Close and Esc does
// nothing (Q103); Turn off and Make new codes open
// in the app code’s boxes (Q86), and a backup code there is taken as typed (Q84); each change tells the page (Recent activity reads again); Turn off is quiet in
// its row. axe passes in light and dark.
import '@crm/ui/styles.css';
import type { AccountSecurityState, DataLayer } from '@crm/data';
import { isSessionFresh } from '@crm/data';
import { createToasts } from '@crm/ui';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { setupKey, TwoFactorSection } from './TwoFactorSection.tsx';

/** Two factor off, and this session not checked lately: setup first asks for an emailed code. */
const OFF: AccountSecurityState = {
  status: 'ready',
  twoFactor: { on: false },
  session: { withSecondFactor: false },
  requiredBy: [],
};
const ON: AccountSecurityState = { ...OFF, twoFactor: { on: true, backupCodesLeft: 10 } };

const TOTP_URI =
  'otpauth://totp/Timefix:ada%40example.com?secret=JBSWY3DPEHPK3PXPKRUGS4ZAMFZGCYLT&issuer=Timefix&digits=6&period=30';
const CODES = [
  'A8kd2-Pq9xZ',
  'mT4rw-L0bQe',
  'Zy7Nc-3vHsd',
  'qP2jX-8wKmR',
  'Ld5fG-hT1nV',
  'W9sbE-c6YuK',
  'nR3tM-xJ8pA',
  'Fh6qL-2dZwS',
  'Kc1vY-gN7rB',
  'uE4mP-sW9tH',
];

let shown: InApp | undefined;

beforeEach(async () => {
  await page.viewport(1440, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
});

/** A data layer whose step up and two factor calls all succeed, counting what was asked. */
function layer() {
  const calls: string[] = [];
  const data = {
    account: {
      security: () => ({ reload: () => Promise.resolve() }),
      isFresh: isSessionFresh,
      stepUp: {
        sendCode: () => {
          calls.push('send');
          return Promise.resolve({ ok: true });
        },
        verify: () => {
          calls.push('verify');
          return Promise.resolve({ ok: true });
        },
      },
      twoFactor: {
        start: () => {
          calls.push('start');
          return Promise.resolve({ totpUri: TOTP_URI, backupCodes: CODES });
        },
        confirm: (code: string) => {
          calls.push(`confirm ${code}`);
          return Promise.resolve();
        },
        turnOff: () => {
          calls.push('off');
          return Promise.resolve();
        },
        newBackupCodes: () => Promise.resolve(CODES),
      },
    },
  } as unknown as Partial<DataLayer>;
  return { data, calls };
}

async function render(security: AccountSecurityState, data: Partial<DataLayer>, onChanged: () => void) {
  const toasts = createToasts();
  shown = await renderInApp(
    () => (
      <TwoFactorSection
        data={data as DataLayer}
        security={security}
        toasts={toasts}
        onFocusLost={() => undefined}
        onChanged={onChanged}
      />
    ),
    { data, pattern: '/w/$slug/settings/account/sign-in', at: '/w/acme/settings/account/sign-in', toasts },
  );
}

/** axe on one element, in light and then in dark, once every transition and entry animation has finished. */
async function axeBothThemes(element: Element) {
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    for (const animation of document.getAnimations()) {
      // The code boxes' caret blinks for ever; everything else ends.
      if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
    }
    const results = await axe.run(element, { resultTypes: ['violations'] });
    expect(
      results.violations.map((each) => `${theme} ${each.id}: ${each.nodes.map((node) => node.target).join(', ')}`),
    ).toEqual([]);
  }
  delete document.documentElement.dataset.theme;
}

/** Each space separated group of the text node draws on one line (a split group draws as two boxes). */
function groupsWhole(code: Element) {
  const text = code.firstChild;
  if (!(text instanceof Text)) throw new Error('The key is one text node');
  let start = 0;
  for (const group of text.data.split(' ')) {
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + group.length);
    expect(range.getClientRects(), group).toHaveLength(1);
    start += group.length + 1;
  }
}

/** Opens Set up, asks for the emailed code, enters it, and waits for the scan step. */
async function reachScan() {
  await page.getByRole('button', { name: 'Set up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up two factor sign in' });
  await expect.element(dialog).toBeVisible();
  // The press only emails a code: it says so.
  await expect.element(dialog.getByRole('button', { name: 'Email me a code' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Email me a code' }).click();
  // Once the code's field shows, the button goes on with the setup.
  await expect.element(dialog.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect.element(dialog.getByRole('button', { name: 'Email me a code' })).not.toBeInTheDocument();
  await userEvent.keyboard('123456');
  await expect.element(dialog.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  return dialog;
}

describe('two factor setup', () => {
  it('says Email me a code, then Continue, then shows the three steps beside the QR code', async () => {
    const { data, calls } = layer();
    await render(OFF, data, () => undefined);
    const dialog = await reachScan();
    expect(calls).toEqual(['send', 'verify', 'start']);

    const qr = dialog.getByRole('img', { name: 'QR code for your authenticator app' }).element();
    const steps = [
      '1. Open an authenticator app.',
      '2. Scan the code, or type the key.',
      '3. Enter the 6 digit code.',
    ].map((line) => dialog.getByText(line, { exact: true }).element().getBoundingClientRect());
    const code = qr.getBoundingClientRect();
    for (const step of steps) expect(step.left).toBeGreaterThanOrEqual(code.right);
    expect(Math.round(steps[0]?.top ?? 0)).toBe(Math.round(code.top));

    // The setup key: beside the code too, between step 2 and step 3, in whole groups with Copy inside its box.
    const key = dialog.getByRole('group', { name: 'Setup key' });
    const keyCode = key.element().querySelector('code');
    if (keyCode === null) throw new Error('The setup key shows');
    expect(keyCode.textContent).toBe(setupKey(TOTP_URI));
    const keyBox = keyCode.getBoundingClientRect();
    expect(keyBox.left).toBeGreaterThanOrEqual(code.right);
    expect(keyBox.top).toBeGreaterThanOrEqual(steps[1]?.bottom ?? Infinity);
    expect(keyBox.bottom).toBeLessThanOrEqual(steps[2]?.top ?? -Infinity);
    groupsWhole(keyCode);
    expect(keyCode.parentElement?.contains(key.getByRole('button', { name: 'Copy the setup key' }).element())).toBe(
      true,
    );

    // The code's boxes: large, under the code and the steps, across the dialog's full width, so each is big enough
    // to read and press (A122: inside the steps' column each was about 30px wide).
    const field = dialog.element().querySelector('[data-size="lg"]');
    if (field === null) throw new Error('The code’s boxes show');
    const fieldBox = field.getBoundingClientRect();
    expect(fieldBox.top).toBeGreaterThanOrEqual(Math.max(code.bottom, steps[2]?.bottom ?? Infinity));
    expect(Math.round(fieldBox.left)).toBe(Math.round(code.left));
    const boxes = [...field.querySelectorAll('span[aria-hidden="true"]')];
    expect(boxes).toHaveLength(6);
    for (const box of boxes) expect(box.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    await expect.element(dialog.getByRole('textbox', { name: 'Code from your authenticator app' })).toHaveFocus();
    await axeBothThemes(dialog.element());
  });

  it('puts the steps under the QR code on a phone, keeping the key’s groups whole', async () => {
    await page.viewport(390, 844);
    const { data } = layer();
    await render(OFF, data, () => undefined);
    const dialog = await reachScan();
    const code = dialog.getByRole('img', { name: 'QR code for your authenticator app' }).element();
    const first = dialog.getByText('1. Open an authenticator app', { exact: false }).element();
    expect(first.getBoundingClientRect().top).toBeGreaterThanOrEqual(code.getBoundingClientRect().bottom);
    expect(Math.round(first.getBoundingClientRect().left)).toBe(Math.round(code.getBoundingClientRect().left));
    const keyCode = dialog.getByRole('group', { name: 'Setup key' }).element().querySelector('code');
    if (keyCode === null) throw new Error('The setup key shows');
    groupsWhole(keyCode);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('reaches the codes step on six digits: ten whole codes in two columns, Done after I’ve saved these', async () => {
    const { data, calls } = layer();
    let changed = 0;
    await render(OFF, data, () => {
      changed += 1;
    });
    const dialog = await reachScan();
    await userEvent.keyboard('654321');
    const codesDialog = page.getByRole('dialog', { name: 'Save your backup codes' });
    await expect.element(codesDialog).toBeVisible();
    expect(calls).toContain('confirm 654321');
    expect(changed).toBe(1);

    const items = [...codesDialog.element().querySelectorAll('code > span')];
    expect(items.map((item) => item.textContent)).toEqual(CODES);
    expect(new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))).size).toBe(2);
    expect(new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size).toBe(5);
    expect(
      codesDialog.element().contains(codesDialog.getByRole('button', { name: 'Copy the backup codes' }).element()),
    );

    // Focus starts on Download, not on the title bar's Close, where an Enter would end the only showing (Q103).
    await expect.element(codesDialog.getByRole('button', { name: 'Download' })).toHaveFocus();
    const done = codesDialog.getByRole('button', { name: 'Done' });
    await expect.element(done).toBeDisabled();
    // Kept until the tick: no Close in the title bar, and Esc leaves the codes showing.
    expect(codesDialog.element().querySelector('button[aria-label="Close"]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.element(codesDialog).toBeVisible();
    await codesDialog.getByText('I’ve saved these').click();
    await expect.element(done).toBeEnabled();
    await expect.element(codesDialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await axeBothThemes(codesDialog.element());
    await done.click();
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe('two factor, on', () => {
  it('keeps Turn off quiet in its row, with the reason in an InfoTip beside the row’s name', async () => {
    const { data } = layer();
    await render(ON, data, () => undefined);
    const turnOff = page.getByRole('button', { name: 'Turn off' });
    await expect.element(turnOff).toHaveAttribute('data-variant', 'secondary');
    expect(page.getByText('Ask for a code from an app when you sign in.').elements()).toEqual([]);
    await expect.element(page.getByRole('button', { name: 'About Authenticator app' })).toBeVisible();
    const section = turnOff.element().closest('section');
    if (section === null) throw new Error('The section shows');
    await axeBothThemes(section);
  });

  it('tells the page once new backup codes are made', async () => {
    const { data } = layer();
    let changed = 0;
    // Fresh with the second factor: no step up, so the confirm's button makes the codes at once.
    const fresh: AccountSecurityState = {
      ...ON,
      session: { withSecondFactor: true, freshUntil: new Date(Date.now() + 600_000).toISOString() },
    };
    await render(fresh, data, () => {
      changed += 1;
    });
    await page.getByRole('button', { name: 'Make new codes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make new backup codes?' });
    await dialog.getByRole('button', { name: 'Make new codes' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Save your backup codes' })).toBeVisible();
    expect(changed).toBe(1);
  });

  it('opens Turn off and Make new codes in the app code’s boxes, so a code typed at once is taken (Q86)', async () => {
    const { data, calls } = layer();
    await render(ON, data, () => undefined);
    await page.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('alertdialog', { name: 'Turn off two factor sign in?' });
    await expect.element(off.getByRole('textbox', { name: 'Code from your authenticator app' })).toHaveFocus();
    await userEvent.keyboard('123456');
    await expect.element(off).not.toBeInTheDocument();
    expect(calls).toEqual(['verify', 'off']);

    await page.getByRole('button', { name: 'Make new codes' }).click();
    const codes = page.getByRole('dialog', { name: 'Make new backup codes?' });
    await expect.element(codes.getByRole('textbox', { name: 'Code from your authenticator app' })).toHaveFocus();
    await userEvent.keyboard('654321');
    const saved = page.getByRole('dialog', { name: 'Save your backup codes' });
    await expect.element(saved).toBeVisible();
    await expect.element(saved.getByRole('button', { name: 'Download' })).toHaveFocus();
    // As setup's codes: kept until "I’ve saved these" is ticked (Q103).
    expect(saved.element().querySelector('button[aria-label="Close"]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.element(saved).toBeVisible();
  });

  it('takes a backup code as typed: no capitals, corrections or spell check on a phone (Q84)', async () => {
    const { data } = layer();
    await render(ON, data, () => undefined);
    await page.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('alertdialog', { name: 'Turn off two factor sign in?' });
    await off.getByRole('button', { name: 'Use a backup code' }).click();
    const field = off.getByRole('textbox', { name: 'Backup code' });
    await expect.element(field).toHaveAttribute('autocapitalize', 'off');
    await expect.element(field).toHaveAttribute('autocorrect', 'off');
    await expect.element(field).toHaveAttribute('spellcheck', 'false');
  });
});
