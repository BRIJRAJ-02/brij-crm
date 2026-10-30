// A form's owner in Chromium (spec 0029 milestone 3, AC-755; spec 0023 AC-567, AC-1050): Settings › Details' Owner
// lists Nobody, the teammates and, under Round robin, the groups the reader can see with how many are switched on.
// Choosing a group says who gets each new record and saves the group alone (never a teammate beside it) from the
// SaveBar; a group with nobody switched on, and one the reader can't list, each say so in the one line under it.
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

/** A data layer holding the workspace's groups and the settings saves, kept. */
function fakeData(groups: readonly RotationView[], bookingPages: readonly BookingPageView[] = []) {
  const saves: Record<string, unknown>[] = [];
  const rotations = readyList(groups);
  const pages = readyList(bookingPages);
  const data = {
    rotations: { view: () => rotations },
    bookingPages: { view: () => pages },
    routing: { report: () => readyList([]) },
    forms: {
      hostedUrl: (key: string) => `https://app.example.com/f/${key}`,
      updateSettings: (_slug: string, _formId: string, settings: Record<string, unknown>) => {
        saves.push(settings);
        return Promise.resolve(
          formView(
            {
              ...(typeof settings.ownerMemberId === 'string' ? { ownerMemberId: settings.ownerMemberId } : {}),
              ...(typeof settings.ownerRotationId === 'string' ? { ownerRotationId: settings.ownerRotationId } : {}),
            },
            Array.isArray(settings.notifyMemberIds) ? (settings.notifyMemberIds as string[]) : [],
          ),
        );
      },
    },
  } as unknown as DataLayer;
  return { data, saves };
}

/** The Settings tab with its SaveBar, as the form editor holds them. */
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
        onDraftChange={() => undefined}
        onRetarget={() => undefined}
        isRetargeting={false}
        showGaps={false}
      />
      {settings.footer}
    </>
  );
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
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
    const owner = page.getByRole('button', { name: /Owner$/ });
    await expect.element(owner).toHaveTextContent('Ada Lovelace');
    await expect.element(page.getByText('For new records only.')).toBeVisible();

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
    await expect.element(page.getByText('Each new record goes to the next teammate in Sales team.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => fake.saves).toEqual([{ ownerMemberId: null, ownerRotationId: SALES }]);
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
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => fake.saves.at(-1)).toEqual({ ownerMemberId: null, ownerRotationId: null });
  });

  it('keeps a group the reader can’t list in view, saying new records still go to it, and the keyboard reaches every choice', async () => {
    await show(formView({ ownerRotationId: GONE }), [group(SALES, 'Sales team', [true, true])]);
    const owner = page.getByRole('button', { name: /Owner$/ });
    await expect.element(owner).toHaveTextContent('Round robin group');
    await expect.element(page.getByText('New records go to a round robin group you can’t see.')).toBeVisible();

    // Opened from the keyboard, the arrows move through the list; Enter picks a teammate in place of the group.
    (owner.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    const list = page.getByRole('listbox');
    await expect.element(list).toBeVisible();
    await userEvent.keyboard('{Home}{ArrowDown}{Enter}');
    await expect.element(owner).toHaveTextContent('Ada Lovelace');
    await expect.element(page.getByText('For new records only.')).toBeVisible();
  });

  it('names an owner who has left as a former member, saying new records get no owner', async () => {
    await show(formView({ ownerMemberId: '0199a6f2-0000-7000-8000-0000000000ff' }), []);
    const owner = page.getByRole('button', { name: /Owner$/ });
    await expect.element(owner).toHaveTextContent('Former member');
    await expect
      .element(page.getByText('They’ve left the workspace, so new records get no owner. Pick another.'))
      .toBeVisible();
  });
});

