// Validation rules through the API (spec 0013, milestone 1): an owner saves
// rules with attributes.create and attributes.update, attributes.list carries
// them inline, a member's rule write is 403 with no outbox row, and a record
// write that breaks a rule answers 422 VALIDATION_FAILED with every failing
// rule, raw calls included. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, refusal, refusalsOf } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

describe('rules on attributes', () => {
  it('saves rules with an edit and a create, and lists them inline', async () => {
    const m = await memberWithWorkspace(app);
    const jobTitle = m.attribute('job_title');
    const rule = { id: newId(), kind: 'length' as const, params: { max: 40 }, message: 'Keep titles short.' };
    const edited = await m.client.attributes.update({
      workspace: m.slug,
      attributeId: jobTitle,
      rules: [rule],
      mutationId: newId(),
    });
    expect(edited.validation).toEqual({
      required: 'never',
      rules: [{ id: rule.id, kind: 'length', params: { max: 40 }, message: 'Keep titles short.', position: 0 }],
    });
    expect(edited.isRequired).toBe(false);
    const made = await m.client.attributes.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      title: 'Badge',
      type: 'text',
      rules: [{ id: newId(), kind: 'pattern', params: { preset: 'digits', ignoreCase: false } }],
      mutationId: newId(),
    });
    expect(made.validation?.rules.map((each) => each.kind)).toEqual(['pattern']);
    const listed = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(listed.find((each) => each.id === jobTitle)?.validation?.rules).toHaveLength(1);
  });

  it('refuses bad settings 422 CONFIG_INVALID on the rule’s field, and a 21st rule 409 LIMIT_REACHED', async () => {
    const m = await memberWithWorkspace(app);
    const jobTitle = m.attribute('job_title');
    const bad = await failure(() =>
      m.client.attributes.update({
        workspace: m.slug,
        attributeId: jobTitle,
        rules: [{ id: newId(), kind: 'pattern', params: { preset: 'custom', regex: 'a(', ignoreCase: false } }],
        mutationId: newId(),
      }),
    );
    expect(bad.status).toBe(422);
    expect(refusalsOf(bad)).toEqual([
      {
        code: 'CONFIG_INVALID',
        message: 'That pattern can’t be used: missing closing ): `a(`.',
        field: 'rules.0.regex',
      },
    ]);
    const tooMany = await refusal(() =>
      m.client.attributes.update({
        workspace: m.slug,
        attributeId: jobTitle,
        rules: Array.from({ length: 21 }, () => ({ id: newId(), kind: 'length' as const, params: { max: 10 } })),
        mutationId: newId(),
      }),
    );
    expect(tooMany).toEqual({ code: 'LIMIT_REACHED', status: 409, message: 'An attribute holds at most 20 rules.' });
  });

  it('refuses a member’s rule writes 403, storing no outbox row', async () => {
    const m = await memberWithWorkspace(app);
    const { cookie, email } = await signIn(app);
    const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
      [m.workspace.id, newId(), user?.id, email],
    );
    const member = rpcClient(app, cookie);
    const outbox = async () =>
      (
        await testQuery<{ n: number }>(ownerUrl, 'select count(*)::int as n from outbox where workspace_id = $1', [
          m.workspace.id,
        ])
      )[0]?.n;
    const before = await outbox();
    const rules = [{ id: newId(), kind: 'length' as const, params: { max: 3 } }];
    for (const write of [
      () =>
        member.attributes.update({
          workspace: m.slug,
          attributeId: m.attribute('job_title'),
          rules,
          mutationId: newId(),
        }),
      () =>
        member.attributes.create({
          workspace: m.slug,
          objectId: m.people.id,
          id: newId(),
          title: 'Badge',
          type: 'text',
          rules,
          mutationId: newId(),
        }),
    ]) {
      expect((await refusal(write)).code).toBe('FORBIDDEN');
    }
    expect(await outbox()).toBe(before);
    // Members read the rules, read only.
    const listed = await member.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(listed.find((each) => each.apiSlug === 'job_title')?.validation).toEqual({ required: 'never', rules: [] });
  });
});

describe('record writes that break a rule', () => {
  it('answer 422 VALIDATION_FAILED with every failing rule, on one record or in a batch', async () => {
    const m = await memberWithWorkspace(app);
    const jobTitle = m.attribute('job_title');
    const short = { id: newId(), kind: 'length' as const, params: { max: 4 } };
    const letters = { id: newId(), kind: 'pattern' as const, params: { preset: 'letters', ignoreCase: false } };
    await m.client.attributes.update({
      workspace: m.slug,
      attributeId: jobTitle,
      rules: [short, letters],
      mutationId: newId(),
    });
    const name = m.attribute('name');
    const person = await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: { [name]: { firstName: 'Ada' } },
      timeZone: 'Europe/London',
      mutationId: newId(),
    });
    const both = await failure(() =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: person.id,
        values: { [jobTitle]: { value: 'CTO 2' } },
        timeZone: 'Europe/London',
        mutationId: newId(),
      }),
    );
    expect({ code: both.code, status: both.status, message: both.message }).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: '2 rules aren’t met.',
    });
    expect(refusalsOf(both)).toEqual([
      {
        code: 'VALIDATION_FAILED',
        message: 'Job title can have at most 4 characters.',
        attributeId: jobTitle,
        ruleId: short.id,
      },
      {
        code: 'VALIDATION_FAILED',
        message: 'Job title can only contain letters.',
        attributeId: jobTitle,
        ruleId: letters.id,
      },
    ]);
    const one = await refusal(() =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: person.id,
        values: { [jobTitle]: { value: 'Chief' } },
        mutationId: newId(),
      }),
    );
    expect(one).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: 'Job title can have at most 4 characters.',
    });
    const batch = await m.client.records.setValuesBatch({
      workspace: m.slug,
      items: [{ recordId: person.id, values: { [jobTitle]: { value: 'Chief' } } }],
      mutationId: newId(),
    });
    expect(batch.results[0]?.refusals).toEqual([
      {
        code: 'VALIDATION_FAILED',
        message: 'Job title can have at most 4 characters.',
        attributeId: jobTitle,
        ruleId: short.id,
      },
    ]);
    const landed = await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [jobTitle]: { value: 'CTO' } },
      mutationId: newId(),
    });
    expect(landed.values[jobTitle]).toBe('CTO');
  });
});
