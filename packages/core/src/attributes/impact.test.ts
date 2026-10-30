// An attribute's uses and counts (flow pass, 30 October 2026) against a real Postgres as the app role: records per
// option in one grouped count, empty records, shared values, and a plain member refused.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import { createAttribute } from './attributes.ts';
import { attributeImpact } from './impact.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-impact-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Impact',
    slug: `impact-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const projects = (
    await createObject(scope, {
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
    })
  ).id;
  return { scope, projects };
}

describe('attributeImpact', () => {
  it('counts records per option, empty records and shared values', async () => {
    const { scope, projects } = await workspace();
    const low = newId();
    const high = newId();
    const priority = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Priority',
      type: 'select',
      options: [
        { id: low, label: 'Low', hue: 'gray' },
        { id: high, label: 'High', hue: 'red' },
      ],
    });
    const code = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Code', type: 'text' });
    await createRecord(scope, { objectId: projects, values: { [priority.id]: low, [code.id]: 'A1' } });
    await createRecord(scope, { objectId: projects, values: { [priority.id]: low, [code.id]: ' a1 ' } });
    await createRecord(scope, { objectId: projects, values: { [code.id]: 'B2' } });

    const options = await attributeImpact(scope, { attributeId: priority.id });
    expect(options.optionCounts).toEqual({ [low]: 2 });
    expect(options.emptyCount).toBe(1);
    expect(options).toMatchObject({ forms: [], rules: 0 });

    const shared = await attributeImpact(scope, { attributeId: code.id });
    expect(shared.duplicateCount).toBe(1);
    expect(shared.emptyCount).toBe(0);
  });

  it('refuses a member who can’t change the schema', async () => {
    const { scope, projects } = await workspace();
    const code = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Code', type: 'text' });
    const memberId = newId();
    await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${scope.workspaceId}, ${memberId}, 'Bea', ${`bea-${memberId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const member = rescope(scope, { actor: { type: 'member', id: memberId }, role: 'member' });
    try {
      await attributeImpact(member, { attributeId: code.id });
      throw new Error('It was let through.');
    } catch (error) {
      expect(isRefusal(error) ? error.refusal.code : error).toBe('FORBIDDEN');
    }
  });
});
