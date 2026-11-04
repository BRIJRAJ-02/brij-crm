// Spec 0063, AC-6323 and AC-6324, against a real Postgres as the app role:
// every template in code parses as a `FormDocument` and publishes on a fresh
// workspace; the gallery offers only the templates the contract offers; a
// template's answers file onto the workspace's matching standard attributes
// by slug and are kept with the submission otherwise, making no attribute;
// and starting a draft from one needs `forms.manage` and never reaches
// another workspace's form.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  FORM_TEMPLATE_IDS,
  FormDocument,
  type AttributeType,
  isOfferedTemplate,
  OFFERED_FORM_TEMPLATE_IDS,
  type FormTemplateId,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../../engine/ids.ts';
import { isRefusal } from '../../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../../engine/scope.ts';
import { createWorkspace } from '../../engine/workspaces.ts';
import type { AccessRules } from '../../access/policy.ts';
import { rescope, testScope } from '../../testing.ts';
import { createBookingPage, updateBookingPage } from '../../booking/pages.ts';
import { createForm, createFormFromTemplate, listFormTemplates, publishForm, saveFormDraft } from '../forms.ts';
import { FORM_TEMPLATES, templateDocument, type TemplateTarget } from './index.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-form-templates-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
/** A fresh workspace with the standard objects, as a new customer's is. */
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Templates',
    slug: `templates-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const attributes = await query<{ id: string; slug: string }>(
    sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
  );
  const ids = Object.fromEntries(attributes.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => {
    const id = ids[slug];
    if (id === undefined) throw new Error(`No attribute ${slug}.`);
    return id;
  };
  // People's own attributes as `templateDocument` takes them, for the held templates, which have no endpoint.
  const people = await query<{ id: string; apiSlug: string; type: AttributeType }>(
    sql`select a.id::text, a.api_slug as "apiSlug", a.type::text as type from attributes a
        join objects o on o.id = a.object_id
        where o.standard_key = 'people' and a.archived_at is null and not a.is_system
        order by a.position`,
  );
  const target: TemplateTarget = {
    objectId: created.objects.people ?? '',
    attributes: people,
    matchAttributeId: attribute('people.email_addresses'),
  };
  return {
    scope,
    system: testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR }),
    query,
    attribute,
    target,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** How many attributes the workspace holds: a template must add none (AC-6323, no field until publish). */
const attributeCount = async (w: Awaited<ReturnType<typeof workspace>>) =>
  (await w.query<{ n: number }>(sql`select count(*)::int as n from attributes`))[0]?.n ?? 0;

/**
 * A draft from one template, however it has to be reached. An offered template goes through the real endpoint. A
 * template held back until slice 5 has no endpoint on purpose (`isOfferedTemplate` refuses it), so it is saved as a
 * draft directly from the same `templateDocument` the endpoint would use: AC-6324 is about the template's own
 * content publishing, and holding it out of the gallery must not stop that being proved.
 */
async function startFrom(w: Awaited<ReturnType<typeof workspace>>, id: FormTemplateId) {
  const template = FORM_TEMPLATES[id];
  if (isOfferedTemplate(id)) {
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: id });
    // The form is called what the template says to call it: the blank tile is "Blank form", the form "Untitled form".
    expect(created.name).toBe(template.formName ?? template.name);
    return created;
  }
  const created = await createForm(w.scope, { id: newId(), name: template.formName ?? template.name });
  return saveFormDraft(w.scope, {
    formId: created.id,
    document: templateDocument(template, w.target),
    expectedRevision: created.revision,
  });
}

describe('the templates in code (AC-6324)', () => {
  it('holds every id the contract names, and no others', () => {
    expect(Object.keys(FORM_TEMPLATES).sort()).toEqual([...FORM_TEMPLATE_IDS].sort());
    for (const id of FORM_TEMPLATE_IDS) expect(FORM_TEMPLATES[id].id).toBe(id);
  });

  /** Every template but Blank, which starts empty and so is the one a publish refuses until it has a question. */
  const FILLED = FORM_TEMPLATE_IDS.filter((id) => id !== 'blank');

  it.each([...FORM_TEMPLATE_IDS])('%s parses as a FormDocument, filed and unfiled alike', (id: FormTemplateId) => {
    const template = FORM_TEMPLATES[id];
    // Unfiled (a member who may write no object): every question is kept with the submission.
    const kept = FormDocument.safeParse(templateDocument(template, undefined));
    expect(kept.success, JSON.stringify(kept.error?.issues)).toBe(true);
    expect(kept.data?.questions.every((question) => question.kept === true)).toBe(true);
    // Blank starts empty; every other template asks something.
    if (id === 'blank') expect(kept.data?.questions).toEqual([]);
    else expect(kept.data?.questions.length).toBeGreaterThan(0);
  });

  it.each(FILLED)('%s publishes on a fresh workspace', async (id: FormTemplateId) => {
    const w = await workspace();
    const template = FORM_TEMPLATES[id];
    const before = await attributeCount(w);
    const created = await startFrom(w, id);
    expect(created.draft.layout).toBe(template.layout);
    expect(created.draft.questions.map((each) => each.key)).toEqual(template.questions.map((each) => each.key));
    // The draft came back inside `FormView`, so it already parsed; parse it again as the document on its own,
    // which is what AC-6324 asks for.
    const parsed = FormDocument.safeParse(created.draft);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const published = await publishForm(w.scope, {
      formId: created.id,
      expectedRevision: created.revision,
      slug: `t-${id.replaceAll('_', '-')}-${String(Date.now() % 100_000)}`.slice(0, 40),
    });
    expect(published.status).toBe('live');
    expect(published.liveVersionNumber).toBe(1);
    expect(published.live?.questions.map((each) => each.key)).toEqual(template.questions.map((each) => each.key));
    // AC-6323: no field is created until publish, and publishing this draft asks for none either.
    expect(await attributeCount(w)).toBe(before);
  });
});

describe('Blank is truly empty, and anonymous templates keep their submissions only (AC-6323)', () => {
  it('starts Blank with no questions, and a publish says to add one first', async () => {
    const w = await workspace();
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'blank' });
    expect(created.name).toBe('Untitled form');
    expect(created.draft.questions).toEqual([]);
    expect(
      await refusalOf(
        publishForm(w.scope, { formId: created.id, expectedRevision: created.revision, slug: 'blank-one' }),
      ),
    ).toMatchObject([
      { code: 'CONFIG_INVALID', message: 'Add a question first. A form with no questions has nothing to send.' },
    ]);
  });

  it.each(['feedback', 'nps'] as const)(
    '%s asks nobody who they are, files nothing, and publishes as a submissions only form',
    async (id) => {
      const w = await workspace();
      const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: id });
      expect(created.draft.targets).toEqual({});
      expect(created.draft.questions.some((each) => each.answerType === 'email' || each.key === 'name')).toBe(false);
      expect(created.draft.questions.every((each) => each.filedOn === undefined)).toBe(true);
      const published = await publishForm(w.scope, {
        formId: created.id,
        expectedRevision: created.revision,
        slug: `anon-${id}-${String(Date.now() % 100_000)}`,
      });
      expect(published.status).toBe('live');
      expect(published.live?.targets).toEqual({});
      expect(listFormTemplates().items.find((each) => each.id === id)?.keepsSubmissionsOnly).toBe(true);
    },
  );

  it('gives every tile its words and questions for the gallery’s big preview, and no filing', () => {
    for (const item of listFormTemplates().items) {
      const template = FORM_TEMPLATES[item.id];
      expect(item.sample.headline).toBe(template.headline);
      expect(item.sample.questions.map((each) => each.key)).toEqual(template.questions.map((each) => each.key));
      expect(JSON.stringify(item.sample)).not.toContain('filesOnto');
    }
  });
});

describe('the gallery it offers (AC-6323)', () => {
  it('offers the contract’s ten, in order, each with a purpose and a preview', () => {
    const { items } = listFormTemplates();
    expect(items.map((each) => each.id)).toEqual([...OFFERED_FORM_TEMPLATE_IDS]);
    expect(items[0]?.id).toBe('blank');
    // The first tile says "Blank form", the word somebody wanting an empty form scans for (UX review, slice 8).
    expect(items[0]?.name).toBe('Blank form');
    for (const item of items) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.purpose.length).toBeGreaterThan(0);
      // Blank draws no rows: it starts empty.
      if (item.id !== 'blank') expect(item.preview.rows.length).toBeGreaterThan(0);
    }
  });

  // AC-6323's twelve, in its order: Booking intake (released 3 November 2026, once its draft could name a booking
  // page the workspace actually has) straight after Job application, Lead qualification straight after Demo request.
  it('offers all twelve tiles, in the order AC-6323 names them', () => {
    const ids = listFormTemplates().items.map((each) => each.id);
    expect(ids).toHaveLength(12);
    expect(ids[ids.indexOf('job_application') + 1]).toBe('booking_intake');
    expect(ids[ids.indexOf('demo_request') + 1]).toBe('lead_qualification');
  });

  it('scores a Lead qualification form, which is what its tile is named after (AC-6316)', async () => {
    const w = await workspace();
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'lead_qualification' });
    const points = new Map(created.draft.questions.map((each) => [each.key, each.points]));
    // One number per choice, in the choices' order: the sum is the lead's score.
    expect(points.get('budget')).toEqual([0, 10, 25, 40]);
    expect(points.get('timeline')).toEqual([30, 20, 5, 0]);
    expect(points.get('team_size')).toEqual([0, 5, 15, 30]);
    // Name and email carry none: a short text answer cannot be worth points.
    expect(points.get('name')).toBeUndefined();
    // Where the score is filed is the member's own call, so the template guesses no attribute for it.
    expect(created.draft.scoreFiledOn).toBeUndefined();
  });

  it('refuses anything that isn’t a template', async () => {
    const w = await workspace();
    for (const id of ['nonsense', '', '../blank']) {
      expect(await refusalOf(createFormFromTemplate(w.scope, { id: newId(), templateId: id }))).toMatchObject([
        { code: 'CONFIG_INVALID', field: 'templateId' },
      ]);
    }
    expect(await w.query(sql`select 1 from forms`)).toEqual([]);
  });
});

describe('filing a template onto the workspace’s standard attributes (AC-6323)', () => {
  it('files what matches a slug and keeps what doesn’t, creating no attribute', async () => {
    const w = await workspace();
    const before = await attributeCount(w);
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'customer_onboarding' });
    const filed = new Map(created.draft.questions.map((each) => [each.key, each.filedOn?.attributeId]));
    // Matched by slug onto People's own standard attributes.
    expect(filed.get('name')).toBe(w.attribute('people.name'));
    expect(filed.get('email')).toBe(w.attribute('people.email_addresses'));
    expect(filed.get('phone')).toBe(w.attribute('people.phone_numbers'));
    expect(filed.get('job_title')).toBe(w.attribute('people.job_title'));
    expect(filed.get('address')).toBe(w.attribute('people.primary_location'));
    // People holds its company as a link and has no "how did you hear" field, so both stay with the submission.
    expect(filed.get('company')).toBeUndefined();
    expect(filed.get('heard')).toBeUndefined();
    const kept = created.draft.questions.filter((each) => each.kept === true).map((each) => each.key);
    expect(kept).toEqual(['company', 'heard']);
    expect(created.draft.targets.main?.matchAttributeId).toBe(w.attribute('people.email_addresses'));
    expect(await attributeCount(w)).toBe(before);
  });

  it('keeps every answer when the workspace has renamed the slugs away', async () => {
    const w = await workspace();
    // Slugs are what a template matches on, never titles: a workspace that changed its slugs gets no filing, and
    // its answers stay with the submission rather than landing on the wrong field.
    await w.query(
      sql`update attributes set api_slug = 'legacy_' || api_slug where object_id = (select id from objects where standard_key = 'people')`,
    );
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'contact_us' });
    expect(created.draft.questions.every((each) => each.filedOn === undefined && each.kept === true)).toBe(true);
  });

  it('keeps an answer whose field the member may not write, and never names it (security review)', async () => {
    const w = await workspace();
    const people = (await w.query<{ id: string }>(sql`select id::text from objects where standard_key = 'people'`))[0]
      ?.id;
    if (people === undefined) throw new Error('No People object.');
    // One field hidden from admins, one they may only read: a template may file onto neither, so both answers stay
    // with the submission. Filing onto either would hand them a field their rules keep from them, and Publish
    // would then refuse the form by naming its title.
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: people, attributeId: w.attribute('people.job_title') },
          level: 'hidden',
        },
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: people, attributeId: w.attribute('people.primary_location') },
          level: 'read',
        },
      ],
      records: [],
    };
    const admin = rescope(w.scope, { role: 'admin', rules });
    const created = await createFormFromTemplate(admin, { id: newId(), templateId: 'customer_onboarding' });
    const byKey = new Map(created.draft.questions.map((each) => [each.key, each]));
    expect(byKey.get('job_title')?.filedOn).toBeUndefined();
    expect(byKey.get('job_title')?.kept).toBe(true);
    expect(byKey.get('address')?.filedOn).toBeUndefined();
    expect(byKey.get('address')?.kept).toBe(true);
    // The fields they do write are still filed, so the form still reaches the CRM.
    expect(byKey.get('email')?.filedOn?.attributeId).toBe(w.attribute('people.email_addresses'));
    expect(byKey.get('name')?.filedOn?.attributeId).toBe(w.attribute('people.name'));
  });

  it('keeps an open answer with the submission rather than writing it onto the person', async () => {
    const w = await workspace();
    // A support form's "What is happening?" and an NPS "why" are not a person's description (security review).
    // Nor Contact us' message or a demo's goal (forms fix a5): each shows on the person's timeline instead.
    for (const templateId of ['support_request', 'nps', 'feedback', 'contact_us', 'demo_request'] as const) {
      const created = await createFormFromTemplate(w.scope, { id: newId(), templateId });
      const open = created.draft.questions.filter((each) => each.answerType === 'long_text');
      expect(open.length).toBeGreaterThan(0);
      expect(open.every((each) => each.filedOn === undefined && each.kept === true)).toBe(true);
    }
  });

  it('files a Steps template’s breaks, one per step the template names', async () => {
    const w = await workspace();
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'customer_onboarding' });
    expect(created.draft.layout).toBe('steps');
    expect(created.draft.steps.map((step) => [step.id, step.startsAt])).toEqual([
      ['work', 'job_title'],
      ['billing', 'address'],
    ]);
  });
});

describe('who may start a draft from one (AC-6323)', () => {
  it('needs forms.manage, and makes nothing when it is refused', async () => {
    const w = await workspace();
    const member = rescope(w.scope, { role: 'member' });
    expect(await refusalOf(createFormFromTemplate(member, { id: newId(), templateId: 'contact_us' }))).toMatchObject([
      { code: 'FORBIDDEN' },
    ]);
    expect(await w.query(sql`select 1 from forms`)).toEqual([]);
  });

  it('never reaches another workspace’s form, even on the same id', async () => {
    const one = await workspace();
    const two = await workspace();
    const id = newId();
    const mine = await createFormFromTemplate(one.scope, { id, templateId: 'contact_us', name: 'Mine' });
    // The same id in another workspace is not "taken": each workspace has its own form, and the first one's
    // existence is never answered to the second (the rows are isolated by row level security, not by the query).
    const theirs = await createFormFromTemplate(two.scope, { id, templateId: 'newsletter', name: 'Theirs' });
    expect(theirs.id).toBe(id);
    expect(theirs.name).toBe('Theirs');
    expect(theirs.draft.questions.map((each) => each.key)).toEqual(['name', 'email', 'marketing']);
    expect(mine.name).toBe('Mine');
    expect(await one.query(sql`select name from forms`)).toEqual([{ name: 'Mine' }]);
    expect(await two.query(sql`select name from forms`)).toEqual([{ name: 'Theirs' }]);
  });
});

describe('Booking intake ends with Book a meeting (AC-6323)', () => {
  /** A member (booking.manage: their own pages only), with no page yet. */
  async function bea(w: Awaited<ReturnType<typeof workspace>>) {
    const memberId = newId();
    await w.query(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
          values (${w.scope.workspaceId}, ${memberId}, 'Bea', ${`${memberId}@example.com`}, 'member', 'system', 'system')`,
    );
    return rescope(w.scope, { actor: { type: 'member', id: memberId }, role: 'member' });
  }

  it('goes on to the maker’s own live page, before an older colleague’s they could also use', async () => {
    const w = await workspace();
    const colleague = await bea(w);
    await createBookingPage(colleague, { id: newId(), title: 'Bea’s call', timeZone: 'UTC' });
    const mine = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'booking_intake' });
    expect(created.draft.after).toEqual({
      kind: 'booking',
      bookingPageId: mine.id,
      countdownSeconds: 5,
      message: FORM_TEMPLATES.booking_intake.thanks,
    });
    // And it publishes as it stands: the page is live and the maker's to use.
    const live = await publishForm(w.scope, { formId: created.id, expectedRevision: created.revision });
    expect(live.status).toBe('live');
  });

  it('thanks the visitor when there is no page to go on to, and never picks one the maker can’t use', async () => {
    const w = await workspace();
    const none = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'booking_intake' });
    expect(none.draft.after).toEqual({ kind: 'message', message: FORM_TEMPLATES.booking_intake.thanks });
    // A paused page is not one to send anyone to.
    const page = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    await updateBookingPage(w.scope, { pageId: page.id, settings: { status: 'paused' } });
    expect(
      (await createFormFromTemplate(w.scope, { id: newId(), templateId: 'booking_intake' })).draft.after.kind,
    ).toBe('message');
    await updateBookingPage(w.scope, { pageId: page.id, settings: { status: 'live' } });
    // A key that manages forms but holds no booking right may send visitors to no page at all (the door's `seen`),
    // so its draft thanks them even with a live page in the workspace.
    const key = testScope({
      db,
      workspaceId: w.scope.workspaceId,
      actor: { type: 'api_key', id: newId() },
      scopes: ['forms.manage', 'data.write'],
    });
    const hidden = await createFormFromTemplate(key, { id: newId(), templateId: 'booking_intake' });
    expect(hidden.draft.after).toEqual({ kind: 'message', message: FORM_TEMPLATES.booking_intake.thanks });
    // The owner, who may use it, goes on to it.
    const found = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'booking_intake' });
    expect(found.draft.after).toMatchObject({ kind: 'booking', bookingPageId: page.id });
  });

  it('leaves every other template’s ending as its own thank you', async () => {
    const w = await workspace();
    await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const created = await createFormFromTemplate(w.scope, { id: newId(), templateId: 'demo_request' });
    expect(created.draft.after).toEqual({ kind: 'message', message: FORM_TEMPLATES.demo_request.thanks });
  });
});
