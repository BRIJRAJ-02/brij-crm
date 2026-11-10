// Unsubscribing from news and offers (10 November 2026, migration 0204) against the real Postgres as the app role:
// every news email carries the footer's page and the one click address under one signed token; withdrawing writes
// one no (source `email_link`) and a repeat writes nothing; the token opens only its own place; subscribing again
// is a new double opt-in to the Person's own address, once per withdrawal, and only its confirm grants.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PublicReserveInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterNewsPlace, enterTablePage } from '../access/table-door.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isRefusal } from '../engine/refusals.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import { addResource, visitWorkspace, type VisitWorkspace } from '../../test/visits-kit.ts';
import {
  confirmNewsLink,
  newsUnsubscribeToken,
  readNewsUnsubscribeToken,
  resubscribeNews,
  withdrawNews,
} from './news.ts';
import { guestReserve } from './public.ts';
import { getTableSetup, saveTableSetup } from './table-service.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-news-unsubscribe-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const at = (time: string) => `${week.monday}T${time}:00.000Z`;
const NOW = new Date(`${week.sunday}T09:00:00Z`);
const linkKey = new Uint8Array(32).fill(7);
const deps = { busy: NO_CALENDAR.busy, now: () => NOW, linkKey };

interface NewsParams {
  readonly confirmPath?: string;
  readonly unsubscribe?: { readonly pagePath: string; readonly oneClickPath: string };
}

async function newsMails(w: { readonly sql: VisitWorkspace['sql'] }) {
  return (
    await w.sql<{ to_address: string; params: NewsParams }>(
      sql`select to_address, params from emails where kind = 'reservation_news' order by created_at, id`,
    )
  ).rows;
}

const fragment = (path: string | undefined, name: string): string =>
  new URLSearchParams((path ?? '').split('#')[1] ?? '').get(name) ?? '';

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

async function restaurant() {
  const w = await visitWorkspace(db);
  await addResource(w, 'T1', { min: 1, max: 4 });
  const setup = await getTableSetup(w.owner, { placeId: w.placeId });
  await saveTableSetup(w.owner, {
    placeId: w.placeId,
    rules: { ...setup.rules, noticeMinutes: 0, partyMax: 4, online: true },
  });
  return { w, key: setup.publicKey };
}

const reserve = (start: string, email: string): PublicReserveInput => ({
  idempotencyKey: randomUUID(),
  party: 2,
  start,
  name: 'Grace Hopper',
  email,
  phone: '+44 20 7946 0000',
  marketing: true,
});

/** A reservation with news ticked and confirmed: the entry, the Person, the address and the email's way out. */
async function subscribed() {
  const { w, key } = await restaurant();
  const entry = await enterTablePage({ db }, key);
  const email = `news-${randomUUID().slice(0, 8)}@example.com`;
  const made = await guestReserve(entry, deps, reserve(at('18:00'), email));
  const [mail] = await newsMails(w);
  const confirmed = await confirmNewsLink(entry, { linkKey }, fragment(mail?.params.confirmPath, 'news'));
  return { w, key, entry, email, person: made.booked.personRecordId ?? '', mail, confirmed };
}

const consents = async (w: { readonly sql: VisitWorkspace['sql'] }, person: string) =>
  (
    await w.sql<{ granted: boolean; source_type: string; wording: string }>(sql`
      select granted, source_type, wording from consent_records where record_id = ${person}::uuid order by at, id
    `)
  ).rows;