describe('who is emailed each new submission (AC-568, AC-1047)', () => {
  it('lists the people the form tells, saves a change alone, and says the owner is told too', async () => {
    const fake = await show(formView({ ownerMemberId: ADA }, [ADA]), []);
    const notify = page.getByRole('button', { name: /Email each new submission to$/ });
    await expect.element(notify).toHaveTextContent('Ada Lovelace');
    await expect
      .element(
        page.getByText(
          'The new record’s owner is always emailed too. Each person sees only the answers they have access to.',
        ),
      )
      .toBeVisible();
    await notify.click();
    await page.getByRole('listbox').getByRole('option', { name: /Bea/ }).click();
    await userEvent.keyboard('{Escape}');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => fake.saves).toEqual([{ notifyMemberIds: [ADA, BEA] }]);
  });

  it('keeps people the reader can’t list as one choice, and names nobody as Nobody else', async () => {
    await show(formView({ ownerMemberId: ADA }, ['0199a6f2-0000-7000-8000-0000000000ff']), []);
    await expect
      .element(page.getByRole('button', { name: /Email each new submission to$/ }))
      .toHaveTextContent('1 other person');
    shown?.unmount();
    await show(formView({ ownerMemberId: ADA }), []);
    await expect
      .element(page.getByRole('button', { name: /Email each new submission to$/ }))
      .toHaveTextContent('Nobody else');
  });
});

describe('a form that sends visitors on to a booking page (late trap #53)', () => {
  const DEMO = '0199f0a0-0000-7000-8000-0000000000d1';
  const sending = (status: 'live' | 'paused') => {
    const draft: FormDocument = {
      ...DRAFT,
      after: { kind: 'booking', bookingPageId: DEMO, countdownSeconds: 5, message: 'Thanks' },
    };
    const form = { ...formView({}), draft, live: draft };
    const demo = {
      id: DEMO,
      title: 'Demo call',
      status,
      durations: [30],
      canChange: true,
      ...(status === 'paused' ? { pausedReason: 'host_removed' } : {}),
    } as unknown as BookingPageView;
    return { form, demo };
  };

  it('says when the page is paused, why, and offers the way to it', async () => {
    const { form, demo } = sending('paused');
    await show(form, [], [demo]);
    await expect.element(page.getByText('Demo call is paused')).toBeVisible();
    await expect.element(page.getByText(/Its last host left the workspace/)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open page' }))
      .toHaveAttribute('href', `/w/acme/captures/links/${DEMO}`);
  });

  it('says a deleted page is gone to a reader who sees every page, and nothing to one who may not', async () => {
    const { form } = sending('paused');
    await show(form, [], [], ['forms.manage', 'booking.admin']);
    await expect.element(page.getByText('Its booking page was deleted')).toBeVisible();
    await expect.element(page.getByText(/Pick another page\./)).toBeVisible();
    shown?.unmount();
    await show(form, [], [], ['forms.manage']);
    await expect.element(page.getByRole('button', { name: /Booking page/ })).toBeVisible();
    expect(page.getByText('Its booking page was deleted').query()).toBeNull();
  });

  it('says nothing while the page is live', async () => {
    const { form, demo } = sending('live');
    await show(form, [], [demo]);
    await expect.element(page.getByRole('button', { name: /Booking page/ })).toBeVisible();
    expect(page.getByText('Demo call is paused').query()).toBeNull();
  });
});

describe('where a live form saves its answers (late trap #39)', () => {
  const WAITS = 'Changes here go live when you publish. Until then, submissions are still saved to People.';

  it('says a change waits for Publish, naming where submissions still go', async () => {
    const keptOnly: FormDocument = {
      ...DRAFT,
      questions: DRAFT.questions.map(({ filedOn: _filed, ...question }) => question),
      targets: {},
    };
    await show({ ...formView({}), draft: keptOnly }, []);
    await expect.element(page.getByText(WAITS)).toBeVisible();
  });

  it('says nothing while the draft saves answers as the live form does', async () => {
    await show(formView({}), []);
    await expect.element(page.getByText('Talk to us').or(page.getByRole('switch').first())).toBeVisible();
    expect(page.getByText(WAITS).query()).toBeNull();
  });
});
