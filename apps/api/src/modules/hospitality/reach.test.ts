// A member's reach through the real app (spec 0065 H7, AC-6597): a member limited to business A asks every
// hospitality, menu, services, tables and business page procedure about business B, by its ids, and each answers as
// if B were not there (NOT_FOUND, the same sentence), a staff profile write is FORBIDDEN, and a list never names B.
// A walk of the contract fails when a procedure in those namespaces is neither walked here nor exempt with a reason.
import { contract } from '@crm/contracts';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app.ts';
import { createMailpitMailer } from '../../mail/mailpit.ts';
import { testEnv, testServices } from '../../testing.ts';
import { MAILPIT_URL, rpcClient, signIn, testConnections } from '../../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;

const NO_BUSINESS = { code: 'NOT_FOUND', message: 'That business doesn’t exist.' };
const NO_PLACE = { code: 'NOT_FOUND', message: 'That place doesn’t exist.' };
const NO_RESERVATION = { code: 'NOT_FOUND', message: 'That reservation doesn’t exist.' };
const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'Staff profiles work across every business. Ask an admin to change this one.',
};
const MANAGER = ['hospitality.manage', 'hospitality.service', 'services.manage', 'services.calendar'];
const PLACE = { country: 'GB', timeZone: 'Europe/London' } as const;
const SOUP = {
  name: 'Soup',
  priceMinor: 650,
  diet: [],
  allergens: [],
  kcal: null,
  featured: false,
  sizes: [],
  groupIds: [],
};
const SPAN = { start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T10:00:00.000Z' };
const MONDAY_HOURS = { weekly: { mon: [{ from: '09:00', to: '17:00' }] }, exceptions: [] };

/** The procedures of these namespaces this file doesn't walk, each with why a reach can't apply to it. */
const EXEMPT: Readonly<Record<string, string>> = {
  'hospitality.apps': 'the workspace’s apps, not a business’s; no business id to ask about',
  'hospitality.install': 'workspace.manage (installs an app for the whole workspace), which a custom role can’t hold',
  'hospitality.remove': 'workspace.manage (removes an app for the whole workspace), which a custom role can’t hold',
  'hospitality.createProperty': 'workspace.manage, which a custom role can’t hold',
  'hospitality.removeProperty': 'workspace.manage, which a custom role can’t hold',
  'hospitality.memberReach': 'workspace.manage, and only by someone who reaches every business',
  'hospitality.setMemberReach': 'workspace.manage, and only by someone who reaches every business',
};
const NAMESPACES = ['hospitality', 'menu', 'services', 'tables', 'businessPage'] as const;

/** Every procedure in a contract tree, by its dotted path. */
function procedures(tree: unknown, prefix: readonly string[]): string[] {
  if (typeof tree !== 'object' || tree === null) return [];
  if ('~orpc' in tree && prefix.length > 0) return [prefix.join('.')];
  return Object.entries(tree).flatMap(([key, value]) => procedures(value, [...prefix, key]));
}

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: testServices(env, {
      db,
      identity,
      mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
    }),
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Owner = Awaited<ReturnType<typeof memberWithWorkspace>>;
type Client = Owner['client'];

/** A Monday one to two weeks on, at 11:00 UTC (inside Monday's hours in London, past any notice). */
function nextMonday(): Date {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + 7 + ((8 - at.getUTCDay()) % 7));
  at.setUTCHours(11, 0, 0, 0);
  return at;
}

/**
 * The world: the owner's workspace with business A (place pA) and business B (place pB) holding one of everything
 * the procedures name, and Bea, a plain member with a custom role holding every business permission, limited to A.
 */
