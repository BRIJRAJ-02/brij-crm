// A form's owner in Chromium (spec 0029 milestone 3, AC-755; spec 0023 AC-567, AC-1050): Settings › Details' Owner
// lists Nobody, the teammates and, under Round robin, the groups the reader can see with how many are switched on.
// Choosing a group says who gets each new record and saves the group alone (never a teammate beside it) as it is
// picked, with no Save (one save model, 5 November 2026); a group with nobody switched on, and one the reader can't
// list, each say so in the one line under it. The name and link save as they are left, and say what is wrong only then.
import type {
  BookingPageView,
  DataLayer,
  FormDocument,
  FormView,
  MemberSummary,
  ObjectSummary,
  RotationView,
} from '@crm/data';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SettingsTab, useFormSettings } from './SettingsTab.tsx';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const ADA = '0199f0a0-0000-7000-8000-0000000000a1';
const BEA = '0199f0a0-0000-7000-8000-0000000000a2';
const SALES = '0199f0a0-0000-7000-8000-0000000000c1';
const QUIET = '0199f0a0-0000-7000-8000-0000000000c2';
const GONE = '0199f0a0-0000-7000-8000-0000000000c3';

const MEMBERS: readonly MemberSummary[] = [
  { id: ADA, name: 'Ada Lovelace', email: 'ada@acme.com' },
  { id: BEA, name: 'Bea Brown', email: 'bea@acme.com' },
];

const DEALS = '0199f0a0-0000-7000-8000-0000000000de';
const OBJECTS = [
  {
    id: PEOPLE,
    apiSlug: 'people',
    singularName: 'Person',
    pluralName: 'People',
    icon: 'user',
    hue: 'blue',
    standardKey: 'people',
    access: 'write',
    position: 0,
    isStandard: true,
    isArchived: false,
  },
  {
    id: DEALS,
    apiSlug: 'deals',
    singularName: 'Deal',
    pluralName: 'Deals',
    icon: 'handshake',
    hue: 'green',
    standardKey: 'deals',
    access: 'write',
    position: 2,
    isStandard: true,
    isArchived: false,
  },
] as unknown as readonly ObjectSummary[];

