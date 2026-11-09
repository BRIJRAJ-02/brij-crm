// The Members page with the library's styles, in Chromium (owner ask T12, 5 November 2026): no axe violations in either
// theme with someone asking to join, someone invited and a row's details open, and the Role picker's chevron beside
// its word, in the table and in the details, however wide the slot. The shape the owner asked for on 6 November 2026
// too: a request's Approve and Decline on one line, Owner and Member on one edge, a switch near its label, the list
// not leaving a role far from its name, and the phone's two lines.
import '@crm/ui/styles.css';
import type {
  DataLayer,
  InvitationView,
  JoinRequestView,
  MemberReachView,
  MemberView,
  MyAccess,
  RolesList,
  RolesOverview,
} from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { MembersScreen } from './MembersScreen.tsx';

const ADA: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'owner',
  joinedAt: '2026-10-01T09:00:00.000Z',
};
const LINUS: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000002',
  name: 'Linus Torvalds',
  email: 'linus@example.com',
  role: 'member',
  joinedAt: '2026-10-02T09:00:00.000Z',
};
const GRACE: InvitationView = {
  id: '0199a6f2-0000-7000-8000-0000000000a1',
  kind: 'email',
  email: 'grace@example.com',
  role: 'member',
  invitedBy: 'Ada Lovelace',
  invitedAt: '2026-10-20T09:00:00.000Z',
  expiresAt: '2026-10-27T09:00:00.000Z',
  isExpired: false,
};
const MARY: JoinRequestView = {
  id: '0199a6f2-0000-7000-8000-0000000000b1',
  name: 'Mary Shelley',
  email: 'mary@acme.com',
  requestedAt: '2026-10-22T09:00:00.000Z',
};
const ROLES: RolesList = {
  roles: [
    { id: 'owner', label: 'Owner', description: 'Everything.', builtIn: 'owner' },
    { id: 'admin', label: 'Admin', description: 'Members and settings.', builtIn: 'admin' },
    { id: 'member', label: 'Member', description: 'Records.', builtIn: 'member' },
  ],
  defaultRole: 'member',
};
const OVERVIEW = { roles: [], defaultRole: 'member' } as unknown as RolesOverview;
const ACCESS: MyAccess = {
  memberId: ADA.id,
  role: 'owner',
  roleLabel: 'Owner',
  permissions: ['members.invite', 'members.manage'],
};

const READY = { status: 'ready', delegations: [] } as const;
const delegations = {
  subscribe: () => () => undefined,
  getSnapshot: () => READY,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};
const healthState = { status: 'loading' } as const;
const health = {
  held: () => ({ subscribe: () => () => undefined, getSnapshot: () => healthState, retain: () => () => undefined }),
  ask: () => Promise.resolve(true),
};

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

async function render(
  members: readonly MemberView[] = [ADA, LINUS],
  extra: Record<string, unknown> = {},
  access: MyAccess = ACCESS,
) {
  const toasts = createToasts();
  const data = {
    scheduling: { loaded: () => ({ delegations: () => delegations, health }) },
    members: { watch: () => () => undefined, list: () => Promise.resolve([ADA, LINUS]) },
    ...extra,
  } as unknown as Partial<DataLayer>;
  shown = await renderInApp(
    () => (
      <MembersScreen
        data={data as DataLayer}
        toasts={toasts}
        slug="acme"
        workspaceName="Acme"
        page={{ members: [...members], total: members.length }}
        search=""
        onSearch={() => undefined}
        invitations={[GRACE]}
        requests={[MARY]}
        access={access}
        roles={ROLES}
        overview={OVERVIEW}
      />
    ),
    { data, toasts, pattern: '/w/$slug/settings/members', at: '/w/acme/settings/members' },
  );
}

/** The space between a Select's trigger start and its chevron, against what the slot around it offers. */
function hugs(trigger: Element) {
  const slot = trigger.closest('td, dd');
  if (slot === null) throw new Error('expected the picker in a cell or a description');
  return trigger.getBoundingClientRect().width < slot.getBoundingClientRect().width / 2;
}

const BARBARA: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000003',
  name: 'Barbara Liskov',
  email: 'barbara@example.com',
  role: 'member',
  joinedAt: '2026-10-03T09:00:00.000Z',
};