async function world() {
  const owner = await memberWithWorkspace(app);
  const ws = owner.slug;
  const w = { workspace: ws };
  const write = () => ({ ...w, mutationId: newId() });
  await owner.client.hospitality.install({
    ...write(),
    app: 'table_seating',
    business: { name: 'Somewhere', kind: 'restaurant', place: PLACE, currency: 'GBP' },
  });
  await owner.client.hospitality.install({ ...write(), app: 'menu_qr', withNeeded: true });
  const a = (await owner.client.hospitality.properties(w)).properties[0]?.id;
  const pA = (await owner.client.hospitality.business(w)).places[0]?.id;
  if (a === undefined || pA === undefined) throw new Error('No first business.');

  // Business B and its place, with tables, an area, Monday hours and a saved table setup.
  const b = newId();
  await owner.client.hospitality.createProperty({ ...write(), id: b, name: 'Bar', kind: 'bar', currency: 'GBP' });
  const pB = newId();
  await owner.client.hospitality.createPlace({ ...write(), property: b, id: pB, place: { name: 'Quay', ...PLACE } });
  await owner.client.hospitality.updatePlace({
    ...write(),
    placeId: pB,
    place: { name: 'Quay', ...PLACE },
    hours: MONDAY_HOURS,
  });
  const floor = await owner.client.hospitality.addResources({
    ...write(),
    placeId: pB,
    kind: 'table',
    labels: ['T1', 'T2'],
    minCapacity: 2,
    maxCapacity: 4,
  });
  const [t1, t2] = floor.resources.map((resource) => resource.id);
  if (t1 === undefined || t2 === undefined) throw new Error('No tables.');
  const area = (await owner.client.hospitality.saveArea({ ...write(), placeId: pB, name: 'Terrace' })).areas[0]?.id;
  if (area === undefined) throw new Error('No area.');
  const setup = await owner.client.tables.setup({ ...w, placeId: pB });
  await owner.client.tables.saveSetup({ ...write(), placeId: pB, rules: setup.rules });
  const monday = nextMonday();
  const reservation = (
    await owner.client.tables.book({ ...write(), placeId: pB, start: monday.toISOString(), party: 2, name: 'Ada' })
  ).id;

  // B's menu with a section, an item and a choice group; and a menu in A to copy across.
  const menu = newId();
  const section = newId();
  const item = newId();
  const group = newId();
  await owner.client.menu.saveMenu({ ...write(), property: b, id: menu, name: 'Dinner', placeIds: [pB] });
  await owner.client.menu.saveSection({ ...write(), property: b, id: section, menuId: menu, name: 'Mains' });
  await owner.client.menu.saveItem({ ...write(), property: b, id: item, sectionId: section, item: SOUP });
  await owner.client.menu.saveGroup({
    ...write(),
    property: b,
    id: group,
    name: 'Milk',
    rule: 'one',
    options: [{ name: 'Oat', priceDeltaMinor: 50 }],
  });
  const menuA = newId();
  await owner.client.menu.saveMenu({ ...write(), id: menuA, name: 'Lunch', placeIds: [pA] });

  // B's category and service at pB, A's service at pA, two staff working at pB with time off and a block there.
  const category = newId();
  await owner.client.services.saveCategory({ ...write(), property: b, id: category, name: 'Hair' });
  const serviceFields = (placeId: string) => ({
    name: 'Haircut',
    categoryId: null,
    bufferAfterMin: 0,
    online: true,
    staffRule: 'all' as const,
    staffIds: [],
    placeIds: [placeId],
    needs: [],
    variants: [{ name: 'Haircut', minutes: 30, priceMinor: 2500, priceType: 'fixed' as const, bufferBeforeMin: 0 }],
  });
  const service = newId();
  const catalogue = await owner.client.services.saveService({
    ...write(),
    property: b,
    id: service,
    service: serviceFields(pB),
  });
  const variant = catalogue.services.find((each) => each.id === service)?.variants[0]?.id;
  if (variant === undefined) throw new Error('No variant.');
  const serviceA = newId();
  await owner.client.services.saveService({ ...write(), id: serviceA, service: serviceFields(pA) });
  const staff = newId();
  const staff2 = newId();
  for (const [id, name] of [
    [staff, 'Asha'],
    [staff2, 'Ben'],
  ] as const) {
    await owner.client.services.saveStaff({
      ...write(),
      id,
      staff: { name, color: null, placeIds: [pB], serviceIds: [] },
    });
  }
  const timeOff = newId();
  await owner.client.services.addTimeOff({
    ...write(),
    id: timeOff,
    staffId: staff,
    placeId: pB,
    reason: 'holiday',
    ...SPAN,
  });
  const block = newId();
  await owner.client.services.addBlock({
    ...write(),
    id: block,
    staffId: staff,
    placeId: pB,
    reason: 'Lunch',
    ...SPAN,
  });

  // Bea: a plain member holding a custom role with every business permission, limited to A.
  const role = await owner.client.roles.create({
    ...write(),
    id: newId(),
    name: 'Floor manager',
    permissions: MANAGER,
    dataAccess: 'write',
    startFrom: 'member',
  });
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, `select id::text as id from auth."user" where email = $1`, [
    email,
  ]);
  if (user === undefined) throw new Error('No account was made.');
  const beaId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, custom_role_id, user_id, created_by_type, updated_by_type)
     values ($1, $2, 'Bea', $3, 'member', $4, $5, 'system', 'system')`,
    [owner.workspace.id, beaId, email, role.id, user.id],
  );
  await owner.client.hospitality.setMemberReach({
    ...write(),
    memberId: beaId,
    reach: { all: false, properties: [a], places: [] },
  });
  const bea = rpcClient(app, cookie);
  return {
    owner,
    bea,
    ws,
    a,
    pA,
    b,
    pB,
    t1,
    t2,
    area,
    reservation,
    monday,
    menu,
    section,
    item,
    group,
    menuA,
    category,
    service,
    variant,
    serviceA,
    staff,
    staff2,
    timeOff,
    block,
    beaId,
  };
}

let s: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  s = await world();
}, 120_000);

/** Bea's call answers exactly as for something that isn't there (or as `expected` says). */
async function refused(call: () => Promise<unknown>, expected: { code: string; message?: string }) {
  expect(await refusal(call)).toMatchObject(expected);
}

/** Every id of business B, by what it is: none may appear in an answer Bea reads. */
const idsOfB = () => ({
  business: s.b,
  place: s.pB,
  table: s.t1,
  'second table': s.t2,
  area: s.area,
  reservation: s.reservation,
  menu: s.menu,
  section: s.section,
  item: s.item,
  group: s.group,
  category: s.category,
  service: s.service,
  variant: s.variant,
  'staff at pB': s.staff,
  'second staff at pB': s.staff2,
  'time off at pB': s.timeOff,
  'block at pB': s.block,
});

/** An answer that names nothing of B (the failure lists what it named). */
function namesNothingOfB(answer: unknown) {
  const text = JSON.stringify(answer);
  const named = Object.entries(idsOfB()).filter(([, id]) => text.includes(id));
  expect(named.map(([what]) => what)).toEqual([]);
}

const mutation = () => ({ workspace: s.ws, mutationId: newId() });
const inB = () => ({ ...mutation(), property: s.b });

/**
 * A write keyed by B's ids, asked twice: naming B, it is B's refusal; leaving the business out (so working in A, the
 * first), B's ids are no one's there.
 */
async function inBOrA(
  run: (where: {
    readonly workspace: string;
    readonly mutationId: string;
    readonly property?: string;
  }) => Promise<unknown>,
) {
  await refused(() => run(inB()), NO_BUSINESS);
  await refused(() => run(mutation()), { code: 'NOT_FOUND' });
}

/** Each procedure, asked by Bea about business B: what it must answer. Keyed by the procedure's path. */
const WALK: Readonly<Record<string, (bea: Client) => Promise<void>>> = {
  // Businesses and places.
  'hospitality.business': async (bea) => {
    await refused(() => bea.hospitality.business({ workspace: s.ws, property: s.b }), NO_BUSINESS);
    namesNothingOfB(await bea.hospitality.business({ workspace: s.ws }));
  },
  'hospitality.properties': async (bea) => {
    const answer = await bea.hospitality.properties({ workspace: s.ws });
    expect(answer.properties.map((each) => each.id)).toEqual([s.a]);
    namesNothingOfB(answer);
  },
  'hospitality.saveBusiness': (bea) =>
    refused(() => bea.hospitality.saveBusiness({ ...inB(), profile: { name: 'Mine', kind: 'bar' } }), NO_BUSINESS),
  'hospitality.createPlace': (bea) =>
    refused(
      () => bea.hospitality.createPlace({ ...inB(), id: newId(), place: { name: 'Pier', ...PLACE } }),
      NO_BUSINESS,
    ),
  'hospitality.updatePlace': (bea) =>
    refused(() => bea.hospitality.updatePlace({ ...mutation(), placeId: s.pB, hours: MONDAY_HOURS }), NO_PLACE),
  'hospitality.resources': (bea) =>
    refused(() => bea.hospitality.resources({ workspace: s.ws, placeId: s.pB }), NO_PLACE),
  'hospitality.saveArea': (bea) =>
    refused(() => bea.hospitality.saveArea({ ...mutation(), placeId: s.pB, name: 'Garden' }), NO_PLACE),
  'hospitality.deleteArea': (bea) =>
    refused(() => bea.hospitality.deleteArea({ ...mutation(), placeId: s.pB, areaId: s.area }), NO_PLACE),
  'hospitality.addResources': (bea) =>
    refused(
      () =>
        bea.hospitality.addResources({
          ...mutation(),
          placeId: s.pB,
          kind: 'table',
          labels: ['T9'],
          minCapacity: 1,
          maxCapacity: 2,
        }),
      NO_PLACE,
    ),
  'hospitality.updateResource': (bea) =>
    refused(
      () => bea.hospitality.updateResource({ ...mutation(), placeId: s.pB, resourceId: s.t1, joins: [s.t2] }),
      NO_PLACE,
    ),
  'hospitality.moveResource': (bea) =>
    refused(
      () => bea.hospitality.moveResource({ ...mutation(), placeId: s.pB, resourceId: s.t2, toIndex: 0 }),
      NO_PLACE,
    ),
  'hospitality.archiveResource': (bea) =>
    refused(() => bea.hospitality.archiveResource({ ...mutation(), placeId: s.pB, resourceId: s.t1 }), NO_PLACE),
  'hospitality.restoreResource': (bea) =>
    refused(() => bea.hospitality.restoreResource({ ...mutation(), placeId: s.pB, resourceId: s.t1 }), NO_PLACE),
  'hospitality.deleteResource': (bea) =>
    refused(() => bea.hospitality.deleteResource({ ...mutation(), placeId: s.pB, resourceId: s.t1 }), NO_PLACE),
  'hospitality.qrCodes': (bea) => refused(() => bea.hospitality.qrCodes({ workspace: s.ws, placeId: s.pB }), NO_PLACE),
  'hospitality.regenerateTableCode': (bea) =>
    refused(() => bea.hospitality.regenerateTableCode({ ...mutation(), placeId: s.pB, resourceId: s.t1 }), NO_PLACE),

  // Menus: every call names B; a copy goes neither from B nor into it.
  'menu.draft': async (bea) => {
    await refused(() => bea.menu.draft({ workspace: s.ws, property: s.b }), NO_BUSINESS);
    namesNothingOfB(await bea.menu.draft({ workspace: s.ws }));
  },
  'menu.saveMenu': (bea) =>
    inBOrA((where) => bea.menu.saveMenu({ ...where, id: newId(), name: 'Brunch', placeIds: [s.pB] })),
  'menu.deleteMenu': (bea) => inBOrA((where) => bea.menu.deleteMenu({ ...where, menuId: s.menu })),
  'menu.saveSection': (bea) =>
    inBOrA((where) => bea.menu.saveSection({ ...where, id: newId(), menuId: s.menu, name: 'Sides' })),
  'menu.deleteSection': (bea) => inBOrA((where) => bea.menu.deleteSection({ ...where, sectionId: s.section })),
  'menu.saveItem': (bea) =>
    inBOrA((where) => bea.menu.saveItem({ ...where, id: s.item, sectionId: s.section, item: SOUP })),
  'menu.deleteItem': (bea) => inBOrA((where) => bea.menu.deleteItem({ ...where, itemId: s.item })),
  'menu.removePhoto': (bea) => inBOrA((where) => bea.menu.removePhoto({ ...where, itemId: s.item })),
  'menu.placeItem': (bea) =>
    inBOrA((where) => bea.menu.placeItem({ ...where, itemId: s.item, sectionId: s.section, placed: false })),
  'menu.move': (bea) => inBOrA((where) => bea.menu.move({ ...where, part: 'section', id: s.section, toIndex: 0 })),
  'menu.saveGroup': (bea) =>
    inBOrA((where) =>
      bea.menu.saveGroup({
        ...where,
        id: s.group,
        name: 'Milk',
        rule: 'one',
        options: [{ name: 'Soy', priceDeltaMinor: 0 }],
      }),
    ),
  'menu.deleteGroup': (bea) => inBOrA((where) => bea.menu.deleteGroup({ ...where, groupId: s.group })),
  'menu.setSoldOut': (bea) => inBOrA((where) => bea.menu.setSoldOut({ ...where, itemId: s.item, soldOut: true })),
  'menu.setHidden': (bea) => refused(() => bea.menu.setHidden({ ...inB(), hidden: true }), NO_BUSINESS),
  'menu.saveLook': (bea) =>
    refused(
      () =>
        bea.menu.saveLook({
          ...inB(),
          look: { preset: 'noir', heading: 'grotesk', body: 'grotesk', radius: 'square' },
        }),
      NO_BUSINESS,
    ),
  'menu.publish': (bea) => refused(() => bea.menu.publish(inB()), NO_BUSINESS),
  'menu.discard': (bea) => refused(() => bea.menu.discard(inB()), NO_BUSINESS),
  'menu.duplicate': async (bea) => {
    await refused(() => bea.menu.duplicate({ ...inB(), menuId: s.menu, to: s.a, id: newId() }), NO_BUSINESS);
    await refused(() => bea.menu.duplicate({ ...mutation(), menuId: s.menuA, to: s.b, id: newId() }), NO_BUSINESS);
  },

  // Services: the catalogue is a business's; staff profiles are the whole workspace's.
  'services.catalogue': async (bea) => {
    await refused(() => bea.services.catalogue({ workspace: s.ws, property: s.b }), NO_BUSINESS);
    namesNothingOfB(await bea.services.catalogue({ workspace: s.ws }));
  },
  'services.saveCategory': (bea) =>
    inBOrA((where) => bea.services.saveCategory({ ...where, id: s.category, name: 'Nails' })),
  'services.deleteCategory': (bea) =>
    inBOrA((where) => bea.services.deleteCategory({ ...where, categoryId: s.category })),
  'services.moveCategory': (bea) =>
    inBOrA((where) => bea.services.moveCategory({ ...where, categoryId: s.category, toIndex: 0 })),
  'services.saveService': (bea) =>
    inBOrA((where) =>
      bea.services.saveService({
        ...where,
        id: s.service,
        service: {
          name: 'Colour',
          categoryId: null,
          bufferAfterMin: 0,
          online: true,
          staffRule: 'all',
          staffIds: [],
          placeIds: [s.pB],
          needs: [],
          variants: [{ name: 'Colour', minutes: 60, priceMinor: 5000, priceType: 'fixed', bufferBeforeMin: 0 }],
        },
      }),
    ),
  'services.moveService': (bea) =>
    inBOrA((where) => bea.services.moveService({ ...where, serviceId: s.service, categoryId: null, toIndex: 0 })),
  'services.setOnline': (bea) =>
    inBOrA((where) => bea.services.setOnline({ ...where, serviceIds: [s.service], online: false })),
  'services.setCategory': (bea) =>
    inBOrA((where) => bea.services.setCategory({ ...where, serviceIds: [s.service], categoryId: null })),
  'services.archive': (bea) => inBOrA((where) => bea.services.archive({ ...where, serviceIds: [s.service] })),
  'services.restore': (bea) => inBOrA((where) => bea.services.restore({ ...where, serviceIds: [s.service] })),
  'services.duplicate': async (bea) => {
    await refused(() => bea.services.duplicate({ ...inB(), serviceId: s.service, to: s.a, id: newId() }), NO_BUSINESS);
    await refused(
      () => bea.services.duplicate({ ...mutation(), serviceId: s.serviceA, to: s.b, id: newId() }),
      NO_BUSINESS,
    );
  },
  'services.team': async (bea) => namesNothingOfB(await bea.services.team({ workspace: s.ws })),
  'services.shifts': async (bea) => namesNothingOfB(await bea.services.shifts({ workspace: s.ws })),
  'services.saveStaff': (bea) =>
    refused(
      () =>
        bea.services.saveStaff({
          ...mutation(),
          id: s.staff,
          staff: { name: 'Asha', color: null, placeIds: [s.pA], serviceIds: [] },
        }),
      FORBIDDEN,
    ),
  'services.moveStaff': (bea) =>
    refused(() => bea.services.moveStaff({ ...mutation(), staffId: s.staff, toIndex: 0 }), FORBIDDEN),
  'services.linkStaff': (bea) =>
    refused(() => bea.services.linkStaff({ ...mutation(), staffId: s.staff, memberId: s.beaId }), FORBIDDEN),
  'services.archiveStaff': (bea) =>
    refused(() => bea.services.archiveStaff({ ...mutation(), staffId: s.staff }), FORBIDDEN),
  'services.restoreStaff': (bea) =>
    refused(() => bea.services.restoreStaff({ ...mutation(), staffId: s.staff }), FORBIDDEN),
  'services.removeStaffPhoto': (bea) =>
    refused(() => bea.services.removeStaffPhoto({ ...mutation(), staffId: s.staff }), FORBIDDEN),
  'services.setShifts': (bea) =>
    refused(
      () =>
        bea.services.setShifts({
          ...mutation(),
          staffId: s.staff,
          placeId: s.pB,
          shifts: MONDAY_HOURS,
          outsideHours: false,
        }),
      NO_PLACE,
    ),
  'services.copyShifts': (bea) =>
    refused(
      () => bea.services.copyShifts({ ...mutation(), staffId: s.staff, placeId: s.pB, toStaffIds: [s.staff2] }),
      NO_PLACE,
    ),
  'services.addTimeOff': (bea) =>
    refused(
      () =>
        bea.services.addTimeOff({
          ...mutation(),
          id: newId(),
          staffId: s.staff,
          placeId: s.pB,
          reason: 'sick',
          ...SPAN,
        }),
      NO_PLACE,
    ),
  'services.removeTimeOff': (bea) =>
    refused(() => bea.services.removeTimeOff({ ...mutation(), id: s.timeOff }), {
      code: 'NOT_FOUND',
      message: 'That time off doesn’t exist.',
    }),
  'services.addBlock': (bea) =>
    refused(
      () => bea.services.addBlock({ ...mutation(), id: newId(), staffId: s.staff, placeId: s.pB, ...SPAN }),
      NO_PLACE,
    ),
  'services.removeBlock': (bea) =>
    refused(() => bea.services.removeBlock({ ...mutation(), id: s.block }), {
      code: 'NOT_FOUND',
      message: 'That block doesn’t exist.',
    }),
  'services.times': (bea) =>
    refused(
      () =>
        bea.services.times({
          workspace: s.ws,
          placeId: s.pB,
          serviceId: s.service,
          variantId: s.variant,
          date: s.monday.toISOString().slice(0, 10),
        }),
      NO_PLACE,
    ),

  // Table seating: every place B holds, and a reservation there by its id.
  'tables.setup': (bea) => refused(() => bea.tables.setup({ workspace: s.ws, placeId: s.pB }), NO_PLACE),
  'tables.saveSetup': async (bea) => {
    const { rules } = await s.owner.client.tables.setup({ workspace: s.ws, placeId: s.pB });
    await refused(() => bea.tables.saveSetup({ ...mutation(), placeId: s.pB, rules }), NO_PLACE);
  },
  'tables.places': async (bea) => {
    await refused(() => bea.tables.places({ workspace: s.ws, property: s.b }), NO_BUSINESS);
    const answer = await bea.tables.places({ workspace: s.ws });
    expect(answer.places.map((place) => place.id)).toEqual([s.pA]);
    namesNothingOfB(answer);
  },
  'tables.floor': (bea) => refused(() => bea.tables.floor({ workspace: s.ws, placeId: s.pB }), NO_PLACE),
  'tables.day': (bea) =>
    refused(
      () => bea.tables.day({ workspace: s.ws, placeId: s.pB, date: s.monday.toISOString().slice(0, 10) }),
      NO_PLACE,
    ),
  'tables.setStatus': (bea) =>
    refused(
      () => bea.tables.setStatus({ ...mutation(), appointmentId: s.reservation, status: 'arrived' }),
      NO_RESERVATION,
    ),
  'tables.setNotify': (bea) =>
    refused(() => bea.tables.setNotify({ ...mutation(), placeId: s.pB, on: false }), NO_PLACE),
  'tables.freeTables': (bea) =>
    refused(() => bea.tables.freeTables({ workspace: s.ws, placeId: s.pB, party: 2 }), NO_PLACE),
  'tables.walkIn': (bea) =>
    refused(() => bea.tables.walkIn({ ...mutation(), placeId: s.pB, party: 2, resourceIds: [s.t1] }), NO_PLACE),
  'tables.book': (bea) =>
    refused(
      () =>
        bea.tables.book({
          ...mutation(),
          placeId: s.pB,
          start: new Date(s.monday.getTime() + 2 * 3_600_000).toISOString(),
          party: 2,
          name: 'Grace',
        }),
      NO_PLACE,
    ),

  // The business page: B's, and a place of B's from A's page.
  'businessPage.page': async (bea) => {
    await refused(() => bea.businessPage.page({ workspace: s.ws, property: s.b }), NO_BUSINESS);
    namesNothingOfB(await bea.businessPage.page({ workspace: s.ws }));
  },
  'businessPage.claimHandle': (bea) =>
    refused(() => bea.businessPage.claimHandle({ ...inB(), handle: `bar-${newId().slice(-10)}` }), NO_BUSINESS),
  'businessPage.save': (bea) =>
    refused(
      () => bea.businessPage.save({ ...inB(), draft: { gallery: [], amenities: ['wifi'], hiddenPlaces: [] } }),
      NO_BUSINESS,
    ),
  'businessPage.setPlaceSlug': async (bea) => {
    await refused(() => bea.businessPage.setPlaceSlug({ ...inB(), placeId: s.pB, slug: 'quay' }), NO_BUSINESS);
    await refused(() => bea.businessPage.setPlaceSlug({ ...mutation(), placeId: s.pB, slug: 'quay' }), NO_PLACE);
  },
  'businessPage.publish': (bea) => refused(() => bea.businessPage.publish(inB()), NO_BUSINESS),
  'businessPage.discard': (bea) => refused(() => bea.businessPage.discard(inB()), NO_BUSINESS),
};

describe('a member limited to one business asks about another (AC-6597)', () => {
  it('walks or exempts every procedure of the business namespaces', () => {
    const declared = NAMESPACES.flatMap((name) => procedures(contract[name], [name]));
    expect(declared.length).toBeGreaterThan(0);
    const unwalked = declared.filter((path) => !(path in WALK) && !(path in EXEMPT));
    expect(unwalked, 'Walk each of these as Bea asking about business B, or exempt it with a reason').toEqual([]);
    const stale = [...Object.keys(WALK), ...Object.keys(EXEMPT)].filter((path) => !declared.includes(path));
    expect(stale, 'No longer in the contract').toEqual([]);
    expect(Object.keys(WALK).filter((path) => path in EXEMPT)).toEqual([]);
  });

  it('reads business A with only its own place', async () => {
    const business = await s.bea.hospitality.business({ workspace: s.ws });
    expect(business.places.map((place) => place.id)).toEqual([s.pA]);
  });

  for (const [path, run] of Object.entries(WALK)) {
    it(`${path} answers as if business B were not there`, () => run(s.bea));
  }

  it('applies a reach widened to every business on Bea’s next call', async () => {
    await s.owner.client.hospitality.setMemberReach({
      workspace: s.ws,
      memberId: s.beaId,
      reach: { all: true, properties: [], places: [] },
      mutationId: newId(),
    });
    const business = await s.bea.hospitality.business({ workspace: s.ws, property: s.b });
    expect(business.places.map((place) => place.id)).toEqual([s.pB]);
    const floor = await s.bea.hospitality.resources({ workspace: s.ws, placeId: s.pB });
    expect(floor.resources.map((resource) => resource.id)).toContain(s.t1);
  });
});