const DRAFT: FormDocument = {
  questions: [
    {
      id: 'q-email',
      key: 'email',
      label: 'Work email',
      answerType: 'email',
      required: true,
      filedOn: { objectRole: 'main', attributeId: EMAIL },
      update: 'fill',
    },
  ],
  targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

/** A published form owned by Ada unless the test says otherwise. */
function formView(
  owner: { readonly ownerMemberId?: string; readonly ownerRotationId?: string },
  notifyMemberIds: readonly string[] = [],
): FormView {
  return {
    id: '0199f0a0-0000-7000-8000-0000000000f1',
    name: 'Contact us',
    status: 'live',
    mainObjectId: PEOPLE,
    publicKey: 'contact-us',
    liveVersionNumber: 1,
    submissionsThisMonth: 0,
    spamCount: 0,
    submissionCount: 0,
    updatedAt: '2026-10-22T10:00:00.000Z',
    createdAt: '2026-10-22T10:00:00.000Z',
    draftNumber: 1,
    revision: 3,
    draft: DRAFT,
    live: DRAFT,
    hasUnpublished: false,
    ...owner,
    notifyMemberIds: [...notifyMemberIds],
    allowedOrigins: [],
    requireSignature: false,
    workspaceKey: 'ws_0123456789abcdef',
    canManage: true,
  };
}

/** A round robin group of Ada and Bea, each switched on unless `on` says otherwise. */
function group(id: string, name: string, on: readonly boolean[]): RotationView {
  return {
    id,
    name,
    strategy: 'fair',
    windowDays: 30,
    evenGap: 3,
    returning: 'owner',
    members: [ADA, BEA].map((memberId, index) => ({
      memberId,
      name: MEMBERS[index]?.name ?? '',
      weight: 100,
      priority: 2,
      dailyCap: null,
      weeklyCap: null,
      isOn: on[index] ?? true,
      hasCalendar: true,
    })),
    pages: 0,
    canChange: true,
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
  };
}

/** A list view holding `items`, ready, the same snapshot each read as a store's must be. */
function readyList<Item>(items: readonly Item[]) {
  const state = { status: 'ready' as const, items, pendingIds: new Set<string>() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

/**
 * The workspace's skills as a held read, with no skills (spec 0037, AC-1382). RulesCard reads this on every render,
 * so a layer without it renders the error boundary and every locator below times out against a page that already
 * crashed; `renderInApp` takes a Partial<DataLayer> cast to DataLayer, so only a run catches the omission.
 *
 * The snapshot is one frozen value, not a fresh object per call: `useSyncExternalStore` compares snapshots by
 * identity, so returning a new one each time re-renders for ever ("Maximum update depth exceeded").
 */
const NO_SKILLS_SNAPSHOT = { status: 'ready', value: { skills: [], members: [], wonMeansSet: false } } as const;
const NO_SKILLS = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_SKILLS_SNAPSHOT,
  retain: () => () => undefined,
  reload: () => undefined,
};

/** A data layer holding the workspace's groups and the settings saves, kept. */
function fakeData(groups: readonly RotationView[], bookingPages: readonly BookingPageView[] = []) {
  const saves: Record<string, unknown>[] = [];
  const rotations = readyList(groups);
  const pages = readyList(bookingPages);
  const data = {
    rotations: { view: () => rotations },
    bookingPages: { view: () => pages },
    // RulesCard reads the workspace's skills on every render (spec 0037, AC-1382). Without this the card renders
    // the error boundary and every locator below times out against a page that already crashed: `renderInApp` takes
    // a Partial<DataLayer> cast to DataLayer, so only a run catches the omission.
    routing: { report: () => readyList([]), skills: { view: () => NO_SKILLS } },
    forms: {
      hostedUrl: (key: string) => `https://app.example.com/f/${key}`,
      updateSettings: (_slug: string, _formId: string, settings: Record<string, unknown>) => {
        saves.push(settings);
        return Promise.resolve({
          ...formView(
            {
              ...(typeof settings.ownerMemberId === 'string' ? { ownerMemberId: settings.ownerMemberId } : {}),
              ...(typeof settings.ownerRotationId === 'string' ? { ownerRotationId: settings.ownerRotationId } : {}),
            },
            Array.isArray(settings.notifyMemberIds) ? (settings.notifyMemberIds as string[]) : [],
          ),
          ...(typeof settings.name === 'string' ? { name: settings.name } : {}),
          ...(typeof settings.slug === 'string' ? { publicKey: settings.slug } : {}),
        });
      },
    },
  } as unknown as DataLayer;
  return { data, saves };
}

/** The Settings tab and its settings, as the form editor holds them (no SaveBar: each field saves itself). */
function Editor({ initial }: { readonly initial: FormView }) {
  const [form, setForm] = useState(initial);
  const settings = useFormSettings({ slug: 'acme', form, onFormChange: setForm });
  return (
    <>
      <SettingsTab
        slug="acme"
        form={form}
        draft={form.draft}
        target={{ objectId: PEOPLE, objectName: 'People', items: [] }}
        objects={OBJECTS}
        members={MEMBERS}
        isReadOnly={false}
        settings={settings}
        onRetarget={(objectId) => {
          retargets.push(objectId);
        }}
        isRetargeting={false}
        onStatusChange={(status) => {
          statuses.push(status);
        }}
        keepMonths={12}
        onDraftChange={(change) => {
          const next = change(form.draft);
          deals.push(next.targets.deal?.objectId);
          copies.push(next.confirmation?.on);
          closings.push(next.closing);
          setForm({ ...form, draft: next });
        }}
      />
    </>
  );
}

let shown: InApp | undefined;
/** What the tab asked the editor for: where answers are saved, and opening or closing the form. */
const retargets: (string | null)[] = [];
const statuses: string[] = [];
const deals: (string | undefined)[] = [];
const copies: (boolean | undefined)[] = [];
const closings: FormDocument['closing'][] = [];

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  retargets.length = 0;
  statuses.length = 0;
  deals.length = 0;
  copies.length = 0;
  closings.length = 0;
});

