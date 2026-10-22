// Lead routing's rules never leave the server for a visitor (spec 0043, AC-1608 to AC-1610; spec 0025, AC-644),
// through the real app on the real Postgres, with a fake calendar and the real clock (a form's hand off is signed
// for a day from now, so the booking routes read it on the same clock). A team page's rules read a person's field,
// a company's field by an option, and a visit's hidden field; a form's rules read a hidden field and send a Large
// budget on to the team page with one host. Every public answer that carries the page is read as an anonymous
// visitor: the page's facts, its slots (plain and handed off), the prefill, the viewer, a chat turn, both bookings,
// the guest page with its slots, calendar file, move and cancel, the handle profile and address, the form and its
// submit answer, whose signed hand off holds the submission and the page only. None holds a rule: no field, option,
// host or rotation id, no rule id, name or value, nor the guest's record facts; only what the visitor needs to
// answer the questions (a question's Show when) leaves the server. The bookings still route by the rules. Then a
// record fact key of 36 dashes is refused as INPUT_INVALID on a team page and on a form, never answered 500.
import { defaultAvailability, type RoutingRule } from '@crm/contracts';
import { newId, type BookingCalendar } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';

const { ownerUrl } = inject('testDatabase');

/** The weekday at least two days ahead, `YYYY-MM-DD` in UTC: the day every slot read and booking here is on. */
const DAY = (() => {
  const next = new Date(Date.now() + 2 * 86_400_000);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
})();
const at = (time: string) => `${DAY}T${time}:00.000Z`;
/** That day's slots, as a query. */
const ONE_DAY = `from=${at('00:00')}&to=${new Date(Date.parse(at('00:00')) + 86_400_000).toISOString()}`;

let db: Database;
let identity: IdentityStore;
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'read', busy: [] }),
  events: () => Promise.resolve({ meetingId: newId() }),
};
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: {
      ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** An anonymous visitor's request to `/api/public/<path>`, through the edge, from a fresh address. */
function visit(path: string, body?: unknown) {
  return app.request(`/api/public/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
      'x-forwarded-for': newIp(),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Ada's workspace with Kim, Ada working 9 to 12 UTC and Kim 13 to 17; a rotation of the two and its team page. */
async function teamPage() {
  const m = await memberWithWorkspace(app);
  const [ada] = await testQuery<{ id: string }>(
    ownerUrl,
    `select id::text from members where workspace_id = $1 and status = 'active' limit 1`,
    [m.workspace.id],
  );
  const adaId = ada?.id ?? '';
  const kimId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, 'Kim Park', $3, 'member', 'system', 'system')`,
    [m.workspace.id, kimId, `kim-${kimId.slice(-6)}@acme.dev`],
  );
  const hours = (from: string, to: string) => {
    const day: [string, string][] = [[from, to]];
    return JSON.stringify({
      ...defaultAvailability('UTC'),
      weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] },
    });
  };
  await testQuery(
    ownerUrl,
    `insert into availability_schedules (workspace_id, member_id, name, is_default, availability, created_by_type, updated_by_type)
     values ($1, $2, 'Working hours', true, $4, 'system', 'system'), ($1, $3, 'Working hours', true, $5, 'system', 'system')`,
    [m.workspace.id, adaId, kimId, hours('09:00', '12:00'), hours('13:00', '17:00')],
  );
  const pooled = (memberId: string) => ({
    memberId,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    isOn: true,
  });
  const rotation = await m.client.rotations.create({
    workspace: m.slug,
    id: newId(),
    settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' },
    members: [pooled(adaId), pooled(kimId)],
    mutationId: newId(),
  });
  const page = await m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Team call',
    timeZone: 'UTC',
    kind: 'round_robin',
    hosts: { fixed: [], rotations: [rotation.id] },
    mutationId: newId(),
  });
  return { m, adaId, kimId, rotationId: rotation.id, page };
}