describe('unsubscribing from news and offers (10 November 2026)', () => {
  it('puts the footer page and the one click address in the email, under one token naming the Person', async () => {
    const { key, mail, person, entry, confirmed } = await subscribed();
    const parts = mail?.params.unsubscribe;
    expect(parts?.pagePath).toMatch(new RegExp(`^/r/${key}/manage#unsubscribe=`));
    expect(parts?.oneClickPath).toMatch(/^\/api\/public\/news\/unsubscribe\?t=/);
    const token = fragment(parts?.pagePath, 'unsubscribe');
    expect(new URLSearchParams(parts?.oneClickPath.split('?')[1]).get('t')).toBe(token);
    // The token names ids and a hash only: no address rides in a link a log may keep.
    expect(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).not.toContain('@');
    expect(readNewsUnsubscribeToken(linkKey, token)).toMatchObject({
      workspaceId: entry.scope.workspaceId,
      placeId: entry.placeId,
      recordId: person,
      purpose: 'marketing_email',
    });
    expect(readNewsUnsubscribeToken(linkKey, `${token}x`)).toBeUndefined();
    expect(readNewsUnsubscribeToken(new Uint8Array(32).fill(9), token)).toBeUndefined();
    // The confirm's answer carries a token for the same Person (the signed up page's link).
    expect(confirmed.status).toBe('confirmed');
    expect(readNewsUnsubscribeToken(linkKey, confirmed.unsubscribeToken)?.recordId).toBe(person);
  });

  it('withdraws once, as a new row saying no, and a repeat writes nothing', async () => {
    const { w, mail, person } = await subscribed();
    const link = readNewsUnsubscribeToken(linkKey, fragment(mail?.params.unsubscribe?.pagePath, 'unsubscribe'));
    if (link === undefined) throw new Error('no link');
    const entry = await enterNewsPlace({ db }, link);
    expect(await withdrawNews(entry, link)).toBe('withdrawn');
    expect(await withdrawNews(entry, link)).toBe('unchanged');
    expect(await consents(w, person)).toEqual([
      { granted: true, source_type: 'appointment', wording: 'Send me news and offers from Somewhere Nowhere.' },
      {
        granted: false,
        source_type: 'email_link',
        wording: 'Unsubscribe from news and offers from Somewhere Nowhere.',
      },
    ]);
    // The old confirm link never reads as a yes over it.
    expect(await code(confirmNewsLink(entry, { linkKey }, fragment(mail?.params.confirmPath, 'news')))).toBe(
      'NOT_FOUND',
    );
  });

  it('opens only the link’s own place, and still withdraws once that place is gone, while its workspace lives', async () => {
    const { w, mail, person } = await subscribed();
    const link = readNewsUnsubscribeToken(linkKey, fragment(mail?.params.unsubscribe?.pagePath, 'unsubscribe'));
    if (link === undefined) throw new Error('no link');
    const other = await restaurant();
    const otherEntry = await enterTablePage({ db }, other.key);
    expect(await code(withdrawNews(otherEntry, link))).toBe('NOT_FOUND');
    expect(await code(resubscribeNews(otherEntry, { linkKey }, link))).toBe('NOT_FOUND');
    expect(await code(enterNewsPlace({ db }, { workspaceId: randomUUID(), placeId: link.placeId }))).toBe('NOT_FOUND');
    // A place gone (here one that never was, signed by us): the consent is the workspace's, so the way out stands.
    const gone = { ...link, placeId: randomUUID() };
    const goneEntry = await enterNewsPlace({ db }, gone);
    expect(goneEntry.key).toBe('');
    expect(await withdrawNews(goneEntry, gone)).toBe('withdrawn');
    expect((await consents(w, person)).at(-1)).toEqual({
      granted: false,
      source_type: 'email_link',
      wording: 'Unsubscribe from news and offers.',
    });
    // Subscribing again needs the place's page to confirm on: nothing goes.
    expect(await resubscribeNews(goneEntry, { linkKey }, gone)).toBe('no_place');
  });

  it('withdraws from the Person a merged one became, whose consents the merge moved', async () => {
    const { w, mail, person, entry } = await subscribed();
    const link = readNewsUnsubscribeToken(linkKey, fragment(mail?.params.unsubscribe?.pagePath, 'unsubscribe'));
    if (link === undefined) throw new Error('no link');
    const kept =
      (
        await guestReserve(entry, deps, {
          ...reserve(at('20:00'), `kept-${randomUUID().slice(0, 8)}@example.com`),
          marketing: false,
        })
      ).booked.personRecordId ?? '';
    // As the merge does (`engine/merge.ts`): the consents move onto the Person kept, the other is marked merged.
    await testQuery(ownerUrl, `update consent_records set record_id = $1 where record_id = $2`, [kept, person]);
    await testQuery(
      ownerUrl,
      `update records set deleted_at = now(), deleted_by_type = 'system', merged_into_record_id = $1 where id = $2`,
      [kept, person],
    );
    expect(await withdrawNews(await enterNewsPlace({ db }, link), link)).toBe('withdrawn');
    expect((await consents(w, kept)).at(-1)).toMatchObject({ granted: false, source_type: 'email_link' });
    expect(await consents(w, person)).toEqual([]);
  });

  it('subscribes again only by a new double opt-in to the Person’s own address, once per withdrawal', async () => {
    const { w, mail, person, email } = await subscribed();
    const link = readNewsUnsubscribeToken(linkKey, fragment(mail?.params.unsubscribe?.pagePath, 'unsubscribe'));
    if (link === undefined) throw new Error('no link');
    const entry = await enterNewsPlace({ db }, link);
    // Still yes: nothing to ask.
    expect(await resubscribeNews(entry, { linkKey }, link)).toBe('already_given');
    await withdrawNews(entry, link);
    // A link naming another address sends nothing anywhere.
    const elsewhere = { ...link, addressHash: 'AAAAAAAAAAAAAAAAAAAAAA' };
    expect(readNewsUnsubscribeToken(linkKey, newsUnsubscribeToken(linkKey, elsewhere))).toEqual(elsewhere);
    expect(await resubscribeNews(entry, { linkKey }, elsewhere)).toBe('no_address');
    expect(await resubscribeNews(entry, { linkKey }, link)).toBe('emailed');
    expect(await resubscribeNews(entry, { linkKey }, link)).toBe('asked_before');
    const mails = await newsMails(w);
    expect(mails).toHaveLength(2);
    expect(mails[1]?.to_address).toBe(email);
    // Asking granted nothing: the latest row still says no until the inbox owner presses Yes.
    expect((await consents(w, person)).at(-1)?.granted).toBe(false);
    const again = await confirmNewsLink(entry, { linkKey }, fragment(mails[1]?.params.confirmPath, 'news'));
    expect(again.status).toBe('confirmed');
    expect((await consents(w, person)).at(-1)).toMatchObject({ granted: true, source_type: 'email_link' });
  });
});
