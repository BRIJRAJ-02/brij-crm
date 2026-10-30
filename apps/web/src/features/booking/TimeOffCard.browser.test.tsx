// Availability's Time off section in Chromium (spec 0037, AC-1285, AC-1286, AC-1445): upcoming rows with their reason
// and stand in, Add time off by keyboard and pointer, the meetings inside listed after a save over them, Delete asking
// first, See reading Away alone with nothing to change, and no axe violations in either theme. With
// TIME_OFF_SHOTS set it saves the section at 390 and 1280 wide, light and dark.
import '@crm/ui/styles.css';
import type { DataLayer, TimeOffEntry, TimeOffHeld, TimeOffList, TimeOffSaved, TimeOffState } from '@crm/data';
import { Card, PageColumn } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { TimeOffCard } from './TimeOffCard.tsx';

const ME = '00000000-0000-7000-8000-000000000001';
const BO = '00000000-0000-7000-8000-000000000002';
const SAM = '00000000-0000-7000-8000-000000000003';
const PEOPLE = [
  { id: ME, name: 'Ada Lovelace' },
  { id: BO, name: 'Bo Stand' },
  { id: SAM, name: 'Sam Lee' },
];
const nameOf = (id: string) => PEOPLE.find((each) => each.id === id)?.name;

const entry = (id: string, from: string, to: string, over: Partial<TimeOffEntry> = {}): TimeOffEntry => ({
  id,
  memberId: ME,
  fromDate: from,
  toDate: to,
  timeZone: 'UTC',
  startsAt: `${from}T00:00:00.000Z`,
  endsAt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString(),
  reason: 'vacation',
  updatedAt: '2026-10-30T10:00:00.000Z',
  ...over,
});
const UPCOMING = [
  entry('a', '2030-11-03', '2030-11-07', { standinMemberId: BO, note: 'Lisbon' }),
  entry('b', '2030-12-24', '2030-12-26', {
    reason: 'holiday',
    changedBy: { memberId: SAM, at: '2030-10-01T10:00:00Z' },
  }),
];
const PAST = [entry('p', '2026-09-01', '2026-09-02', { reason: 'sick' })];

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** The data layer's time off store, in memory. */
function fake(list: TimeOffList, inside: TimeOffSaved['bookingsInside'] = []) {
  let state: TimeOffState = { status: 'ready', list };
  const listeners = new Set<() => void>();
  const set = (next: TimeOffList) => {
    state = { status: 'ready', list: next };
    for (const listener of listeners) listener();
  };
  const held: TimeOffHeld = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
  const created: unknown[] = [];
  const removed: string[] = [];
  const timeOff = {
    newId: () => 'new',
    held: () => held,
    create: (_workspace: string, input: { id: string; fromDate: string; toDate: string }) => {
      created.push(input);
      const made = entry(input.id, input.fromDate, input.toDate);
      if (state.status === 'ready') set({ ...state.list, upcoming: [...state.list.upcoming, made] });
      return Promise.resolve({ entry: made, bookingsInside: inside, moreInside: 0 });
    },
    update: () => Promise.reject(new Error('not here')),
    remove: (_workspace: string, gone: TimeOffEntry) => {
      removed.push(gone.id);
      if (state.status === 'ready') {
        set({ ...state.list, upcoming: state.list.upcoming.filter((each) => each.id !== gone.id) });
      }
      return Promise.resolve(true);
    },
  };
  const data = { scheduling: { loaded: () => ({ timeOff }) } } as unknown as DataLayer;
  return { data, created, removed };
}

async function render(
  list: TimeOffList,
  options: { inside?: TimeOffSaved['bookingsInside']; member?: { id: string; name: string } } = {},
) {
  const made = fake(list, options.inside);
  shown = await renderInApp(
    () => (
      <PageColumn>
        <Card title="Weekly hours">Monday to Friday, 9:00 AM to 5:00 PM</Card>
        <TimeOffCard
          data={made.data}
          slug="acme"
          member={options.member}
          me={ME}
          nameOf={nameOf}
          people={PEOPLE}
          onNotice={() => undefined}
          onOpenBookings={() => undefined}
        />
      </PageColumn>
    ),
    { data: made.data, pattern: '/w/$slug/bookings/availability', at: '/w/acme/bookings/availability' },
  );
  return made;
}

