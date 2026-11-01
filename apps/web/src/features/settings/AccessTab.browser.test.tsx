// An object's Access tab in Chromium (spec 0037, AC-1230): custom roles sit after Members and Guests, each with how
// many people hold it; a read only role can be seen but never given edit, and says why; a role's change sends its
// own subject. No axe violations in either theme. With ACCESS_SHOTS set it saves the tab at 390 and 1440, light and
// dark.
import '@crm/ui/styles.css';
import type { DataLayer, ObjectAccess, ObjectSummary, RuleSubject, SubjectAccess } from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AccessTab } from './AccessTab.tsx';

const COMPANIES = '0199f0a0-0000-7000-8000-000000000002';
const NAME = '0199f0a0-0000-7000-8000-0000000000a1';
const OWNER = '0199f0a0-0000-7000-8000-0000000000a2';
const RECEPTION = '0199f0a0-0000-7000-8000-0000000000b1';
const VIEWER = '0199f0a0-0000-7000-8000-0000000000b2';

const OBJECT = {
  id: COMPANIES,
  apiSlug: 'companies',
  singularName: 'Company',
  pluralName: 'Companies',
  icon: 'building',
  hue: 'blue',
  primaryAttributeId: NAME,
  access: 'write',
  position: 1,
  isStandard: true,
  isArchived: false,
} as ObjectSummary;

/** One row of the grid, with what a test changes. */
const row = (overrides: Partial<SubjectAccess> & { readonly subject: RuleSubject }): SubjectAccess => ({
  level: 'write',
  records: 'all',
  defaultLevel: 'write',
  isDefault: true,
  fields: {},
  people: 0,
  ...overrides,
});

/** Companies with Members, Guests and two custom roles: a Receptionist who edits, and a read only Viewer. */
const ACCESS: ObjectAccess = {
  objectId: COMPANIES,
  fields: [
    { id: NAME, title: 'Name', isPrimary: true },
    { id: OWNER, title: 'Owner', isPrimary: false },
  ],
  ownerAttribute: { id: OWNER, title: 'Owner' },
  subjects: [
    row({ subject: { type: 'role', role: 'member' }, people: 4 }),
    row({ subject: { type: 'role', role: 'guest' }, level: 'none', defaultLevel: 'none', people: 1 }),
    row({ subject: { type: 'custom_role', roleId: RECEPTION }, label: 'Receptionist', people: 3 }),
    row({
      subject: { type: 'custom_role', roleId: VIEWER },
      label: 'Viewer',
      level: 'read',
      defaultLevel: 'read',
      people: 1,
    }),
  ],
};

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** The tab with the access held in memory: a change shows at once, as the data layer's own source does. */
async function renderTab() {
  const toasts = createToasts();
  const sent: { readonly subject: RuleSubject; readonly rule: unknown }[] = [];
  let held = ACCESS;
  // One snapshot object per change: a new one on every read would loop `useSyncExternalStore` forever.
  let state = { status: 'ready' as const, access: held };
  const listeners = new Set<() => void>();
  const source = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
  const accessRules = {
    view: () => source,
    change: (
      _slug: string,
      _objectId: string,
      subject: RuleSubject,
      rule: unknown,
      expected: (current: ObjectAccess) => ObjectAccess,
    ) => {
      sent.push({ subject, rule });
      held = expected(held);
      state = { status: 'ready' as const, access: held };
      for (const listener of listeners) listener();
      return Promise.resolve({ access: held, impact: { people: 0, views: 0, forms: 0 } });
    },
  };
  const data = { accessRules } as unknown as DataLayer;
  shown = await renderInApp(
    () => <AccessTab data={data} toasts={toasts} slug="acme" object={OBJECT} access={held} teams={[]} members={[]} />,
    {
      data,
      toasts,
      pattern: '/w/$slug/settings/objects/$object/$tab',
      at: '/w/acme/settings/objects/companies/access',
      permissions: ['access.manage'],
    },
  );
  return sent;
}

describe('custom roles on the Access tab (spec 0037, AC-1230)', () => {
  it('lists each role after Members and Guests, with how many people hold it', async () => {
    await renderTab();
    const who = page
      .getByRole('rowheader')
      .elements()
      .map((cell) => cell.textContent);
    expect(who[0]).toContain('Owners and admins');
    expect(who[1]).toContain('Members');
    expect(who[1]).toContain('4 people');
    expect(who[2]).toContain('Guests');
    expect(who[3]).toContain('Receptionist');
    expect(who[3]).toContain('3 people');
    expect(who[4]).toContain('Viewer');
    expect(who[4]).toContain('1 person');
  });

  it('never offers edit to a read only role, and sends a role’s change under its own subject', async () => {
    const sent = await renderTab();
    await expect.element(page.getByRole('checkbox', { name: 'Can edit, Viewer' })).toBeDisabled();
    // The reason sits beside the box it explains, not in the row's name.
    await page.getByRole('button', { name: 'About Can edit, Viewer' }).click();
    await expect.element(page.getByText(/Can view only/)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // The box drawn over the input takes the pointer, so the press goes to the label it sits in.
    const box = page.getByRole('checkbox', { name: 'Can edit, Receptionist' }).element();
    await userEvent.click(box.closest('label') ?? box);
    await expect
      .poll(() => sent)
      .toEqual([{ subject: { type: 'custom_role', roleId: RECEPTION }, rule: { level: 'read', records: 'all' } }]);
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await renderTab();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_ACCESS_SHOTS === '1')('saves screenshots at 390 and 1440, light and dark', async () => {
    for (const width of [390, 1440]) {
      for (const theme of THEMES) {
        await page.viewport(width, 1000);
        await renderTab();
        applyTheme(theme);
        await page.screenshot({ path: `l5-shots/access-${String(width)}-${theme}.png` });
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
  });
});
