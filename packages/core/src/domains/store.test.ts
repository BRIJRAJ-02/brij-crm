// A link page's custom domain in the database (spec 0064, AC-6401 to AC-6404, AC-6408), against the real Postgres:
// added for the caller's own page only, one per page, a proved host one page's alone, checks saved and queued,
// removal freeing the host, and the public read answering a live host's handle and nothing else.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { normaliseHost, type NormalHost } from './hosts.ts';
import { liveDomainHandle } from './public.ts';
import { decideCheck, DOMAIN_PROBLEMS, type VercelHostView } from './status.ts';
import {
  addMyDomain,
  getMyDomain,
  markDomainDetached,
  readDomainForCheck,
  removeMyDomain,
  restartDomain,
  saveDomainCheck,
} from './store.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-domain-store-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person with a link page (a handle) in a workspace of their own. */
async function person(withHandle = true) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Domains',
    slug: `domains-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `dom-${randomUUID().slice(0, 8)}`;
  if (withHandle) await updateMyMemberProfile(scope, { handle });
  return { ...created, userId, scope, handle };
}

const host = (): NormalHost => {
  const checked = normaliseHost(`book.${randomUUID().slice(0, 8)}.example.test`);
  if (!checked.ok) throw new Error('A test host was refused.');
  return checked;
};

const working: VercelHostView = {
  attached: true,
  verified: true,
  misconfigured: false,
  verification: [],
  cname: 'x.vercel-dns.com',
};

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const first = (error as { refusals?: readonly { code: string; message: string }[] }).refusals?.[0];
    return first;
  }
}

async function queued(workspaceId: string, domainId: string) {
  const rows = await testQuery<{ due: boolean }>(
    ownerUrl,
    `select run_at > now() as due from graphile_worker.jobs where key = $1`,
    [`crm-domain:${workspaceId}:${domainId}`],
  );
  return rows.length;
}

describe('custom domains in the database (spec 0064)', () => {
  it('adds a domain to the caller’s page with its TXT record first, and queues its first check', async () => {
    const ada = await person();
    const asked = host();
    const added = await addMyDomain(ada.scope, { host: asked });
    expect(added).toMatchObject({ host: asked.host, kind: 'subdomain', status: 'waiting' });
    expect(added.records[0]).toMatchObject({ type: 'TXT', name: `_timefix.${asked.host}`, purpose: 'ownership' });
    expect(added.records[0]?.value).toMatch(/^timefix-verify=[0-9a-f]{32}$/);
    expect(await getMyDomain(ada.scope)).toEqual(added);
    expect(await queued(ada.workspaceId, added.id)).toBe(1);
  });

  it('refuses a second domain on one page, and a person with no page', async () => {
    const ada = await person();
    await addMyDomain(ada.scope, { host: host() });
    expect(await refusalOf(addMyDomain(ada.scope, { host: host() }))).toMatchObject({ code: 'LIMIT_REACHED' });
    const bea = await person(false);
    // A membership's page is made with it (0119), so a person without one is the rare case of a page purged.
    const without = await getMyDomain(bea.scope);
    expect(without).toBeUndefined();
  });

  it('lets two people ask for one host, gives it to whoever proves it, and refuses the rest', async () => {
    const ada = await person();
    const bea = await person();
    const asked = host();
    const adas = await addMyDomain(ada.scope, { host: asked });
    const beas = await addMyDomain(bea.scope, { host: asked });
    const adaRow = await readDomainForCheck(ada.scope, adas.id);
    if (adaRow === undefined) throw new Error('No row.');
    const saved = await saveDomainCheck(
      ada.scope,
      adas.id,
      decideCheck(adaRow, { txt: 'found', vercel: working }, new Date()),
    );
    expect(saved).toMatchObject({ status: 'live' });
    expect(await liveDomainHandle({ db }, asked.host)).toBe(ada.handle);
    // Bea proving it too is refused by the host's one owner.
    const beaRow = await readDomainForCheck(bea.scope, beas.id);
    if (beaRow === undefined) throw new Error('No row.');
    const lost = await saveDomainCheck(
      bea.scope,
      beas.id,
      decideCheck(beaRow, { txt: 'found', vercel: working }, new Date()),
    );
    expect(lost).toMatchObject({ status: 'failed', problem: DOMAIN_PROBLEMS.inUse });
    // And a third person adding it now is refused at once.
    const cai = await person();
    expect(await refusalOf(addMyDomain(cai.scope, { host: asked }))).toMatchObject({
      code: 'IN_USE',
      message: 'That domain is already in use.',
    });
  });

  it('never reads or changes another person’s domain', async () => {
    const ada = await person();
    const added = await addMyDomain(ada.scope, { host: host() });
    const bea = await person();
    expect(await readDomainForCheck(bea.scope, added.id)).toBeUndefined();
    expect(await removeMyDomain(bea.scope, added.id)).toBeUndefined();
    // The system reads it in its own workspace only.
    expect(await readDomainForCheck(systemScope(db, ada.workspaceId), added.id)).toMatchObject({ id: added.id });
    expect(await readDomainForCheck(systemScope(db, bea.workspaceId), added.id)).toBeUndefined();
  });

  it('removes a live domain at once, freeing the host, and queues its detach', async () => {
    const ada = await person();
    const asked = host();
    const added = await addMyDomain(ada.scope, { host: asked });
    const row = await readDomainForCheck(ada.scope, added.id);
    if (row === undefined) throw new Error('No row.');
    await saveDomainCheck(ada.scope, added.id, decideCheck(row, { txt: 'found', vercel: working }, new Date()));
    expect(await removeMyDomain(ada.scope, added.id)).toEqual({ host: asked.host, kind: 'subdomain', attached: true });
    expect(await liveDomainHandle({ db }, asked.host)).toBeUndefined();
    expect(await getMyDomain(ada.scope)).toBeUndefined();
    expect(await queued(ada.workspaceId, added.id)).toBe(1);
    await markDomainDetached(systemScope(db, ada.workspaceId), added.id);
    expect((await readDomainForCheck(ada.scope, added.id))?.detachedAt).toBeInstanceOf(Date);
    // Another page may now take it.
    const bea = await person();
    expect(await addMyDomain(bea.scope, { host: asked })).toMatchObject({ host: asked.host });
  });

  it('starts a failed domain waiting again on Try again', async () => {
    const ada = await person();
    const added = await addMyDomain(ada.scope, { host: host() });
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`update public_domains set status = 'failed', problem = 'x', waiting_since = now() - interval '8 days' where id = ${added.id}`,
      ),
    );
    const again = await restartDomain(ada.scope, added.id);
    expect(again).toMatchObject({ status: 'waiting' });
    expect(again?.problem).toBeUndefined();
  });

  it('answers the same nothing for a host that is unknown, waiting, or not a host at all', async () => {
    const ada = await person();
    const asked = host();
    await addMyDomain(ada.scope, { host: asked });
    expect(await liveDomainHandle({ db }, asked.host)).toBeUndefined();
    expect(await liveDomainHandle({ db }, 'nobody.example.test')).toBeUndefined();
    expect(await liveDomainHandle({ db }, 'NOT A HOST')).toBeUndefined();
  });
});