const mine = (over: Partial<TimeOffList> = {}): TimeOffList => ({
  memberId: ME,
  upcoming: UPCOMING,
  past: PAST,
  canManage: true,
  ...over,
});

describe('Time off', () => {
  it('lists upcoming time off with its reason, stand in, note and who changed it, past ones folded', async () => {
    await render(mine());
    await expect.element(page.getByRole('rowheader', { name: '3 to 7 Nov 2030' })).toBeVisible();
    await expect.element(page.getByText('Vacation · Bo covers')).toBeVisible();
    await expect.element(page.getByText('Public holiday · Changed by Sam Lee')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Past/ })).toBeVisible();
    await expect.element(page.getByText('Sick leave')).not.toBeVisible();
  });

  it('adds time off from the keyboard and lists the meetings already inside (AC-1285)', async () => {
    const made = await render(mine({ upcoming: [], past: [] }), {
      inside: [
        {
          id: 'k1',
          visitorName: 'Pat One',
          pageTitle: 'Check up',
          startsAt: '2030-11-04T09:00:00.000Z',
          endsAt: '2030-11-04T09:30:00.000Z',
        },
      ],
    });
    await expect.element(page.getByText('No time off planned')).toBeVisible();
    await page.getByRole('button', { name: 'Add time off' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add time off' });
    await expect.element(dialog).toBeVisible();
    // Save with no days says so on the field.
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.element(dialog.getByText('Pick the days.')).toBeVisible();
    // Type the range into its segments: month, day, year, then the end.
    const [first] = dialog.getByRole('spinbutton').elements();
    if (first === undefined) throw new Error('no date segment');
    await userEvent.click(first);
    await userEvent.keyboard('04112030');
    await userEvent.keyboard('05112030');
    // Workable's plain count, with what time off does (Fresha's line).
    await expect.element(dialog.getByText(/2 days off\. Whole days, in your time zone/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    const inside = page.getByRole('dialog', { name: 'Time off saved' });
    await expect.element(inside.getByText('You have 1 meeting during this period.').first()).toBeVisible();
    await expect.element(inside.getByText('Pat One · Check up')).toBeVisible();
    expect(made.created).toHaveLength(1);
    await inside.getByRole('button', { name: 'Done' }).click();
  });

  it('asks before deleting, saying what happens (AC-1445), then removes the row', async () => {
    const made = await render(mine());
    await page.getByRole('button', { name: 'Actions for 3 to 7 Nov 2030' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete time off, 3 to 7 Nov 2030?' });
    await expect.element(confirm.getByText('Online bookings can be placed on these days again.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete time off' }).click();
    expect(made.removed).toEqual(['a']);
    await expect.element(page.getByText('Vacation · Bo covers')).not.toBeInTheDocument();
  });

  it('shows a colleague the reader may only See as Away, with nothing to change (AC-1286)', async () => {
    const seen = UPCOMING.map(({ reason: _r, note: _n, standinMemberId: _s, ...rest }) => rest);
    await render(mine({ memberId: SAM, upcoming: seen, past: [], canManage: false }), {
      member: { id: SAM, name: 'Sam Lee' },
    });
    await expect.element(page.getByText('Away').first()).toBeVisible();
    await expect.element(page.getByText(/Lisbon/)).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Add time off/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await render(mine());
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_TIME_OFF_SHOTS === '1')(
    'saves screenshots at 390 and 1280, light and dark',
    async () => {
      // Beside this file (Vite serves nothing outside the project); the lane moves them to its scratchpad.
      const dir = 'timeoff-shots';
      for (const width of [390, 1280]) {
        for (const theme of THEMES) {
          await page.viewport(width, 900);
          await render(mine());
          applyTheme(theme);
          await page.screenshot({ path: `${dir}/section-${String(width)}-${theme}.png` });
          await page.getByRole('button', { name: 'Add time off' }).click();
          await expect.element(page.getByRole('dialog', { name: 'Add time off' })).toBeVisible();
          // Past its enter animation.
          await new Promise((resolve) => setTimeout(resolve, 400));
          await page.screenshot({ path: `${dir}/dialog-${String(width)}-${theme}.png` });
          shown?.unmount();
          shown = undefined;
          resetTheme();
        }
      }
    },
  );
});
