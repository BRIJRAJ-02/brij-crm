// Fixtures for the visit engine's suites (spec 0066, B0), against the real Postgres as the app role: a workspace with
// early access and an engine app installed, its first place with hours, and services, staff and resources written
// straight into the tables (B1's screens make them later). Tests only: it lives outside src, beside the other kits.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PlaceHoursShape } from '@crm/contracts';
import type { Database } from '@crm/db';
import { mintScope, type EngineScope } from '../src/access/mint.ts';
import { NO_RULES, roleAccess } from '../src/access/policy.ts';
import { newId } from '../src/engine/ids.ts';
import { createWorkspace } from '../src/engine/workspaces.ts';
import { installApp } from '../src/hospitality/apps.ts';
import { setEarlyAccess } from '../src/operator/early-access.ts';
import { testScope } from '../src/testing.ts';

let made = 0;

/** Every day of the week open `from` to `to`. */
export function allWeek(from: string, to: string): PlaceHoursShape {
  const range = [{ from, to }];
  return {
    weekly: { mon: range, tue: range, wed: range, thu: range, fri: range, sat: range, sun: range },
    exceptions: [],
  };
}

/** A workspace with Table seating (or Appointments) installed, its owner's scope and first place in London. */
export async function visitWorkspace(db: Database, app: 'table_seating' | 'appointments' = 'table_seating') {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `visits-${String(made)}-${String(Date.now())}-${randomBytes(3).toString('hex')}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  await setEarlyAccess({ db }, { workspaceId: created.workspaceId, flag: 'business_apps', on: true });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  await installApp(owner, {
    app,
    business: {
      name: 'Somewhere Nowhere',
      kind: app === 'table_seating' ? 'restaurant' : 'salon',
      place: { country: 'GB', timeZone: 'Europe/London', city: 'London', addressLine: '1 Example Street' },
      currency: 'GBP',
    },
  });
  const placeId = (
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text as id from places order by position limit 1`),
    )
  ).rows[0]?.id;
  if (placeId === undefined) throw new Error('The first install made no place.');
  const sqlIn = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(query));
  await sqlIn(
    sql`update places set hours = ${JSON.stringify(allWeek('18:00', '23:00'))}::jsonb where id = ${placeId}::uuid`,
  );
  return { ...created, owner, placeId, sql: sqlIn };
}

/** The workspace a fixture writes into. */
export type VisitWorkspace = Awaited<ReturnType<typeof visitWorkspace>>;

/** A service with one variant, offered at the place; answers both ids. */
export async function addService(
  w: VisitWorkspace,
  options: {
    readonly name?: string;
    readonly minutes?: number;
    readonly priceMinor?: number;
    readonly capacityMode?: 'one' | 'party';
    readonly staffRule?: 'all' | 'chosen' | 'none';
    readonly holdBySize?: readonly { readonly size: number; readonly minutes: number }[];
    readonly bufferAfter?: number;
    readonly needs?: readonly ({ readonly kind: string; readonly count?: number } | { readonly resourceId: string })[];
    readonly step?: number;
    readonly coversCap?: number;
    readonly chosenStaff?: readonly string[];
  } = {},
): Promise<{ readonly serviceId: string; readonly variantId: string }> {
  const serviceId = newId();
  const variantId = newId();
  const name = options.name ?? 'Table';
  await w.sql(sql`
    insert into services (workspace_id, id, name, slug, capacity_mode, staff_rule, hold_by_size, buffer_after_min, step_min, covers_cap, position)
    values (${w.workspaceId}::uuid, ${serviceId}::uuid, ${name}, ${`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${serviceId.slice(-6)}`},
      ${options.capacityMode ?? 'party'}, ${options.staffRule ?? 'none'}, ${JSON.stringify(options.holdBySize ?? [])}::jsonb,
      ${options.bufferAfter ?? 0}, ${options.step ?? 30}, ${options.coversCap ?? null}, 0)
  `);
  await w.sql(sql`
    insert into service_variants (workspace_id, id, service_id, name, minutes, price_minor, position)
    values (${w.workspaceId}::uuid, ${variantId}::uuid, ${serviceId}::uuid, 'Standard', ${options.minutes ?? 90}, ${options.priceMinor ?? 0}, 0)
  `);
  await w.sql(
    sql`insert into service_places (workspace_id, service_id, place_id) values (${w.workspaceId}::uuid, ${serviceId}::uuid, ${w.placeId}::uuid)`,
  );
  for (const need of options.needs ?? [{ kind: 'table' }]) {
    if ('resourceId' in need) {
      await w.sql(
        sql`insert into service_resources (workspace_id, service_id, resource_id) values (${w.workspaceId}::uuid, ${serviceId}::uuid, ${need.resourceId}::uuid)`,
      );
    } else {
      await w.sql(
        sql`insert into service_resources (workspace_id, service_id, kind, count) values (${w.workspaceId}::uuid, ${serviceId}::uuid, ${need.kind}, ${need.count ?? 1})`,
      );
    }
  }
  for (const staffId of options.chosenStaff ?? []) {
    await w.sql(
      sql`insert into service_staff (workspace_id, service_id, staff_id) values (${w.workspaceId}::uuid, ${serviceId}::uuid, ${staffId}::uuid)`,
    );
  }
  return { serviceId, variantId };
}