async function show(
  initial: FormView,
  groups: readonly RotationView[],
  pages: readonly BookingPageView[] = [],
  permissions?: readonly string[],
) {
  const fake = fakeData(groups, pages);
  shown = await renderInApp(() => <Editor initial={initial} />, {
    data: fake.data,
    ...(permissions === undefined ? {} : { permissions }),
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
  return fake;
}

describe('the owner of a form’s new records', () => {
  it('offers the round robin groups, says who gets each new record, and saves the group alone', async () => {
    const fake = await show(formView({ ownerMemberId: ADA }), [
      group(SALES, 'Sales team', [true, true]),
      group(QUIET, 'Night shift', [false, false]),
    ]);
    const owner = page.getByRole('button', { name: /Owner$/ }).last();
    // The chosen teammate shows with their avatar, so the name is matched on its own.
    await expect.element(owner.getByText('Ada Lovelace', { exact: true })).toBeVisible();
    // Its help is a tip beside the label, never a line under the field (T21).
    expect(page.getByText('For new records only.').query()).toBeNull();

    await owner.click();
    const list = page.getByRole('listbox');
    await expect.element(list.getByRole('option', { name: 'Nobody', exact: true })).toBeVisible();
    await expect.element(list.getByText('Round robin', { exact: true })).toBeVisible();
    await expect.element(list.getByRole('option', { name: /Sales team/ }).getByText('2 teammates')).toBeVisible();
    await expect
      .element(list.getByRole('option', { name: /Night shift/ }).getByText('Nobody switched on'))
      .toBeVisible();
    await list.getByRole('option', { name: /Sales team/ }).click();

    await expect.element(owner).toHaveTextContent('Sales team');
    // Saved as it is picked: there is no Save button to find.
    await expect.poll(() => fake.saves).toEqual([{ ownerMemberId: null, ownerRotationId: SALES }]);
    expect(page.getByRole('button', { name: 'Save' }).query()).toBeNull();
    await expect.element(owner).toHaveTextContent('Sales team');

    // A group with nobody switched on says new records get no owner; Nobody saves both cleared.
    await owner.click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: /Night shift/ })
      .click();
    await expect
      .element(page.getByText('Nobody in Night shift is switched on, so new records get no owner.'))
      .toBeVisible();
    await owner.click();
    await page.getByRole('listbox').getByRole('option', { name: 'Nobody', exact: true }).click();
    await expect.poll(() => fake.saves.at(-1)).toEqual({ ownerMemberId: null, ownerRotationId: null });
  });

  it('keeps a group the reader can’t list in view, saying new records still go to it, and the keyboard reaches every choice', async () => {
    await show(formView({ ownerRotationId: GONE }), [group(SALES, 'Sales team', [true, true])]);
    const owner = page.getByRole('button', { name: /Owner$/ }).last();
    await expect.element(owner).toHaveTextContent('Round robin group');

    // Opened from the keyboard, the arrows move through the list; Enter picks a teammate in place of the group.
    (owner.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    const list = page.getByRole('listbox');
    await expect.element(list).toBeVisible();
    await userEvent.keyboard('{Home}{ArrowDown}{Enter}');
    await expect.element(owner.getByText('Ada Lovelace', { exact: true })).toBeVisible();
  });

  it('names an owner who has left as a former member, saying new records get no owner', async () => {
    await show(formView({ ownerMemberId: '0199a6f2-0000-7000-8000-0000000000ff' }), []);
    const owner = page.getByRole('button', { name: /Owner$/ }).last();
    await expect.element(owner).toHaveTextContent('Former member');
    await expect
      .element(page.getByText('They’ve left the workspace, so new records get no owner. Pick another.'))
      .toBeVisible();
  });
});

describe('the name and the link save as they are left (one save model)', () => {
  it('says nothing while the name is typed, says an empty one is missing once left, and saves a real one on leaving', async () => {
    const fake = await show(formView({}), []);
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await userEvent.clear(name);
    // Emptied but not left: no error yet, and nothing sent.
    expect(page.getByText('Give the form a name.').query()).toBeNull();
    await userEvent.tab();
    await expect.element(page.getByText('Give the form a name.')).toBeVisible();
    expect(fake.saves).toEqual([]);
    // Typing again clears it; leaving saves it, trimmed, with no Save button.
    await userEvent.fill(name, ' Talk to us ');
    expect(page.getByText('Give the form a name.').query()).toBeNull();
    await userEvent.tab();
    await expect.poll(() => fake.saves).toEqual([{ name: 'Talk to us' }]);
    await expect.element(name).toHaveValue('Talk to us');
  });

  it('checks the link on leaving: one that can’t be a link says so and is not sent, a good one saves', async () => {
    const fake = await show(formView({}), []);
    const link = page.getByRole('textbox', { name: /^Link/ });
    await userEvent.fill(link, 'a');
    expect(page.getByText(/The link needs 2 to 40/).query()).toBeNull();
    await userEvent.tab();
    await expect.element(page.getByText(/The link needs 2 to 40/)).toBeVisible();
    expect(fake.saves).toEqual([]);
    await userEvent.fill(link, 'talk-to-us');
    await userEvent.tab();
    await expect.poll(() => fake.saves).toEqual([{ slug: 'talk-to-us' }]);
  });
});

describe('who is emailed each new submission (AC-568, AC-1047)', () => {
  it('lists the people the form tells, saves a change alone, and says the owner is told too', async () => {
    const fake = await show(formView({ ownerMemberId: ADA }, [ADA]), []);
    const notify = page.getByRole('button', { name: /Email each submission to$/ }).last();
    await expect.element(notify).toHaveTextContent('Ada Lovelace');
    await notify.click();
    await page.getByRole('listbox').getByRole('option', { name: /Bea/ }).click();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => fake.saves).toEqual([{ notifyMemberIds: [ADA, BEA] }]);
  });

  it('keeps people the reader can’t list as one choice, and names nobody as Nobody else', async () => {
    await show(formView({ ownerMemberId: ADA }, ['0199a6f2-0000-7000-8000-0000000000ff']), []);
    await expect
      .element(page.getByRole('button', { name: /Email each submission to$/ }).last())
      .toHaveTextContent('1 other person');
    shown?.unmount();
    await show(formView({ ownerMemberId: ADA }), []);
    await expect
      .element(page.getByRole('button', { name: /Email each submission to$/ }).last())
      .toHaveTextContent('Nobody else');
    // With no owner, nobody else is told either: the field says Nobody and the hint drops the owner.
    shown?.unmount();
    await show(formView({}), []);
    await expect
      .element(page.getByRole('button', { name: /Email each submission to$/ }).last())
      .not.toHaveTextContent('Nobody else');
  });
});

