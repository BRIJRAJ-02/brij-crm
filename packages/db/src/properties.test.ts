// Properties in the database (spec 0065 H7, migration 0197): every workspace has one first property, row level
// security holds on the table and on the old name's view, and a menu or a service can never reach another property's
// place, whatever the code does.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-properties-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A workspace, made as the app makes them. */
async function workspace(name: string): Promise<string> {
  const workspaceId = randomUUID();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type)
        values (${workspaceId}, ${name}, ${`${name}-${workspaceId}`}, 'system', 'system')`,
    ),
  );
  return workspaceId;
}

/** A 16 character public key nothing else holds. */
const key = (): string => randomUUID().replaceAll('-', '').slice(0, 16);

/** A second property, which only tests can make until slice 2. */
async function secondProperty(workspaceId: string): Promise<string> {
  const id = randomUUID();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`insert into properties (workspace_id, id, name, kind, position)
      values (${workspaceId}, ${id}, 'Second', 'bar', 1)`),
  );
  return id;
}

async function place(workspaceId: string, propertyId: string): Promise<string> {
  const id = randomUUID();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`insert into places (workspace_id, id, property_id, name, country, time_zone, locale, public_key, menu_key, position)
      values (${workspaceId}, ${id}, ${propertyId}, 'Main', 'GB', 'Europe/London', 'en-GB', ${key()}, ${key()}, 0)`),
  );
  return id;
}

async function firstId(workspaceId: string): Promise<string> {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string }>(sql`select id::text from properties where position = 0`),
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error('No first property.');
  return id;
}

describe('properties (spec 0065 H7)', () => {
  it('gives a new workspace exactly one first property, with no name until someone sets it up', async () => {
    const id = await workspace('first');
    const found = await db.withWorkspace(id, (tx) =>
      tx.execute<{ name: string | null; kind: string | null; position: number }>(
        sql`select name, kind, position from properties`,
      ),
    );
    expect(found.rows).toEqual([{ name: null, kind: null, position: 0 }]);
  });

  it('copies a new workspace’s currency and country to its first property', async () => {
    const id = randomUUID();
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into workspaces (id, name, slug, currency, country, created_by_type, updated_by_type)
        values (${id}, 'Copy', ${`copy-${id}`}, 'GBP', 'GB', 'system', 'system')`),
    );
    const found = await db.withWorkspace(id, (tx) =>
      tx.execute<{ currency: string; country: string }>(sql`select currency, country from properties`),
    );
    expect(found.rows).toEqual([{ currency: 'GBP', country: 'GB' }]);
  });

  it('refuses a second property at position 0, and one with a name but no kind', async () => {
    const id = await workspace('second-first');
    await expect(
      db.withWorkspace(id, (tx) =>
        tx.execute(sql`insert into properties (workspace_id, name, kind, position) values (${id}, 'Two', 'bar', 0)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'properties_first' } });
    await expect(
      db.withWorkspace(id, (tx) => tx.execute(sql`update properties set name = 'Half'`)),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'properties_set_up' } });
  });

  it('reads and writes only its own workspace’s properties, through the table and through the old name', async () => {
    const a = await workspace('iso-a');
    const b = await workspace('iso-b');
    for (const id of [a, b]) {
      await db.withWorkspace(id, (tx) => tx.execute(sql`update properties set name = 'Named', kind = 'bar'`));
    }
    for (const name of ['properties', 'business_profiles']) {
      const seen = await db.withWorkspace(a, (tx) =>
        tx.execute<{ workspace_id: string }>(sql`select workspace_id::text from ${sql.identifier(name)}`),
      );
      expect(seen.rows.map((row) => row.workspace_id)).toEqual([a]);
      const none = await db.withWorkspace(a, (tx) =>
        tx.execute(sql`select 1 from ${sql.identifier(name)} where workspace_id = ${b}::uuid`),
      );
      expect(none.rows).toEqual([]);
    }
    const changed = await db.withWorkspace(a, (tx) =>
      tx.execute(sql`update properties set name = 'Stolen' where workspace_id = ${b}::uuid`),
    );
    expect(changed.rowCount).toBe(0);
  });

  it('keeps the old name reading as the old table did, for the old code during a deploy', async () => {
    const id = await workspace('old-name');
    const hidden = await db.withWorkspace(id, (tx) => tx.execute(sql`select 1 from business_profiles`));
    expect(hidden.rows).toEqual([]);
    await db.withWorkspace(id, (tx) => tx.execute(sql`update properties set name = 'Named', kind = 'bar'`));
    await db.withWorkspace(id, (tx) => tx.execute(sql`update business_profiles set look = '{"preset":"warm"}'::jsonb`));
    const found = await db.withWorkspace(id, (tx) =>
      tx.execute<{ name: string; look: unknown }>(sql`select name, look from business_profiles`),
    );
    expect(found.rows).toEqual([{ name: 'Named', look: { preset: 'warm' } }]);
    await expect(db.withWorkspace(id, (tx) => tx.execute(sql`delete from business_profiles`))).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('lands an insert that names no property on the first one, for the old code during a deploy', async () => {
    const id = await workspace('default');
    const first = await firstId(id);
    const menu = randomUUID();
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menus (workspace_id, id, name, position) values (${id}, ${menu}, 'Dinner', 0)`),
    );
    const found = await db.withWorkspace(id, (tx) =>
      tx.execute<{ property_id: string }>(sql`select property_id::text from menus`),
    );
    expect(found.rows).toEqual([{ property_id: first }]);
  });

  it('refuses a menu or a service linked to a place in another property (AC-6514)', async () => {
    const id = await workspace('cross');
    const first = await firstId(id);
    const second = await secondProperty(id);
    const here = await place(id, first);
    const there = await place(id, second);
    const menu = randomUUID();
    const service = randomUUID();
    await db.withWorkspace(id, async (tx) => {
      await tx.execute(sql`insert into menus (workspace_id, id, property_id, name, position)
        values (${id}, ${menu}, ${first}, 'Dinner', 0)`);
      await tx.execute(sql`insert into services (workspace_id, id, property_id, name, slug, capacity_mode, staff_rule, position)
        values (${id}, ${service}, ${first}, 'Cut', 'cut', 'one', 'all', 0)`);
    });
    // Its own property's place is fine.
    await db.withWorkspace(id, async (tx) => {
      await tx.execute(sql`insert into menu_places (workspace_id, menu_id, place_id, property_id)
        values (${id}, ${menu}, ${here}, ${first})`);
      await tx.execute(sql`insert into service_places (workspace_id, service_id, place_id, property_id)
        values (${id}, ${service}, ${here}, ${first})`);
    });
    // Neither value for the one property_id can name both sides, and leaving it out is the first property's.
    for (const propertyId of [first, second]) {
      await expect(
        db.withWorkspace(id, (tx) =>
          tx.execute(sql`insert into menu_places (workspace_id, menu_id, place_id, property_id)
            values (${id}, ${menu}, ${there}, ${propertyId})`),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
      await expect(
        db.withWorkspace(id, (tx) =>
          tx.execute(sql`insert into service_places (workspace_id, service_id, place_id, property_id)
            values (${id}, ${service}, ${there}, ${propertyId})`),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    }
    await expect(
      db.withWorkspace(id, (tx) =>
        tx.execute(sql`insert into menu_places (workspace_id, menu_id, place_id) values (${id}, ${menu}, ${there})`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    // Moving a linked place or menu out from under the link is refused too.
    await expect(
      db.withWorkspace(id, (tx) => tx.execute(sql`update places set property_id = ${second} where id = ${here}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(
      db.withWorkspace(id, (tx) => tx.execute(sql`update menus set property_id = ${second} where id = ${menu}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('refuses a service in another property’s category, and a place page on the wrong property', async () => {
    const id = await workspace('category');
    const first = await firstId(id);
    const second = await secondProperty(id);
    const category = randomUUID();
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into service_categories (workspace_id, id, property_id, name, position)
        values (${id}, ${category}, ${second}, 'Hair', 0)`),
    );
    await expect(
      db.withWorkspace(id, (tx) =>
        tx.execute(sql`insert into services (workspace_id, id, property_id, category_id, name, slug, capacity_mode, staff_rule, position)
          values (${id}, ${randomUUID()}, ${first}, ${category}, 'Cut', 'cut-2', 'one', 'all', 0)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    const here = await place(id, first);
    await expect(
      db.withWorkspace(id, async (tx) => {
        await tx.execute(sql`insert into place_slugs (workspace_id, slug, place_id) values (${id}, 'main', ${here})`);
        await tx.execute(sql`insert into place_pages (workspace_id, place_id, property_id, slug)
          values (${id}, ${here}, ${second}, 'main')`);
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('refuses another workspace’s property', async () => {
    const a = await workspace('foreign-a');
    const b = await workspace('foreign-b');
    const theirs = await firstId(b);
    await expect(place(a, theirs)).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('keeps a property with places, and lets a whole workspace go', async () => {
    const id = await workspace('delete');
    const first = await firstId(id);
    await place(id, first);
    const menu = randomUUID();
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menus (workspace_id, id, property_id, name, position)
        values (${id}, ${menu}, ${first}, 'Dinner', 0)`),
    );
    await expect(
      db.withWorkspace(id, (tx) => tx.execute(sql`delete from properties where id = ${first}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await owner.query('delete from workspaces where id = $1', [id]);
    const left = await owner.query('select 1 from properties where workspace_id = $1', [id]);
    expect(left.rows).toEqual([]);
  });

  it('gives every first property key its own row in the migration’s rule: one per workspace', async () => {
    const orphans = await owner.query(`
      select w.id from workspaces w
      where (select count(*) from properties p where p.workspace_id = w.id and p.position = 0) <> 1
    `);
    expect(orphans.rows).toEqual([]);
  });

  it('keeps each business’s dishes, photos and draft its own (migration 0198)', async () => {
    const id = await workspace('menu-library');
    const first = await firstId(id);
    const second = await secondProperty(id);
    const photo = randomUUID();
    const item = randomUUID();
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menu_photos (workspace_id, id, property_id, large_path, small_path, type, version)
        values (${id}, ${photo}, ${second}, 'a', 'b', 'image/webp', '0123456789ab')`),
    );
    // A dish shows only its own business's photo.
    await expect(
      db.withWorkspace(id, (tx) =>
        tx.execute(sql`insert into menu_items (workspace_id, id, property_id, name, photo_id)
          values (${id}, ${item}, ${first}, 'Soup', ${photo})`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menu_items (workspace_id, id, property_id, name, photo_id)
        values (${id}, ${item}, ${second}, 'Soup', ${photo})`),
    );
    // The photo going leaves the dish, with no photo and on its own business.
    await db.withWorkspace(id, (tx) => tx.execute(sql`delete from menu_photos where id = ${photo}`));
    const dish = await db.withWorkspace(id, (tx) =>
      tx.execute<{ photo_id: string | null; property_id: string }>(
        sql`select photo_id, property_id::text from menu_items where id = ${item}`,
      ),
    );
    expect(dish.rows).toEqual([{ photo_id: null, property_id: second }]);
    // One draft state per business; an insert that names none lands on the first, as the old code's would.
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menu_drafts (workspace_id, property_id, changes) values (${id}, ${second}, 2)`),
    );
    await db.withWorkspace(id, (tx) =>
      tx.execute(sql`insert into menu_drafts (workspace_id, changes) values (${id}, 1)`),
    );
    const drafts = await db.withWorkspace(id, (tx) =>
      tx.execute<{ property_id: string; changes: number }>(
        sql`select property_id::text, changes from menu_drafts order by changes`,
      ),
    );
    expect(drafts.rows).toEqual([
      { property_id: first, changes: 1 },
      { property_id: second, changes: 2 },
    ]);
    // A business with a dish can't go.
    await expect(
      db.withWorkspace(id, (tx) => tx.execute(sql`delete from properties where id = ${second}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