describe('a team page’s routing rules and an anonymous visitor (spec 0043, spec 0025 AC-644)', () => {
  it('sends none of them in any public answer that carries the page, and still routes by them', async () => {
    const { m, adaId, kimId, rotationId, page } = await teamPage();
    const companyFields = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
    const range = companyFields.find((each) => each.apiSlug === 'employee_range')?.id ?? '';
    const [option] = await testQuery<{ id: string; label: string }>(
      ownerUrl,
      `select id::text, label from attribute_options where attribute_id = $1 order by position desc limit 1`,
      [range],
    );
    const jobTitle = m.attribute('job_title');
    const pageRules: RoutingRule[] = [
      {
        id: 'secret-rule',
        name: 'Secret buyers',
        when: { join: 'all', rules: [{ key: `person.${jobTitle}`, op: 'is', value: 'zebra cto' }] },
        then: { kind: 'hosts', hosts: [kimId] },
        qualified: true,
      },
      {
        id: 'company-rule',
        name: 'Company sizing',
        when: { join: 'any', rules: [{ key: `company.${range}`, op: 'is_any_of', value: [option?.id ?? ''] }] },
        then: { kind: 'hosts', hosts: [kimId] },
      },
      {
        id: 'utm-page-rule',
        name: 'Page campaign',
        when: { join: 'all', rules: [{ key: 'hidden.utm_campaign', op: 'is', value: 'heron-campaign' }] },
        then: { kind: 'hosts', hosts: [adaId] },
      },
    ];
    await m.client.bookingPages.update({
      workspace: m.slug,
      pageId: page.id,
      settings: {},
      routing: { rules: pageRules },
      mutationId: newId(),
    });
    // A guest whose job title the first rule reads.
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: {
        [m.attribute('name')]: { firstName: 'Grace' },
        [m.attribute('email_addresses')]: ['grace@navy.example'],
        [jobTitle]: 'Zebra CTO',
      },
      mutationId: newId(),
    });
    // A form whose second rule sends a Large budget on to the team page with Kim only.
    const created = await m.client.forms.create({
      workspace: m.slug,
      id: newId(),
      name: 'Demo request',
      mainObjectId: m.people.id,
      mutationId: newId(),
    });
    const saved = await m.client.forms.saveDraft({
      workspace: m.slug,
      formId: created.id,
      expectedRevision: created.revision,
      mutationId: newId(),
      document: {
        ...created.draft,
        questions: [
          ...created.draft.questions,
          {
            id: 'budget',
            key: 'budget',
            label: 'Budget',
            answerType: 'choice',
            choices: ['Small', 'Large'],
            required: true,
            update: 'fill',
          },
          {
            id: 'size',
            key: 'size',
            label: 'Team size',
            answerType: 'number',
            required: false,
            update: 'fill',
            showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
          },
        ],
        routing: {
          rules: [
            {
              id: 'form-utm-rule',
              name: 'Otter route',
              when: { join: 'all', rules: [{ key: 'hidden.utm_campaign', op: 'is', value: 'otter-campaign' }] },
              then: { kind: 'message', message: 'Kept for otters.' },
            },
            {
              id: 'form-route-rule',
              name: 'Large route',
              when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
              then: { kind: 'book', bookingPageId: page.id, hosts: [kimId], message: '' },
              qualified: true,
            },
          ],
        },
      },
    });
    const form = await m.client.forms.publish({
      workspace: m.slug,
      formId: created.id,
      expectedRevision: saved.revision,
      mutationId: newId(),
    });

    // Everything a rule holds, and what it read: none of it may reach a visitor.
    const secrets = [
      jobTitle,
      range,
      option?.id ?? '',
      option?.label ?? '',
      'secret-rule',
      'Secret buyers',
      'zebra',
      'company-rule',
      'Company sizing',
      'utm-page-rule',
      'Page campaign',
      'heron-campaign',
      'form-utm-rule',
      'Otter route',
      'otter-campaign',
      'Kept for otters',
      'form-route-rule',
      'Large route',
      adaId,
      kimId,
      rotationId,
      page.id,
    ].map((each) => each.toLowerCase());
    expect(secrets.every((each) => each.length > 0)).toBe(true);
    const read: string[] = [];
    /** The answer's body as sent, after checking it is a success that holds none of the secrets. */
    const sentText = async (label: string, response: Response | Promise<Response>) => {
      const answer = await response;
      const body = await answer.text();
      expect(answer.status, `${label}: ${body}`).toBe(200);
      expect(
        secrets.filter((secret) => body.toLowerCase().includes(secret)),
        label,
      ).toEqual([]);
      read.push(label);
      return body;
    };
    /** `sentText`, read as JSON. */
    const answered = async (label: string, response: Response | Promise<Response>) =>
      JSON.parse(await sentText(label, response)) as unknown;

    const slotsOf = (body: unknown) => (body as { readonly slots: readonly { readonly start: string }[] }).slots;
    await answered('page', visit(`booking/${page.publicKey}`));
    // Both hosts' times: Ada's morning and Kim's afternoon.
    const plain = slotsOf(
      await answered('slots', visit(`booking/${page.publicKey}/slots?${ONE_DAY}&duration=30&tz=UTC`)),
    );
    expect(plain.map((slot) => slot.start)).toEqual(expect.arrayContaining([at('09:00'), at('13:00')]));
    await answered('viewer', visit(`booking/${page.publicKey}/viewer`));
    await answered(
      'chat',
      visit(`booking/${page.publicKey}/chat`, {
        conversationId: newId(),
        duration: 30,
        timeZone: 'UTC',
        hour12: true,
        messages: [{ role: 'visitor', text: 'Hi' }],
        startedAt: Date.now() - 60_000,
      }),
    );

    // The form: its questions, with the Show when the visitor's page needs, and none of its rules.
    const hosted = (await answered('form', visit(`forms/${form.publicKey}`))) as {
      readonly questions: readonly { readonly key: string; readonly showWhen?: unknown }[];
    };
    expect(hosted.questions.find((question) => question.key === 'size')?.showWhen).toEqual({
      join: 'all',
      rules: [{ key: 'budget', op: 'is', value: 'Large' }],
    });
    const sent = (await answered(
      'form submit',
      visit(`forms/${form.publicKey}/submissions`, {
        idempotencyKey: newId(),
        versionNumber: form.liveVersionNumber ?? 1,
        answers: { name: 'Lin Visitor', email: 'lin@visitor.example', budget: 'Large', size: 80 },
        hidden: {},
        fillMs: 8_000,
      }),
    )) as { readonly next: { readonly kind: string; readonly url?: string } };
    expect(sent.next.kind).toBe('booking');
    const token = new URL(sent.next.url ?? '', APP_URL).searchParams.get('p') ?? '';
    // The hand off is signed, not secret: it holds the submission, the page and its expiry, nothing of the rule.
    const [, payload = ''] = token.split('.');
    expect(Object.keys(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as object).sort()).toEqual([
      'b',
      'e',
      's',
    ]);
    const p = encodeURIComponent(token);
    // Handed off, the page offers only the host the form's rule chose: Kim's afternoon.
    const routed = slotsOf(
      await answered('handed off slots', visit(`booking/${page.publicKey}/slots?${ONE_DAY}&duration=30&tz=UTC&p=${p}`)),
    );
    expect(routed.length).toBeGreaterThan(0);
    expect(routed.every((slot) => slot.start >= at('13:00'))).toBe(true);
    expect(await answered('prefill', visit(`booking/${page.publicKey}/prefill?p=${p}`))).toEqual({
      name: 'Lin Visitor',
      email: 'lin@visitor.example',
    });

    const book = (start: string, email: string, prefill?: string) => ({
      idempotencyKey: newId(),
      start,
      duration: 30,
      name: 'Visitor',
      email,
      timeZone: 'UTC',
      company_url: '',
      startedAt: Date.now() - 60_000,
      ...(prefill === undefined ? {} : { prefill }),
    });
    const handedOff = (await answered(
      'booking handed off',
      visit(`booking/${page.publicKey}/book`, book(at('14:00'), 'lin@visitor.example', token)),
    )) as { readonly manageToken: string };
    await answered(
      'booking by record',
      visit(`booking/${page.publicKey}/book`, book(at('15:00'), 'grace@navy.example')),
    );
    const guest = `booking/manage/${handedOff.manageToken}`;
    await answered('guest page', visit(guest));
    await answered('guest page slots', visit(`${guest}/slots?${ONE_DAY}&tz=UTC`));
    expect(await sentText('guest calendar file', visit(`${guest}/ics`))).toContain('BEGIN:VCALENDAR');
    // Moved later the same afternoon: the guest keeps the host the rule chose.
    await answered('guest move', visit(`${guest}/move`, { start: at('16:00') }));

    // Ada's handle: the profile lists the team page, and its address names it.
    const handle = `ada-${newId().slice(-8)}`;
    await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
    const profile = (await answered('profile', visit(`handles/${handle}`))) as { readonly links: readonly unknown[] };
    expect(profile.links).toHaveLength(1);
    await answered('address', visit(`handles/${handle}/${page.slug}`));

    // The server still routed both to Kim: the rule over Grace's job title, and the form's rule through the hand off.
    const booked = await m.client.bookings.list({ workspace: m.slug, pageId: page.id, when: 'upcoming' });
    expect(booked.map((each) => [each.visitorEmail, each.startsAt, each.hostMemberId])).toEqual([
      ['grace@navy.example', at('15:00'), kimId],
      ['lin@visitor.example', at('16:00'), kimId],
    ]);
    await answered('guest cancel', visit(`${guest}/cancel`, { reason: 'Plans changed.' }));
    expect(read).toEqual([
      'page',
      'slots',
      'viewer',
      'chat',
      'form',
      'form submit',
      'handed off slots',
      'prefill',
      'booking handed off',
      'booking by record',
      'guest page',
      'guest page slots',
      'guest calendar file',
      'guest move',
      'profile',
      'address',
      'guest cancel',
    ]);
  });
});

