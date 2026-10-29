// The bug of 27 October 2026, end to end against a real Postgres: the owner
// made "Graphic Designers" with a required `status` and no default option, and
// every public form submission onto it failed after the visitor had typed the
// whole form in, with a sentence that named no field.
//
// Three things are checked here, one per place the trap can be stopped: it
// can't be made any more (settings gives the field its first option, or
// refuses), a form filing onto an object already in that state refuses to
// publish and says which field, and a form that was already live when the trap
// appeared fails its submission naming the field rather than "a required
// field".
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import type { AccessRules } from '../access/policy.ts';
import { archiveAttributes, createAttribute, editAttribute, restoreAttributes } from '../attributes/attributes.ts';
import { createObject } from '../objects/objects.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, testScope } from '../testing.ts';
import { updateOption } from '../engine/options.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { createForm, getForm, publishForm, saveFormDraft, setFormTarget } from './forms.ts';
import { getSubmission } from './submissions.ts';
import { processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import type { CaptchaVerdict } from './spam.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });
const off: CaptchaVerdict = { kind: 'off' };

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-required-wall-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A workspace with a "Graphic Designers" object carrying a unique work email and a Status with two stages. */
async function designers() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Wall',
    slug: `wall-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const object = await createObject(scope, {
    id: newId(),
    singularName: 'Graphic Designer',
    pluralName: 'Graphic Designers',
    icon: 'inbox',
    hue: 'blue',
  });
  const email = await createAttribute(scope, {
    objectId: object.id,
    id: newId(),
    title: 'Work email',
    type: 'email',
    isUnique: true,
  });
  const status = await createAttribute(scope, {
    objectId: object.id,
    id: newId(),
    title: 'Status',
    type: 'status',
    isRequired: true,
    options: [
      { id: newId(), label: 'New', hue: 'blue' },
      { id: newId(), label: 'Hired', hue: 'green' },
    ],
  });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  /** Puts the attribute back in the state production was in: required, with no default at all. */
  const dropDefault = (attributeId: string) =>
    query(sql`update attributes set default_value = null where id = ${attributeId}::uuid`);
  return { scope, system, object, email, status, query, dropDefault };
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

/** A form filing onto the object, asking only the work email. */
async function applyForm(w: Awaited<ReturnType<typeof designers>>) {
  const created = await createForm(w.scope, { id: newId(), name: 'Apply', mainObjectId: w.object.id });
  const targeted = await setFormTarget(w.scope, {
    formId: created.id,
    mainObjectId: w.object.id,
    expectedRevision: created.revision,
  });
  const document: FormDocument = {
    ...targeted.draft,
    questions: targeted.draft.questions.flatMap((each) =>
      each.answerType === 'email'
        ? [{ ...each, required: true, filedOn: { objectRole: 'main' as const, attributeId: w.email.id } }]
        : [],
    ),
  };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: targeted.revision });
  return { formId: created.id, revision: saved.revision };
}

describe('a required field nothing can fill (27 October 2026)', () => {
  it('gives a new required status its first option as a default rather than making the trap', async () => {
    const w = await designers();
    const options = await w.query<{ id: string; position: number }>(
      sql`select id::text, position from attribute_options where attribute_id = ${w.status.id}::uuid order by position`,
    );
    const stored = await w.query<{ value: unknown }>(
      sql`select default_value as value from attributes where id = ${w.status.id}::uuid`,
    );
    expect(stored[0]?.value).toEqual({ kind: 'static', value: options[0]?.id });
    // The definition the settings screen reads says so too.
    expect(w.status.defaultValue).toEqual({ kind: 'static', value: options[0]?.id });
  });

  it('refuses a required status with no option to fall back on, saying what would break', async () => {
    const w = await designers();
    const [refusal] = await refusalOf(
      createAttribute(w.scope, {
        objectId: w.object.id,
        id: newId(),
        title: 'Tier',
        type: 'status',
        isRequired: true,
      }),
    );
    expect(refusal?.code).toBe('CONFIG_INVALID');
    expect(refusal?.field).toBe('isRequired');
    expect(refusal?.message).toContain('Add at least one option');
  });

  it('gives an existing status its first live option when settings turns Required on', async () => {
    const w = await designers();
    const optional = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Tier',
      type: 'select',
      options: [
        { id: newId(), label: 'Junior', hue: 'blue' },
        { id: newId(), label: 'Senior', hue: 'green' },
      ],
    });
    expect(optional.defaultValue).toBeUndefined();
    const required = await editAttribute(w.scope, { attributeId: optional.id, isRequired: true });
    expect(required.defaultValue).toEqual({ kind: 'static', value: optional.options?.[0]?.id });
  });

  it('leaves an attribute already in that state alone: its other settings still save', async () => {
    const w = await designers();
    await w.dropDefault(w.status.id);
    // No migration touches it, and renaming it is not refused: only becoming a trap is.
    const renamed = await editAttribute(w.scope, { attributeId: w.status.id, title: 'Stage' });
    expect(renamed.title).toBe('Stage');
    expect(renamed.isRequired).toBe(true);
    expect(renamed.defaultValue).toBeUndefined();
  });

  it('refuses to publish a form onto an object whose required field no question fills, naming it', async () => {
    const w = await designers();
    await w.dropDefault(w.status.id);
    const form = await applyForm(w);
    const [refusal] = await refusalOf(publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision }));
    expect(refusal?.code).toBe('CONFIG_INVALID');
    expect(refusal?.message).toContain('Status is required on Graphic Designer');
    expect(refusal?.message).toContain('no question fills it');
  });

  it('never names a required field the publisher can’t see, and still refuses', async () => {
    const w = await designers();
    await w.dropDefault(w.status.id);
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: w.object.id, attributeId: w.status.id },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const form = await applyForm(w);
    const blind = rescope(w.scope, { role: 'admin', rules });
    const [refusal] = await refusalOf(publishForm(blind, { formId: form.formId, expectedRevision: form.revision }));
    expect(refusal?.message).not.toContain('Status');
    expect(refusal?.message).toContain('one field you can’t see');
    expect(refusal?.message).toContain('Ask a workspace admin');
  });

  it('refuses turning Required on while a live form has no question for the field', async () => {
    // The other direction from the publish check: the form was fine and the field changed under it.
    const w = await designers();
    const form = await applyForm(w);
    const studio = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Studio',
      type: 'text',
    });
    // While the form is only a draft, nothing is posting to it, so the change is let through.
    const required = await editAttribute(w.scope, { attributeId: studio.id, isRequired: true });
    expect(required.isRequired).toBe(true);
    await editAttribute(w.scope, { attributeId: studio.id, isRequired: false });

    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const [refusal] = await refusalOf(editAttribute(w.scope, { attributeId: studio.id, isRequired: true }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(refusal?.message).toContain('Apply');
    expect(refusal?.message).toContain('Studio');
  });

  it('refuses turning Required on while a live booking page makes People records without it (late trap #11)', async () => {
    // A booking stands when the guest's record can't be made, so the break would show as guests missing from the CRM.
    const w = await designers();
    const [people] = await w.query<{ id: string }>(sql`select id::text from objects where standard_key = 'people'`);
    if (people === undefined) throw new Error('No People.');
    const phone = await createAttribute(w.scope, {
      objectId: people.id,
      id: newId(),
      title: 'Desk phone',
      type: 'text',
    });
    const page = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const [refusal] = await refusalOf(editAttribute(w.scope, { attributeId: phone.id, isRequired: true }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(refusal?.message).toContain('Intro call');
    expect(refusal?.message).toContain('Desk phone');
    // What a booking writes itself is no wall, and a paused page makes nothing.
    const [name] = await w.query<{ id: string }>(
      sql`select id::text from attributes where object_id = ${people.id}::uuid and api_slug = 'name'`,
    );
    if (name === undefined) throw new Error('No Name.');
    expect((await editAttribute(w.scope, { attributeId: name.id, isRequired: true })).isRequired).toBe(true);
    await updateBookingPage(w.scope, { pageId: page.id, settings: { status: 'paused' } });
    expect((await editAttribute(w.scope, { attributeId: phone.id, isRequired: true })).isRequired).toBe(true);
  });

  it('refuses it too for a page onto another object that asks only an unfiled question, and for Companies', async () => {
    const w = await designers();
    const page = await createBookingPage(w.scope, { id: newId(), title: 'Portfolio review', timeZone: 'UTC' });
    const question = {
      id: newId(),
      key: 'notes',
      label: 'Anything to share?',
      answerType: 'short_text' as const,
      required: false,
      update: 'fill' as const,
    };
    await updateBookingPage(w.scope, {
      pageId: page.id,
      settings: { answersObjectId: w.object.id, questions: [question] },
    });
    const portfolio = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Portfolio',
      type: 'text',
    });
    const [refusal] = await refusalOf(editAttribute(w.scope, { attributeId: portfolio.id, isRequired: true }));
    expect(refusal?.message).toContain('Portfolio review');
    // A guest's Company is made in the Person's savepoint, so a wall there loses the Person too.
    const [companies] = await w.query<{ id: string }>(
      sql`select id::text from objects where standard_key = 'companies'`,
    );
    if (companies === undefined) throw new Error('No Companies.');
    const tier = await createAttribute(w.scope, { objectId: companies.id, id: newId(), title: 'Tier', type: 'text' });
    const [walled] = await refusalOf(editAttribute(w.scope, { attributeId: tier.id, isRequired: true }));
    expect(walled?.message).toContain('Portfolio review');
  });

  it('counts a Current user default as nothing for a visitor when it replaces one that filled (late trap #10)', async () => {
    const w = await designers();
    const form = await applyForm(w);
    const lead = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Lead owner',
      type: 'actor_reference',
      isRequired: true,
      defaultValue: { kind: 'static', value: { type: 'member', id: w.scope.actor.id } },
    });
    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const [refusal] = await refusalOf(
      editAttribute(w.scope, { attributeId: lead.id, defaultValue: { kind: 'current_user' } }),
    );
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(refusal?.message).toContain('Lead owner');
  });

  it('refuses archiving the field a live form matches its submissions on', async () => {
    // Nothing in the form changes, so the break only shows as a second record for the same person, every time.
    const w = await designers();
    const form = await applyForm(w);
    // A draft form holds nothing back.
    const archived = await archiveAttributes(w.scope, { attributeId: w.email.id });
    expect(archived.length).toBeGreaterThan(0);
    await editAttribute(w.scope, { attributeId: w.email.id, title: 'Work email' });
    const restored = await restoreAttributes(w.scope, { attributeId: w.email.id });
    expect(restored.length).toBeGreaterThan(0);

    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const [refusal] = await refusalOf(archiveAttributes(w.scope, { attributeId: w.email.id }));
    expect(refusal?.code).toBe('CONFIG_INVALID');
    expect(refusal?.message).toContain('Work email is how Apply finds');
    expect(refusal?.message).toContain('add a new record');
  });

  it('refuses turning Unique off on People’s Email addresses while a booking page finds guests by it, and no other', async () => {
    const w = await designers();
    const [people] = await w.query<{ id: string; email: string }>(sql`
      select o.id::text, a.id::text as email from objects o join attributes a on a.object_id = o.id
      where o.standard_key = 'people' and a.api_slug = 'email_addresses'
    `);
    if (people === undefined) throw new Error('No People.');
    await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const [refusal] = await refusalOf(editAttribute(w.scope, { attributeId: people.email, isUnique: false }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isUnique' });
    expect(refusal?.message).toContain('Intro call');
    // Another unique email on People, even placed first, isn't what a booking matches on.
    const work = await createAttribute(w.scope, {
      objectId: people.id,
      id: newId(),
      title: 'Work email',
      type: 'email',
      isUnique: true,
    });
    await w.query(sql`update attributes set position = -1 where id = ${work.id}::uuid`);
    expect((await editAttribute(w.scope, { attributeId: work.id, isUnique: false })).isUnique).toBe(false);
  });

  it('refuses turning Unique off on the field a live form matches on (late trap #13)', async () => {
    const w = await designers();
    const form = await applyForm(w);
    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const [refusal] = await refusalOf(editAttribute(w.scope, { attributeId: w.email.id, isUnique: false }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isUnique' });
    expect(refusal?.message).toContain('Turning Unique off');
    expect(refusal?.message).toContain('Apply');
  });

  it('counts a live form the editor can’t see, and refuses without naming it', async () => {
    // A published form whose draft was repointed elsewhere is hidden from someone who can't see that object
    // (`canSeeForm`), so the refusal counts it and says "A live form" (security review, 27 October 2026).
    const w = await designers();
    const form = await applyForm(w);
    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const studio = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Studio',
      type: 'text',
    });
    // Its draft now keeps submissions only, so seeing the form needs forms.manage, which this key hasn't.
    await w.query(sql`update forms set main_object_id = null where id = ${form.formId}::uuid`);
    const key = rescope(w.scope, { actor: { type: 'api_key', id: newId() }, scopes: ['schema.manage', 'data.write'] });
    const [refusal] = await refusalOf(editAttribute(key, { attributeId: studio.id, isRequired: true }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(refusal?.message).not.toContain('Apply');
    expect(refusal?.message).toContain('A live form');

    // The owner, who may see it, reads its name.
    const [named] = await refusalOf(editAttribute(w.scope, { attributeId: studio.id, isRequired: true }));
    expect(named?.message).toContain('Apply');
  });

  it('refuses making a field required at creation, and restoring one into that state', async () => {
    // The two paths around `updateAttribute` that set the same trap (security review, 27 October 2026).
    const w = await designers();
    const form = await applyForm(w);
    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const [onCreate] = await refusalOf(
      createAttribute(w.scope, {
        objectId: w.object.id,
        id: newId(),
        title: 'Lead source',
        type: 'text',
        isRequired: true,
      }),
    );
    expect(onCreate).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(onCreate?.message).toContain('Lead source');

    // Archive, submissions pass, restore, submissions fail again: the restore is refused too.
    const source = await createAttribute(w.scope, {
      objectId: w.object.id,
      id: newId(),
      title: 'Channel',
      type: 'text',
    });
    await w.query(sql`update attributes set is_required = true where id = ${source.id}::uuid`);
    await archiveAttributes(w.scope, { attributeId: source.id });
    const [onRestore] = await refusalOf(restoreAttributes(w.scope, { attributeId: source.id }));
    expect(onRestore).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(onRestore?.message).toContain('Channel');
  });

  it('refuses archiving an object a live form files onto', async () => {
    const w = await designers();
    const form = await applyForm(w);
    await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    const { archiveObject } = await import('../objects/objects.ts');
    const [refusal] = await refusalOf(archiveObject(w.scope, { objectId: w.object.id }));
    expect(refusal?.code).toBe('CONFIG_INVALID');
    expect(refusal?.message).toContain('Apply');
    expect(refusal?.message).toContain('takes no new records');
  });

  it('refuses archiving the last live option of a required field, which would bring the trap back', async () => {
    const w = await designers();
    const options = await w.query<{ id: string }>(
      sql`select id::text from attribute_options where attribute_id = ${w.status.id}::uuid order by position`,
    );
    const [first, second] = options;
    // Archiving one of two is fine: the other still fills the field.
    await updateOption(w.scope, { optionId: second?.id ?? '', archived: true });
    const [refusal] = await refusalOf(updateOption(w.scope, { optionId: first?.id ?? '', archived: true }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'archived' });
    expect(refusal?.message).toContain('Add at least one option');
  });

  it('names the field when a form that was already live meets the trap at submission time', async () => {
    const w = await designers();
    const form = await applyForm(w);
    const live = await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    // The owner clears the default afterwards, which is how production got here: the form was live already.
    await w.dropDefault(w.status.id);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    const posted = await submitForm(scope, registry, {
      formId,
      body: { idempotencyKey: newId(), answers: { email: 'kit@example.com' }, hidden: {}, fillMs: 10_000 },
      captcha: off,
      answersKey: 'a-test-answers-key',
    });
    const [row] = await w.query<{ id: string }>(
      sql`select id::text from form_submissions where form_id = ${formId}::uuid order by received_at desc limit 1`,
    );
    expect(posted).toBeDefined();
    await runWrite(w.system, (context) => processSubmission(context, row?.id ?? ''));
    const [after] = await w.query<{ state: string; failure: string | null }>(
      sql`select state, failure from form_submissions where id = ${row?.id ?? ''}::uuid`,
    );
    expect(after?.state).toBe('failed');
    // Named for a reader who may see the field; the stored column names nothing (the test below).
    const seen = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    expect(seen.failure).toContain('Status is required');
    expect(seen.failure).not.toContain('A required field isn’t asked');
  });

  it('takes a site’s own form missing a question added since, and says the fix is on the site (late trap #55)', async () => {
    const w = await designers();
    const form = await applyForm(w);
    const [first] = (await getForm(w.scope, { formId: form.formId })).draft.questions;
    if (first === undefined) throw new Error('The form asks the email.');
    // A required Stage question added after the site copied its HTML, filed on the required Status.
    const withStage = await saveFormDraft(w.scope, {
      formId: form.formId,
      document: {
        ...(await getForm(w.scope, { formId: form.formId })).draft,
        questions: [
          first,
          {
            id: 'stage',
            key: 'stage',
            label: 'Stage',
            answerType: 'dropdown',
            choices: ['New', 'Hired'],
            required: true,
            update: 'fill',
            filedOn: { objectRole: 'main', attributeId: w.status.id },
          },
        ],
      },
      expectedRevision: form.revision,
    });
    const live = await publishForm(w.scope, { formId: form.formId, expectedRevision: withStage.revision });
    await w.dropDefault(w.status.id);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    const body = { idempotencyKey: newId(), answers: { email: 'kit@example.com' }, hidden: {}, fillMs: 10_000 };
    // From our own page the absent Stage is refused; from the site's form, the submission is kept.
    expect(await refusalOf(submitForm(scope, registry, { formId, body, captcha: off }))).toMatchObject([
      { field: 'stage' },
    ]);
    await submitForm(scope, registry, { formId, body, captcha: off, fromSite: true });
    const [row] = await w.query<{ id: string }>(
      sql`select id::text from form_submissions where form_id = ${formId}::uuid order by received_at desc limit 1`,
    );
    await runWrite(w.system, (context) => processSubmission(context, row?.id ?? ''));
    const seen = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    expect(seen.state).toBe('failed');
    expect(seen.failure).toBe(
      'Status is filled by “Stage”, which your site’s own form doesn’t ask, so the record couldn’t be created. Add that field to the form on your site; the Install tab has the code.',
    );
  });

  it('stores the failure unnamed, and names the field only for a reader who may see it', async () => {
    // The job runs as the system, which sees every field, so the stored sentence may name none of them
    // (security review, 27 October 2026). The reader's own access decides.
    const w = await designers();
    const form = await applyForm(w);
    const live = await publishForm(w.scope, { formId: form.formId, expectedRevision: form.revision });
    await w.dropDefault(w.status.id);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    await submitForm(scope, registry, {
      formId,
      body: { idempotencyKey: newId(), answers: { email: 'kit@example.com' }, hidden: {}, fillMs: 10_000 },
      captcha: off,
      answersKey: 'a-test-answers-key',
    });
    const [row] = await w.query<{ id: string }>(
      sql`select id::text from form_submissions where form_id = ${formId}::uuid order by received_at desc limit 1`,
    );
    await runWrite(w.system, (context) => processSubmission(context, row?.id ?? ''));

    // What the system wrote to the column names nothing.
    const [stored] = await w.query<{ failure: string | null; outcome: { requiredMissing?: string[] } }>(
      sql`select failure, outcome from form_submissions where id = ${row?.id ?? ''}::uuid`,
    );
    expect(stored?.failure).toContain('A required field isn’t asked');
    expect(stored?.failure).not.toContain('Status');
    expect(stored?.outcome.requiredMissing).toEqual([w.status.id]);

    // A reader who may see the field reads its name.
    const seen = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    expect(seen.failure).toContain('Status is required');

    // A reader the field is hidden from reads the sentence that names nothing.
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: w.object.id, attributeId: w.status.id },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const blind = await getSubmission(rescope(w.scope, { role: 'admin', rules }), { submissionId: row?.id ?? '' });
    expect(blind.failure).not.toContain('Status');
    expect(blind.failure).toContain('A required field isn’t asked');
  });
});
