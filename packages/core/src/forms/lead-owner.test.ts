// Spec 0029 milestone 3 (AC-755, AC-756) and spec 0023 AC-567, AC-1050,
// against a real Postgres as the app role: a form whose owner is a round
// robin rotation hands each new lead to the rotation's fairest member, in the
// one ledger bookings count on, for every submission (booking or not). Who
// may set it, the rotation gone or nobody free, owner first for a known
// person, and a submission processed, retried or filed again never assigned
// twice.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type RotationMemberInput, type RotationSettings, type SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm, NO_RULE_SOURCE } from '../access/door.ts';
import { mintScope } from '../access/mint.ts';
import { roleAccess } from '../access/policy.ts';
import { editAttribute } from '../attributes/attributes.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { deleteRecords } from '../engine/trash.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { adjustCount } from '../rotation/distribution.ts';
import { createRotation, deleteRotation, updateRotation } from '../rotation/rotations.ts';
import { rescope, testScope } from '../testing.ts';
import { jobTestKit } from '../../test/jobs-kit.ts';
import { addToCrm } from './filing.ts';
import { createForm, OWNER_ROTATION_UNSEEN, publishForm, updateFormSettings } from './forms.ts';
import { processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import { getSubmission, retrySubmission } from './submissions.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-lead-owner-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
/** A workspace (Ada its owner) with three members on weekday hours in UTC, and a way to read it as the app. */
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Leads',
    slug: `leads-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const rows = await query<{ id: string; slug: string }>(
    sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
  );
  const ids = Object.fromEntries(rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => {
    const id = ids[slug];
    if (id === undefined) throw new Error(`No attribute ${slug}.`);
    return id;
  };
  /** A member (role member unless said) with weekday hours in UTC, and any days off. */
  const addMember = async (name: string, daysOff: readonly string[] = []) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
            values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@example.com`},
              'member', 'system', 'system')`,
      ),
    );
    const own = rescope(scope, { actor: { type: 'member', id }, role: 'member' });
    await saveDefaultHours(own, {
      availability: { ...defaultAvailability('UTC'), overrides: daysOff.map((date) => ({ date, ranges: [] })) },
    });
    return { id, scope: own };
  };
  return {
    workspaceId: created.workspaceId,
    scope,
    system,
    query,
    attribute,
    addMember,
    people: created.objects.people ?? '',
  };
}
type Workspace = Awaited<ReturnType<typeof workspace>>;

const pooled = (memberId: string, over: Partial<RotationMemberInput> = {}): RotationMemberInput => ({
  memberId,
  weight: 100,
  priority: 2,
  dailyCap: null,
  weeklyCap: null,
  isOn: true,
  ...over,
});

/** A rotation named Sales of these members (Fair, 30 days, owner first unless said). */
function sales(
  w: Workspace,
  memberIds: readonly string[],
  settings: Partial<RotationSettings> = {},
  over: readonly Partial<RotationMemberInput>[] = [],
) {
  return createRotation(w.scope, {
    id: newId(),
    settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner', ...settings },
    members: memberIds.map((id, index) => pooled(id, over[index])),
  });
}

/** A published People form (name, email, phone) whose owner is the rotation. */
async function leadForm(w: Workspace, rotationId: string) {
  const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
  const live = await publishForm(w.scope, { formId: created.id, expectedRevision: created.revision });
  return updateFormSettings(w.scope, { formId: live.id, ownerRotationId: rotationId });
}

/** Sends the form from its public address and answers the new submission's id. */
async function submit(publicKey: string, name: string, email: string): Promise<string> {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  const body: SubmitBody = { idempotencyKey: newId(), answers: { name, email }, hidden: {}, fillMs: 10_000 };
  await submitForm(scope, registry, { formId, body, captcha: { kind: 'off' }, answersKey: 'a-test-answers-key' });
  const stored = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(
      sql`select id::text from form_submissions where form_id = ${formId} and idempotency_key = ${body.idempotencyKey}`,
    ),
  );
  const id = stored.rows[0]?.id;
  if (id === undefined) throw new Error('No submission stored.');
  return id;
}

/** Processes a submission as the job does: one write under the system's scope, at `now`. */
async function processNow(w: Workspace, submissionId: string, now = new Date()) {
  await runWrite(w.system, (context) => processSubmission(context, submissionId, now));
}

/** The member owning a record now, if any. */
async function ownerOf(w: Workspace, recordId: string | undefined): Promise<string | undefined> {
  const [row] = await w.query<{ member: string }>(sql`
    select v.actor_member_id::text as member from "values" v
    where v.record_id = ${recordId ?? newId()} and v.attribute_id = ${w.attribute('people.owner')}
      and v.active_until is null
  `);
  return row?.member;
}

/** The rotation's live assignment rows (adjustments left out), oldest first. */
function ledger(w: Workspace, rotationId: string) {
  return w.query<{ member: string; source: string; reason: string; record: string | null; form: string | null }>(sql`
    select member_id::text as member, source, reason, record_id::text as record, detail->>'formId' as form
    from rotation_assignments where rotation_id = ${rotationId} and voided_at is null and source <> 'adjustment'
    order by assigned_at, id
  `);
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

/** Today's date in UTC, as a day off names it. */
const todayUtc = (now: Date) => now.toISOString().slice(0, 10);

describe('a form lead gets its owner from a rotation (AC-755, AC-1050)', () => {
  it('hands each new lead to the fairest member in turn, with a form ledger row explaining it', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const dan = await w.addMember('Dan');
    const rotation = await sales(w, [bea.id, cy.id, dan.id]);
    const form = await leadForm(w, rotation.id);
    expect(form).toMatchObject({ ownerRotationId: rotation.id });
    expect(form.ownerMemberId).toBeUndefined();

    const owners: (string | undefined)[] = [];
    for (const [index, name] of ['Lea', 'Max', 'Nia', 'Oli'].entries()) {
      const submissionId = await submit(form.publicKey, name, `lead-${String(index)}@example.com`);
      await processNow(w, submissionId);
      const view = await getSubmission(w.scope, { submissionId });
      expect(view.state).toBe('processed');
      const owner = await ownerOf(w, view.mainRecord?.recordId);
      owners.push(owner);
      expect(view.assignment).toEqual({ memberId: owner, rotationId: rotation.id, reason: 'fair' });
    }
    // Even counts break ties on whoever waited longest (never assigned first), then by member id.
    const first = [bea.id, cy.id, dan.id].sort();
    expect(owners).toEqual([...first, first[0]]);
    const rows = await ledger(w, rotation.id);
    expect(rows.map((row) => [row.member, row.source, row.reason, row.form])).toEqual(
      owners.map((owner) => [owner, 'form', 'fair', form.id]),
    );
    expect(rows.every((row) => row.record !== null)).toBe(true);
  });

  it('shares one count with meetings: a member ahead in the ledger waits, and caps and days off skip a member', async () => {
    const now = new Date();
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy', [todayUtc(now)]);
    const dan = await w.addMember('Dan');
    // Dan may take one a day.
    const rotation = await sales(w, [bea.id, cy.id, dan.id], {}, [{}, {}, { dailyCap: 1 }]);
    // Bea is two ahead, as two meetings would put her.
    await adjustCount(w.scope, { rotationId: rotation.id, memberId: bea.id, units: 2, note: 'Two meetings before' });
    const form = await leadForm(w, rotation.id);

    const owners: (string | undefined)[] = [];
    for (const [index, name] of ['Lea', 'Max', 'Nia'].entries()) {
      const submissionId = await submit(form.publicKey, name, `shared-${String(index)}@example.com`);
      await processNow(w, submissionId, now);
      owners.push(await ownerOf(w, (await getSubmission(w.scope, { submissionId })).mainRecord?.recordId));
    }
    // Cy is off today; Dan, two behind Bea, takes one (his cap); then Bea, though ahead, is the only one left.
    expect(owners).toEqual([dan.id, bea.id, bea.id]);
    expect((await ledger(w, rotation.id)).map((row) => row.reason)).toEqual(['fair', 'only_free', 'only_free']);
  });

  it('gives a known person to their owner when the owner is in the rotation, and otherwise leaves the owner be', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const rotation = await sales(w, [bea.id, cy.id]);
    const form = await leadForm(w, rotation.id);
    const known = await createRecord(w.scope, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Known' },
        [w.attribute('people.email_addresses')]: ['known@example.com'],
        [w.attribute('people.owner')]: { type: 'member', id: cy.id },
      },
    });
    const submissionId = await submit(form.publicKey, 'Known Person', 'known@example.com');
    await processNow(w, submissionId);
    expect((await getSubmission(w.scope, { submissionId })).assignment).toEqual({
      memberId: cy.id,
      rotationId: rotation.id,
      reason: 'owner',
    });
    expect(await ownerOf(w, known.recordId)).toBe(cy.id);
    expect((await ledger(w, rotation.id)).map((row) => [row.member, row.reason, row.record])).toEqual([
      [cy.id, 'owner', known.recordId],
    ]);

    // A rotation that doesn't send people to their owner takes no turn for a person who has one (AC-567).
    await updateRotation(w.scope, { rotationId: rotation.id, settings: { returning: 'none' } });
    const outsider = await createRecord(w.scope, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Outsider' },
        [w.attribute('people.email_addresses')]: ['outsider@example.com'],
        [w.attribute('people.owner')]: { type: 'member', id: bea.id },
      },
    });
    const second = await submit(form.publicKey, 'Out Sider', 'outsider@example.com');
    await processNow(w, second);
    expect((await getSubmission(w.scope, { submissionId: second })).assignment).toEqual({
      rotationId: rotation.id,
      reason: 'kept_existing',
    });
    expect(await ownerOf(w, outsider.recordId)).toBe(bea.id);
    expect(await ledger(w, rotation.id)).toHaveLength(1);
  });
});

describe('nobody to take it (AC-756)', () => {
  it('files the lead with no owner when everyone is switched off, and when the rotation is gone', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const rotation = await sales(w, [bea.id, cy.id], {}, [{ isOn: false }, { isOn: false }]);
    const form = await leadForm(w, rotation.id);
    const first = await submit(form.publicKey, 'Lea Lead', 'none@example.com');
    await processNow(w, first);
    const view = await getSubmission(w.scope, { submissionId: first });
    expect(view).toMatchObject({
      state: 'processed',
      assignment: { rotationId: rotation.id, reason: 'none_available' },
    });
    expect(view.assignment?.memberId).toBeUndefined();
    expect(view.mainRecord?.recordId).toBeDefined();
    expect(await ownerOf(w, view.mainRecord?.recordId)).toBeUndefined();
    expect(await ledger(w, rotation.id)).toEqual([]);

    // Deleted under the form (a delete raced the guard): the lead still files, with no owner, and says why.
    await w.query(sql`update rotations set deleted_at = now() where id = ${rotation.id}`);
    const second = await submit(form.publicKey, 'Max Lead', 'gone@example.com');
    await processNow(w, second);
    const gone = await getSubmission(w.scope, { submissionId: second });
    expect(gone).toMatchObject({
      state: 'processed',
      assignment: { rotationId: rotation.id, reason: 'rotation_gone' },
    });
    expect(await ownerOf(w, gone.mainRecord?.recordId)).toBeUndefined();
  });
});

describe('never assigned twice', () => {
  it('a job run twice, a failed submission retried, and a second submission from the same person', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const rotation = await sales(w, [bea.id, cy.id]);
    const form = await leadForm(w, rotation.id);

    // Processing fails (a required field the form doesn't ask): nothing is counted.
    const timezone = w.attribute('people.timezone');
    await editAttribute(w.scope, { attributeId: timezone, isRequired: true });
    const submissionId = await submit(form.publicKey, 'Lea Lead', 'twice@example.com');
    await processNow(w, submissionId);
    expect(await getSubmission(w.scope, { submissionId })).toMatchObject({
      state: 'failed',
      assignment: { rotationId: rotation.id, reason: 'not_filed' },
    });
    expect(await ledger(w, rotation.id)).toEqual([]);

    // Retried once the cause is fixed: one assignment; the job running twice changes nothing.
    await editAttribute(w.scope, { attributeId: timezone, isRequired: false });
    await retrySubmission(w.scope, registry, { submissionId });
    await processNow(w, submissionId);
    await processNow(w, submissionId);
    const view = await getSubmission(w.scope, { submissionId });
    const recordId = view.mainRecord?.recordId;
    expect(view).toMatchObject({ state: 'processed', assignment: { rotationId: rotation.id, reason: 'fair' } });
    const owner = await ownerOf(w, recordId);
    expect([bea.id, cy.id]).toContain(owner);
    expect(await ledger(w, rotation.id)).toHaveLength(1);

    // The same person again: their record keeps its owner, and the lead isn't counted again.
    const again = await submit(form.publicKey, 'Lea Lead', 'twice@example.com');
    await processNow(w, again);
    expect((await getSubmission(w.scope, { submissionId: again })).assignment).toEqual({
      rotationId: rotation.id,
      reason: 'kept_existing',
    });
    expect(await ledger(w, rotation.id)).toHaveLength(1);
  });

  it('a submission filed again after its record went to the trash keeps the member it was given', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const rotation = await sales(w, [bea.id, cy.id]);
    const form = await leadForm(w, rotation.id);
    const submissionId = await submit(form.publicKey, 'Lea Lead', 'trash@example.com');
    await processNow(w, submissionId);
    const first = await getSubmission(w.scope, { submissionId });
    const owner = await ownerOf(w, first.mainRecord?.recordId);
    await deleteRecords(w.scope, {
      objectId: w.people,
      recordIds: [first.mainRecord?.recordId ?? ''],
      batchId: newId(),
    });

    const started = await addToCrm(w.scope, registry, { formId: form.id, submissionIds: [submissionId] });
    const kit = jobTestKit(db, ownerUrl, { rules: NO_RULE_SOURCE });
    const outcomes = await kit.drive(kit.runnerFor(registry), w.workspaceId, started.jobId ?? '');
    expect(outcomes.at(-1)).toBe('succeeded');
    const refiled = await getSubmission(w.scope, { submissionId });
    expect(refiled.mainRecord?.recordId).not.toBe(first.mainRecord?.recordId);
    expect(await ownerOf(w, refiled.mainRecord?.recordId)).toBe(owner);
    expect(refiled.assignment).toEqual({ memberId: owner, rotationId: rotation.id, reason: 'already_assigned' });
    expect(await ledger(w, rotation.id)).toHaveLength(1);
  });
});

describe('choosing the rotation (Settings, forms.manage)', () => {
  it('refuses a member without forms.manage, a rotation they can’t see or from elsewhere, and two owners at once', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const dan = await w.addMember('Dan');
    const rotation = await sales(w, [bea.id, cy.id]);
    const created = await createForm(w.scope, { id: newId() });

    // Role member: no forms.manage.
    expect(
      await refusalOf(updateFormSettings(dan.scope, { formId: created.id, ownerRotationId: rotation.id })),
    ).toMatchObject([{ code: 'FORBIDDEN' }]);

    // A role with forms.manage and booking.manage, outside the rotation: it isn't theirs to pick.
    const lister = mintScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: dan.id },
      access: Object.freeze({
        ...roleAccess({ kind: 'member', memberId: dan.id, role: 'member', teamIds: [] }),
        permissions: Object.freeze(['forms.manage', 'booking.manage'] as const),
      }),
    });
    expect(
      await refusalOf(updateFormSettings(lister, { formId: created.id, ownerRotationId: rotation.id })),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'ownerRotationId', message: OWNER_ROTATION_UNSEEN }]);
    // One they are in is theirs to pick.
    const theirs = await sales(w, [dan.id, bea.id]);
    expect(await updateFormSettings(lister, { formId: created.id, ownerRotationId: theirs.id })).toMatchObject({
      ownerRotationId: theirs.id,
    });

    // Another workspace's rotation names nothing here.
    const elsewhere = await workspace();
    const eve = await elsewhere.addMember('Eve');
    const fay = await elsewhere.addMember('Fay');
    const foreign = await sales(elsewhere, [eve.id, fay.id]);
    expect(
      await refusalOf(updateFormSettings(w.scope, { formId: created.id, ownerRotationId: foreign.id })),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'ownerRotationId', message: OWNER_ROTATION_UNSEEN }]);

    expect(
      await refusalOf(
        updateFormSettings(w.scope, { formId: created.id, ownerMemberId: bea.id, ownerRotationId: rotation.id }),
      ),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'ownerRotationId' }]);
  });

  it('naming one owner clears the other, each change is audited, and a rotation in use can’t be deleted', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const cy = await w.addMember('Cy');
    const rotation = await sales(w, [bea.id, cy.id]);
    const created = await createForm(w.scope, { id: newId() });
    expect(created.ownerMemberId).toBeDefined();

    const toRotation = await updateFormSettings(w.scope, { formId: created.id, ownerRotationId: rotation.id });
    expect(toRotation.ownerRotationId).toBe(rotation.id);
    expect(toRotation.ownerMemberId).toBeUndefined();
    expect(await refusalOf(deleteRotation(w.scope, { rotationId: rotation.id }))).toEqual([
      { code: 'IN_USE', message: 'Used by 1 form. Move them to another rotation first.' },
    ]);

    const toMember = await updateFormSettings(w.scope, { formId: created.id, ownerMemberId: bea.id });
    expect(toMember.ownerMemberId).toBe(bea.id);
    expect(toMember.ownerRotationId).toBeUndefined();
    const nobody = await updateFormSettings(w.scope, {
      formId: created.id,
      ownerMemberId: null,
      ownerRotationId: null,
    });
    expect(nobody.ownerMemberId).toBeUndefined();
    expect(nobody.ownerRotationId).toBeUndefined();
    expect(await deleteRotation(w.scope, { rotationId: rotation.id })).toEqual({ rotationId: rotation.id });

    const audits = await w.query<{ after: { ownerMemberId: string | null; ownerRotationId: string | null } }>(sql`
      select after from audit_events where action = 'form.owner_changed' and target_id = ${created.id}
      order by at, id
    `);
    expect(audits.map((row) => row.after)).toEqual([
      { ownerMemberId: null, ownerRotationId: rotation.id },
      { ownerMemberId: bea.id, ownerRotationId: null },
      { ownerMemberId: null, ownerRotationId: null },
    ]);
  });
});