describe('a malformed record fact key (it answered 500)', () => {
  const dashes = `person.${'-'.repeat(36)}`;
  /** A rule reading `key`, choosing `hosts`. */
  const reading = (key: string, then: RoutingRule['then']): RoutingRule => ({
    id: 'bad',
    when: { join: 'all', rules: [{ key, op: 'is', value: 'cto' }] },
    then,
  });

  it('is refused as INPUT_INVALID, naming the condition, on a team page and on a form', async () => {
    const { m, kimId, page } = await teamPage();
    const onPage = await failure(() =>
      m.client.bookingPages.update({
        workspace: m.slug,
        pageId: page.id,
        settings: {},
        routing: { rules: [reading(dashes, { kind: 'hosts', hosts: [kimId] })] },
        mutationId: newId(),
      }),
    );
    expect({ code: onPage.code, status: onPage.status }).toEqual({ code: 'INPUT_INVALID', status: 400 });
    expect(onPage.data).toEqual({
      issues: [{ path: ['routing', 'rules', 0, 'when', 'rules', 0, 'key'], message: 'Pick a question or a field.' }],
    });
    const created = await m.client.forms.create({
      workspace: m.slug,
      id: newId(),
      name: 'Contact us',
      mainObjectId: m.people.id,
      mutationId: newId(),
    });
    const onForm = await failure(() =>
      m.client.forms.saveDraft({
        workspace: m.slug,
        formId: created.id,
        expectedRevision: created.revision,
        mutationId: newId(),
        document: {
          ...created.draft,
          routing: { rules: [reading(dashes, { kind: 'message', message: '' })] },
        },
      }),
    );
    expect({ code: onForm.code, status: onForm.status }).toEqual({ code: 'INPUT_INVALID', status: 400 });
    // Nothing was kept: the page has no rules, and a well formed key still saves.
    expect((await m.client.bookingPages.get({ workspace: m.slug, pageId: page.id })).routing).toEqual({ rules: [] });
    const jobTitle = `person.${m.attribute('job_title')}`;
    const kept = await m.client.bookingPages.update({
      workspace: m.slug,
      pageId: page.id,
      settings: {},
      routing: { rules: [reading(jobTitle, { kind: 'hosts', hosts: [kimId] })] },
      mutationId: newId(),
    });
    expect(kept.routing?.rules.map((each) => each.when.rules[0]?.key)).toEqual([jobTitle]);
  });
});