describe('Settings as plain rows (T21)', () => {
  it('keeps only the form’s own settings, as rows with no cards or text fields for the words', async () => {
    await show(formView({ ownerMemberId: ADA }), []);
    for (const gone of ['After sending', 'Endings', 'Score', 'Routing', 'Text', 'Details', 'Headline', 'Button text']) {
      expect(page.getByRole('heading', { name: gone, exact: true }).query()).toBeNull();
    }
    expect(page.getByRole('textbox', { name: 'Headline' }).query()).toBeNull();
    for (const row of [
      'Name',
      'Link',
      'Save answers to',
      'Owner',
      'Email each submission to',
      'Accepting submissions',
    ]) {
      await expect.element(page.getByText(row, { exact: true }).first()).toBeVisible();
    }
    await expect.element(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  it('saves answers to an object or to Submissions only, from one picker', async () => {
    await show(formView({}), []);
    const saving = page.getByRole('button', { name: /Save answers to$/ }).last();
    await expect.element(saving).toHaveTextContent('People');
    await saving.click();
    await page.getByRole('listbox').getByRole('option', { name: 'Only in Submissions' }).click();
    expect(retargets).toEqual([null]);
  });

  it('offers Also create a deal under People instead of Deals as a place of its own (forms fix a3)', async () => {
    await show(formView({}), []);
    const saving = page.getByRole('button', { name: /Save answers to$/ }).last();
    await saving.click();
    expect(page.getByRole('listbox').getByRole('option', { name: 'Deals' }).query()).toBeNull();
    await userEvent.keyboard('{Escape}');
    const deal = page.getByRole('switch', { name: 'Also create a deal' });
    await expect.element(deal).not.toBeChecked();
    (deal.element() as HTMLElement).click();
    expect(deals).toEqual([DEALS]);
  });

  it('turns on Email them a copy, then shows its subject and message (forms fix b1)', async () => {
    await show(formView({}), []);
    expect(page.getByRole('textbox', { name: 'Subject' }).query()).toBeNull();
    (page.getByRole('switch', { name: 'Email them a copy' }).element() as HTMLElement).click();
    expect(copies).toEqual([true]);
    await expect
      .element(page.getByRole('textbox', { name: 'Subject' }))
      .toHaveAttribute('placeholder', 'We got your message');
    await expect.element(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  });

  it('closes after a number of answers, chosen from Closes (forms fix b2)', async () => {
    await show(formView({}), []);
    const closes = page.getByRole('button', { name: /Closes$/ }).last();
    await expect.element(closes).toHaveTextContent('Never');
    await closes.click();
    await page.getByRole('listbox').getByRole('option', { name: 'After a number of answers' }).click();
    expect(closings).toEqual([{ after: 100 }]);
    await expect.element(page.getByRole('textbox', { name: 'Number of answers' })).toHaveValue('100');
    await expect.element(page.getByRole('textbox', { name: 'Message when closed' })).toBeVisible();
  });

  it('says how long answers are kept, linking to where it is set (critique b S2)', async () => {
    await show(formView({}), []);
    await expect
      .element(page.getByRole('link', { name: 'For 12 months' }))
      .toHaveAttribute('href', '/w/acme/settings/general');
  });

  it('closes and opens the form from Accepting submissions', async () => {
    await show(formView({}), []);
    (page.getByRole('switch', { name: 'Accepting submissions' }).element() as HTMLElement).click();
    expect(statuses).toEqual(['paused']);
  });
});
