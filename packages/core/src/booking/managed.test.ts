// Managed booking pages (spec 0037, lane L10, AC-1333 to AC-1336), against a real Postgres as the app role: a
// template makes a page per member at `<slug>-<first name>`, its own public link answers no longer available, saving
// it moves every locked part to every member page in one transaction, a member's direct call to a locked part is
// refused on the server while their unlocked changes stand, taking a member off deletes their page (bookings kept)
// while deleting the template keeps every member page — the two opposite directions that destroy data when swapped.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type Role } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import {
  createManagedPage,
  deleteManagedPage,
  getManagedPage,
  listManagedPages,
  setManagedMembers,
  updateManagedPage,
} from './managed.ts';
import { deleteBookingPage, getBookingPage, listBookingPages, updateBookingPage } from './pages.ts';
import { getPublicBookingPage } from './public.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-managed-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace: Olga the owner, and members with weekday hours 09:00 to 17:00 UTC. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Managed',
    slug: `managed-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    const range: [string, string] = ['09:00', '17:00'];
    await saveDefaultHours(as(id, role), {
      availability: {
        ...defaultAvailability('UTC'),
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
    return id;
  };
  const rows = async <T extends Record<string, unknown>>(query: string, params: readonly unknown[] = []) =>
    testQuery<T>(ownerUrl, query, [created.workspaceId, ...params]);
  return { ...created, as, owner, add, rows };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('managed booking pages (AC-1333 to AC-1336)', () => {
  it('makes a page per member with the template’s settings and slug, and the template itself never books', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      settings: { description: 'Fifteen minutes', durations: [15] },
      locked: ['details', 'durations'],
      memberIds: [sam, kim],
    });
    expect(template.slug).toBe('intro-call');
    expect(template.locked).toEqual(['details', 'durations']);
    // AC-1333: each member has their own page, owned by them, at `<template slug>-<first name>`.
    const slugs = template.members.map((each) => each.slug).sort();
    expect(slugs).toEqual(['intro-call-kim', 'intro-call-sam']);
    const pages = await w.rows<{ owner_member_id: string; title: string; template_id: string; durations: number[] }>(
      'select owner_member_id::text, title, template_id::text, durations from booking_pages where workspace_id = $1 and template_id is not null order by slug',
      [],
    );
    expect(pages.map((row) => row.owner_member_id).sort()).toEqual([kim, sam].sort());
    expect(pages.every((row) => row.title === 'Intro call' && row.template_id === template.id)).toBe(true);
    // AC-1333: the template's own public link answers "This page is no longer available" — a template is not a page.
    const [key] = await w.rows<{ public_key: string }>(
      'select public_key from booking_pages where workspace_id = $1 and id = $2',
      [template.id],
    );
    expect(key).toBeDefined();
    const entry = await enterBookingPage({ db }, key?.public_key ?? '');
    const refusal = await refusalOf(getPublicBookingPage(entry));
    expect(refusal).toMatchObject({ code: 'NOT_FOUND', message: 'This page is no longer available.' });
  });

  it('copies locked parts to every member page in one save, and keeps each member’s own unlocked changes', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      settings: { durations: [15] },
      // Details is unlocked on purpose: each member's own description must survive the propagation.
      locked: ['durations', 'limits'],
      memberIds: [sam, kim],
    });
    const of = (memberId: string) => template.members.find((each) => each.id === memberId)?.pageId ?? '';
    // AC-1334: a member's change to an UNLOCKED part is theirs and stays.
    await updateBookingPage(w.as(sam), { pageId: of(sam), settings: { description: 'Sam’s own words' } });
    await updateManagedPage(w.owner, { templateId: template.id, settings: { durations: [45], windowDays: 21 } });
    const after = await w.rows<{
      owner_member_id: string;
      durations: number[];
      window_days: number;
      description: string;
    }>(
      'select owner_member_id::text, durations, window_days, description from booking_pages where workspace_id = $1 and template_id = $2',
      [template.id],
    );
    expect(after).toHaveLength(2);
    // AC-1334: every member page moved together — no page left on the old locked settings.
    expect(after.every((row) => row.window_days === 21)).toBe(true);
    expect(after.every((row) => row.durations.length === 1 && row.durations[0] === 45)).toBe(true);
    expect(after.find((row) => row.owner_member_id === sam)?.description).toBe('Sam’s own words');
  });

  it('refuses a member’s direct call to a locked part on the server, and lets their unlocked write through', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      locked: ['details', 'questions'],
      memberIds: [sam],
    });
    const pageId = template.members[0]?.pageId ?? '';
    // AC-1334: the lock is an access rule, not a disabled field. This is the member calling the API directly.
    const refusal = await refusalOf(updateBookingPage(w.as(sam), { pageId, settings: { title: 'My own title' } }));
    expect(refusal).toMatchObject({ code: 'FORBIDDEN', message: 'Your workspace sets this part of the page.' });
    const alsoLocked = await refusalOf(updateBookingPage(w.as(sam), { pageId, settings: { questions: [] } }));
    expect(alsoLocked.code).toBe('FORBIDDEN');
    // An admin is refused too: a locked part is changed on the template, or the next save would undo it.
    const asAdmin = await refusalOf(updateBookingPage(w.owner, { pageId, settings: { title: 'Admin’s title' } }));
    expect(asAdmin.code).toBe('FORBIDDEN');
    // Unlocked parts stay the member's own.
    const saved = await updateBookingPage(w.as(sam), { pageId, settings: { windowDays: 10 } });
    expect(saved.windowDays).toBe(10);
  });

  it('books a member page on that member’s own hours, never the template owner’s schedule (AC-1336)', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      locked: ['hours'],
      memberIds: [sam],
    });
    const pageId = template.members[0]?.pageId ?? '';
    const page = await getBookingPage(w.as(sam), { pageId });
    // Locked Hours means the member's own default schedule: null follows it. The template owner's schedule is never
    // copied, since spec 0035 AC-966 refuses another person's schedule on a page.
    expect(page.scheduleId).toBeNull();
    const refusal = await refusalOf(updateBookingPage(w.as(sam), { pageId, settings: { scheduleId: newId() } }));
    expect(refusal.code).toBe('FORBIDDEN');
  });

  it('deletes a removed member’s page but keeps every page when the TEMPLATE is deleted (AC-1335)', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      memberIds: [sam, kim],
    });
    const samPage = template.members.find((each) => each.id === sam)?.pageId ?? '';
    const kimPage = template.members.find((each) => each.id === kim)?.pageId ?? '';
    // Taking a member off deletes their page, as spec 0025 AC-648 deletes one.
    const after = await setManagedMembers(w.owner, { templateId: template.id, memberIds: [kim] });
    expect(after.members.map((each) => each.id)).toEqual([kim]);
    const gone = await w.rows<{ deleted: boolean }>(
      'select (deleted_at is not null) as deleted from booking_pages where workspace_id = $1 and id = $2',
      [samPage],
    );
    expect(gone[0]?.deleted).toBe(true);
    // Deleting the TEMPLATE is the opposite: Kim's page stays, as Kim's own, linked to nothing.
    await deleteManagedPage(w.owner, { templateId: template.id });
    const kept = await w.rows<{ deleted: boolean; template_id: string | null; owner_member_id: string }>(
      'select (deleted_at is not null) as deleted, template_id::text, owner_member_id::text from booking_pages where workspace_id = $1 and id = $2',
      [kimPage],
    );
    expect(kept[0]).toMatchObject({ deleted: false, template_id: null, owner_member_id: kim });
    expect(await listManagedPages(w.owner)).toEqual({ templates: [] });
    // Kim's page is theirs now: the part that was locked is theirs to change.
    const mine = await updateBookingPage(w.as(kim), { pageId: kimPage, settings: { title: 'Kim’s intro call' } });
    expect(mine.title).toBe('Kim’s intro call');
  });

  it('emails each member when their page is made and when it goes (AC-1335)', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      memberIds: [sam],
    });
    await setManagedMembers(w.owner, { templateId: template.id, memberIds: [] });
    const sent = await w.rows<{ kind: string; params: { removed?: boolean; pageTitle: string } }>(
      "select kind, params from emails where workspace_id = $1 and kind = 'managed_page' order by created_at",
      [],
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]?.params.pageTitle).toBe('Intro call');
    expect(sent[0]?.params.removed).toBeUndefined();
    expect(sent[1]?.params.removed).toBe(true);
  });

  it('locks the address without copying it: each member keeps their own slug, and may not rename it', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      // Limits locked beside the address, so the save really does propagate: that is what proves the slugs
      // survive a propagation rather than there being nothing to propagate.
      locked: ['address', 'limits'],
      memberIds: [sam, kim],
    });
    const of = (memberId: string) => template.members.find((each) => each.id === memberId)?.pageId ?? '';
    // A locked address is the member's to keep, not the template's to copy: copying one value onto every page
    // would break `booking_pages_slug`, so `address` is propagated as a rule, not a value.
    const refusal = await refusalOf(updateBookingPage(w.as(sam), { pageId: of(sam), settings: { slug: 'mine' } }));
    expect(refusal).toMatchObject({ code: 'FORBIDDEN', message: 'Your workspace sets this part of the page.' });
    // A save of the template leaves every member's own address standing.
    await updateManagedPage(w.owner, { templateId: template.id, settings: { windowDays: 14 } });
    const after = await w.rows<{ slug: string; window_days: number }>(
      'select slug, window_days from booking_pages where workspace_id = $1 and template_id = $2 order by slug',
      [template.id],
    );
    expect(after.map((row) => row.slug)).toEqual(['intro-call-kim', 'intro-call-sam']);
    expect(after.every((row) => row.window_days === 14)).toBe(true);
  });

  it('is not a page to booking.pages: no update, no delete and not listed in Links (security review, finding 1)', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      locked: ['details'],
      memberIds: [sam],
    });
    // The ordinary page procedures must not reach a template: a save there would skip the propagation and leave
    // every member page on older locked settings, and a delete there would orphan them.
    expect((await refusalOf(getBookingPage(w.owner, { pageId: template.id }))).code).toBe('NOT_FOUND');
    expect(
      (await refusalOf(updateBookingPage(w.owner, { pageId: template.id, settings: { status: 'live' } }))).code,
    ).toBe('NOT_FOUND');
    expect((await refusalOf(deleteBookingPage(w.owner, { pageId: template.id }))).code).toBe('NOT_FOUND');
    // Captures › Links lists the member's page, never the template.
    const listed = await listBookingPages(w.owner);
    expect(listed.map((page) => page.id)).not.toContain(template.id);
    const mine = await listBookingPages(w.as(sam));
    expect(mine.map((page) => page.id)).toEqual([template.members[0]?.pageId]);
    // The member's own page says where it came from and which parts are the workspace's (AC-1334's label).
    const page = await getBookingPage(w.as(sam), { pageId: template.members[0]?.pageId ?? '' });
    expect(page.templateId).toBe(template.id);
    expect(page.lockedParts).toEqual(['details']);
  });

  it('never reaches across workspaces: another workspace’s template and its members are invisible', async () => {
    const here = await world();
    const there = await world();
    const sam = await there.add('Sam Lee');
    const theirs = await createManagedPage(there.owner, {
      id: newId(),
      title: 'Their intro call',
      timeZone: 'UTC',
      memberIds: [sam],
    });
    // The standing guard: a cross workspace read returns nothing, for the new table and the template alike.
    expect(await listManagedPages(here.owner)).toEqual({ templates: [] });
    expect((await refusalOf(getManagedPage(here.owner, { templateId: theirs.id }))).code).toBe('NOT_FOUND');
    expect((await refusalOf(setManagedMembers(here.owner, { templateId: theirs.id, memberIds: [] }))).code).toBe(
      'NOT_FOUND',
    );
    expect((await refusalOf(deleteManagedPage(here.owner, { templateId: theirs.id }))).code).toBe('NOT_FOUND');
    const seen = await here.rows<{ n: number }>(
      'select count(*)::int as n from managed_page_members where workspace_id = $1',
      [],
    );
    expect(seen[0]?.n).toBe(0);
    // And the row really is in the other workspace.
    const mine = await there.rows<{ n: number }>(
      'select count(*)::int as n from managed_page_members where workspace_id = $1',
      [],
    );
    expect(mine[0]?.n).toBe(1);
  });

  it('answers as absent to a member who edits nothing, and refuses a non admin changing who it covers', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const template = await createManagedPage(w.owner, {
      id: newId(),
      title: 'Intro call',
      timeZone: 'UTC',
      memberIds: [sam],
    });
    // The member whose page it made is not the template's editor: the template is the workspace's (AC-1333).
    const hidden = await refusalOf(getManagedPage(w.as(sam), { templateId: template.id }));
    expect(hidden.code).toBe('NOT_FOUND');
    const refused = await refusalOf(setManagedMembers(w.as(sam), { templateId: template.id, memberIds: [] }));
    expect(refused.code).toBe('NOT_FOUND');
    expect(await listManagedPages(w.as(sam))).toEqual({ templates: [] });
  });
});