/** A resource at the place; answers its id. */
export async function addResource(
  w: VisitWorkspace,
  label: string,
  options: {
    readonly kind?: string;
    readonly min?: number;
    readonly max?: number;
    readonly joins?: readonly string[];
    readonly position?: number;
  } = {},
): Promise<string> {
  const id = newId();
  await w.sql(sql`
    insert into resources (workspace_id, id, place_id, kind, label, min_capacity, max_capacity, position, joins)
    values (${w.workspaceId}::uuid, ${id}::uuid, ${w.placeId}::uuid, ${options.kind ?? 'table'}, ${label}, ${options.min ?? 1},
      ${options.max ?? 4}, ${options.position ?? 0}, ${`{${(options.joins ?? []).join(',')}}`}::uuid[])
  `);
  return id;
}

/** A staff member working at the place, `shifts` (all week 09:00 to 18:00 by default); answers their id. */
export async function addStaff(
  w: VisitWorkspace,
  name: string,
  options: { readonly memberId?: string; readonly position?: number; readonly shifts?: PlaceHoursShape } = {},
): Promise<string> {
  const id = newId();
  await w.sql(sql`
    insert into staff (workspace_id, id, name, member_id, position)
    values (${w.workspaceId}::uuid, ${id}::uuid, ${name}, ${options.memberId ?? null}, ${options.position ?? 0})
  `);
  await w.sql(sql`
    insert into staff_places (workspace_id, staff_id, place_id, shifts)
    values (${w.workspaceId}::uuid, ${id}::uuid, ${w.placeId}::uuid, ${JSON.stringify(options.shifts ?? allWeek('09:00', '18:00'))}::jsonb)
  `);
  return id;
}

/** A plain member of the workspace (no role permissions beyond Member's); answers their id. */
export async function addMember(w: VisitWorkspace, name: string): Promise<string> {
  const id = newId();
  await w.sql(sql`
    insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
    values (${w.workspaceId}::uuid, ${id}::uuid, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@example.com`}, 'member', 'system', 'system')
  `);
  return id;
}

/**
 * A waiter: a member holding the seeded "Floor staff" custom role's one permission, Run service
 * (`hospitality.service`), and no calendar or setup permission.
 */
export async function waiterScope(db: Database, w: VisitWorkspace): Promise<EngineScope> {
  const memberId = await addMember(w, 'Wes');
  return mintScope({
    db,
    workspaceId: w.workspaceId,
    actor: { type: 'member', id: memberId },
    access: roleAccess({ kind: 'member', memberId, role: 'member', customRoleId: newId(), teamIds: [] }, NO_RULES, {
      permissions: ['hospitality.service'],
      defaultObjectLevel: 'read',
    }),
  });
}
