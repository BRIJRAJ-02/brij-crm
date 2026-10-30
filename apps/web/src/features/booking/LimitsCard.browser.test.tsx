// Availability's Limits section in Chromium (spec 0037, AC-1299): each limit's Switch and number with its count
// ("4 of 20 this week"), turning one on saves a starting number, a number saves on Enter and a bad one says why
// without saving, See reads them with nothing to change, and no axe violations in either theme. With LIMITS_SHOTS
// set it saves the section at 390 and 1280 wide, light and dark.
import '@crm/ui/styles.css';
import type { DataLayer, LimitsDraft, LimitsHeld, LimitsState, MeetingLimits } from '@crm/data';
import { Card, PageColumn } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LimitsCard } from './LimitsCard.tsx';

const ME = '00000000-0000-7000-8000-000000000001';
const SAM = '00000000-0000-7000-8000-000000000003';

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** The data layer's limits store, in memory: a change shows at once, as the real one does. */
function fake(initial: MeetingLimits) {
  let state: LimitsState = { status: 'ready', limits: initial };
  const listeners = new Set<() => void>();
  const held: LimitsHeld = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
  const saved: LimitsDraft[] = [];
  const limits = {
    held: () => held,
    set: (_workspace: string, _member: string | undefined, draft: LimitsDraft) => {
      saved.push(draft);
      if (state.status === 'ready') {
        const { perDay: _d, perWeek: _w, ...rest } = state.limits;
        state = {
          status: 'ready',
          limits: {
            ...rest,
            ...(draft.perDay === undefined ? {} : { perDay: draft.perDay }),
            ...(draft.perWeek === undefined ? {} : { perWeek: draft.perWeek }),
          },
        };
        for (const listener of listeners) listener();
      }
      return Promise.resolve(true);
    },
  };
  const data = { scheduling: { loaded: () => ({ limits }) } } as unknown as DataLayer;
  return { data, saved };
}

async function render(limits: MeetingLimits, member?: { id: string; name: string }) {
  const made = fake(limits);
  shown = await renderInApp(
    () => (
      <PageColumn>
        <Card title="Weekly hours">Monday to Friday, 9:00 AM to 5:00 PM</Card>
        <LimitsCard data={made.data} slug="acme" member={member} />
      </PageColumn>
    ),
    { data: made.data, pattern: '/w/$slug/bookings/availability', at: '/w/acme/bookings/availability' },
  );
  return made;
}

const mine = (over: Partial<MeetingLimits> = {}): MeetingLimits => ({
  memberId: ME,
  today: 2,
  thisWeek: 4,
  timeZone: 'UTC',
  canChange: true,
  ...over,
});

describe('Meeting limits', () => {
  it('shows each limit with this day’s and week’s count beside it (AC-1299)', async () => {
    await render(mine({ perWeek: 20 }));
    await expect.element(page.getByRole('switch', { name: 'Limit meetings a week' })).toBeChecked();
    await expect.element(page.getByRole('textbox', { name: 'Meetings a week' })).toHaveValue('20');
    await expect.element(page.getByText('4 of 20 this week')).toBeVisible();
    await expect.element(page.getByRole('switch', { name: 'Limit meetings a day' })).not.toBeChecked();
    await expect.element(page.getByText('2 meetings today, no limit.')).toBeVisible();
  });

  it('turns a limit on with a starting number, saves a typed one on Enter, and refuses one out of range', async () => {
    const made = await render(mine());
    await page.getByRole('switch', { name: 'Limit meetings a day' }).click();
    expect(made.saved).toEqual([{ perDay: 8, perWeek: undefined }]);
    const field = page.getByRole('textbox', { name: 'Meetings a day' });
    await expect.element(field).toHaveValue('8');
    await field.fill('60');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Use a whole number from 1 to 50.')).toBeVisible();
    expect(made.saved).toHaveLength(1);
    await field.fill('5');
    await userEvent.keyboard('{Enter}');
    expect(made.saved.at(-1)).toEqual({ perDay: 5, perWeek: undefined });
    await expect.element(page.getByText('2 of 5 today')).toBeVisible();
    // Off clears it.
    await page.getByRole('switch', { name: 'Limit meetings a day' }).click();
    expect(made.saved.at(-1)).toEqual({ perDay: undefined, perWeek: undefined });
  });

  it('shows a colleague the reader may only See read only, saying why', async () => {
    await render(mine({ memberId: SAM, perDay: 3, canChange: false }), { id: SAM, name: 'Sam Lee' });
    await expect.element(page.getByText(/You can see Sam’s meeting limits but not change them\./)).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Meetings a day' })).toHaveAttribute('readonly');
    await expect.element(page.getByText('2 of 3 today')).toBeVisible();
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await render(mine({ perDay: 3, perWeek: 20 }));
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_LIMITS_SHOTS === '1')('saves screenshots at 390 and 1280, light and dark', async () => {
    const dir = 'limits-shots';
    for (const width of [390, 1280]) {
      for (const theme of THEMES) {
        await page.viewport(width, 900);
        await render(mine({ perWeek: 20 }));
        applyTheme(theme);
        await page.screenshot({ path: `${dir}/section-${String(width)}-${theme}.png` });
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
  });
});