describe('Members, the owner’s shape (6 November 2026)', () => {
  it('keeps a request’s Approve and Decline on one line', async () => {
    await render();
    const approve = page.getByRole('button', { name: 'Approve Mary Shelley' }).element().getBoundingClientRect();
    const decline = page.getByRole('button', { name: 'Decline Mary Shelley' }).element().getBoundingClientRect();
    expect(Math.round(approve.top)).toBe(Math.round(decline.top));
    expect(decline.left).toBeGreaterThan(approve.right);
  });

  it('stands a role’s text and a role’s picker on one edge', async () => {
    await render();
    const row = (name: RegExp) => page.getByRole('row', { name }).element();
    const adaRole = [...row(/Ada Lovelace.*You/).querySelectorAll('td')].find((each) => each.textContent === 'Owner');
    if (adaRole === undefined) throw new Error('expected Ada’s role');
    const text = document.createRange();
    text.selectNodeContents(adaRole);
    const word = page
      .getByRole('button', { name: /Role for Linus Torvalds/ })
      .element()
      .querySelector('span');
    if (word === null) throw new Error('expected the picker’s word');
    expect(Math.abs(text.getBoundingClientRect().left - word.getBoundingClientRect().left)).toBeLessThan(1);
  });

  it('shows no checkboxes for one person to change, and waits for the pointer with two', async () => {
    await render();
    expect(page.getByRole('checkbox').elements()).toHaveLength(0);
    shown?.unmount();
    await render([ADA, LINUS, BARBARA]);
    const box = page.getByRole('checkbox', { name: /^Select Linus Torvalds/ }).element();
    const label = box.closest('label');
    if (label === null) throw new Error('expected the checkbox’s label');
    // The rows are as wide with them as without: the column keeps its place.
    expect(getComputedStyle(label).display).not.toBe('none');
  });

  it('keeps the Role column near the name on a wide screen', async () => {
    await page.viewport(1920, 1080);
    await render();
    const name = page.getByRole('columnheader', { name: 'Name' }).element().getBoundingClientRect();
    const role = page.getByRole('columnheader', { name: 'Role' }).element().getBoundingClientRect();
    // Before, the browser gave the person 60% of the table, 900px of nothing at this width: now 40% (and a little).
    const table = page.getByRole('grid').element().getBoundingClientRect();
    expect((role.left - name.left) / table.width).toBeLessThan(0.45);
    await page.viewport(1280, 800);
  });

  it.each(THEMES)('has no axe violations in %s on a phone, on its two lines', async (theme) => {
    await page.viewport(390, 844);
    await render();
    const row = page
      .getByRole('row', { name: /Linus Torvalds/ })
      .element()
      .getBoundingClientRect();
    const menu = page.getByRole('button', { name: 'Actions for Linus Torvalds' }).element().getBoundingClientRect();
    const name = page.getByText('Linus Torvalds', { exact: true }).element().getBoundingClientRect();
    // The menu has the first line's end, beside the name, never under it.
    expect(menu.top).toBeLessThan(name.bottom);
    expect(menu.right).toBeLessThanOrEqual(row.right);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
    await page.viewport(1280, 800);
  });
});

describe('Members, styled', () => {
  it.each(THEMES)('has no axe violations in %s, with the table and a row’s details', async (theme) => {
    await render();
    await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
    await expect.element(page.getByRole('dialog', { name: 'Linus Torvalds' })).toBeVisible();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it('keeps the Role picker’s chevron beside its word, in the table and in the details', async () => {
    await render();
    expect(hugs(page.getByRole('button', { name: /Role for Linus Torvalds/ }).element())).toBe(true);
    await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
    const details = page.getByRole('dialog', { name: 'Linus Torvalds' });
    await expect.element(details).toBeVisible();
    expect(hugs(details.getByRole('button', { name: /Role/ }).element())).toBe(true);
  });
});

describe('Works in, styled (spec 0065 H7, AC-6594)', () => {
  const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
  const reachView: MemberReachView = {
    memberId: LINUS.id,
    reach: { all: false, properties: [], places: ['0199a6f2-0000-7000-8000-0000000000b1'] },
    fixed: false,
    businesses: [
      {
        id: '0199a6f2-0000-7000-8000-00000000000a',
        name: 'Somewhere Nowhere',
        places: [{ id: '0199a6f2-0000-7000-8000-0000000000a1', name: 'Soho' }],
      },
      {
        id: '0199a6f2-0000-7000-8000-00000000000b',
        name: 'Harbour Bar',
        places: [
          { id: '0199a6f2-0000-7000-8000-0000000000b1', name: 'Quay' },
          { id: '0199a6f2-0000-7000-8000-0000000000b2', name: 'Pier' },
        ],
      },
    ],
  };
  const store = { memberReach: () => Promise.resolve(reachView), setMemberReach: () => Promise.resolve(reachView) };
  const admin: MyAccess = { ...ACCESS, permissions: [...ACCESS.permissions, 'workspace.manage'] };

  it('reads where someone works, and opens on each business under its heading, in both themes and widths', async () => {
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        await page.viewport(width, 800);
        await render([ADA, LINUS], { hospitality: { load: () => Promise.resolve(store) } }, admin);
        await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
        const details = page.getByRole('dialog', { name: 'Linus Torvalds' });
        await expect.element(details.getByText('Works in', { exact: true })).toBeVisible();
        const trigger = details.getByRole('button', { name: /Where Linus Torvalds works/ });
        await expect.element(details.getByText('Quay').first()).toBeVisible();
        expect(hugs(trigger.element())).toBe(true);
        applyTheme(theme);
        expect(await axeViolations()).toEqual([]);
        if (SHOT_DIR !== undefined && SHOT_DIR !== '') {
          await page.screenshot({ path: `${SHOT_DIR}/works-in-${theme}-${String(width)}.png` } as never);
        }
        await trigger.click();
        await expect.element(page.getByRole('option', { name: 'All of Harbour Bar' })).toBeVisible();
        // The list fades in: axe reads contrast mid fade on a slow runner, so the entrance finishes first. Only
        // animations that end: a looping one (a loading shimmer) never settles and would hold the test forever.
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        expect(await axeViolations()).toEqual([]);
        if (SHOT_DIR !== undefined && SHOT_DIR !== '') {
          await page.screenshot({ path: `${SHOT_DIR}/works-in-open-${theme}-${String(width)}.png` } as never);
        }
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
    await page.viewport(1280, 800);
    // Four renders, each read twice by axe: a busy CI runner needs more than the default (9 Nov 2026).
  }, 40_000);
});
