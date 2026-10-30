// A required field a booking page asks for (late trap #11's real fix, 30 October 2026), against the real Postgres.
// The person a booking made carried only the email, the name, the company and the owner, so a People field set to
// Required refused the new guest's Person: the booking stood (a savepoint), and the guest silently never reached the
// CRM. The guard on Required stood in for the fix. Now a record made at a booking takes the answers its required
// fields need, and the guards let a field turn Required when every live page filing onto it asks a required
// question for it. An optional question can be skipped, so it never counts.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { BookingQuestions, PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import { createAttribute, editAttribute } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createObject } from '../objects/objects.ts';
import { testScope } from '../testing.ts';
import { NO_CALENDAR } from './calendar.ts';
import { listWorkspaceBookings } from './list.ts';
import { createBookingPage, listBookings, updateBookingPage } from './pages.ts';
import { bookPublicSlot } from './public.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-required-answers-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Required answers',
    slug: `required-answers-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const people = created.objects.people ?? '';
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  /** The current text values of `attributeId` on records of `objectId`. */
  const textsOf = async (objectId: string, attributeId: string) =>
    (
      await query<{ text_value: string }>(
        sql`select v.text_value from "values" v join records r on r.id = v.record_id
            where r.object_id = ${objectId}::uuid and r.deleted_at is null
              and v.attribute_id = ${attributeId}::uuid and v.active_until is null
            order by v.text_value`,
      )
    ).map((row) => row.text_value);
  return { ...created, owner, people, query, textsOf };
}

const deps = { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY };

const bookInput = (over: Partial<PublicBookInput> = {}): PublicBookInput => ({
  idempotencyKey: newId(),
  start: MONDAY_9,
  duration: 30,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'Europe/London',
  ...over,
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** One short text question filed on `attributeId`, required unless said. */
const ask = (key: string, attributeId: string, required = true): BookingQuestions[number] => ({
  id: key,
  key,
  label: key,
  answerType: 'short_text',
  required,
  update: 'fill',
  filedOn: { objectRole: 'main', attributeId },
});

describe('a required People field a page asks for (late trap #11)', () => {
  it('turns Required on, and makes a new guest’s Person with the answer, marked saved', async () => {
    const w = await workspace();
    const phone = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Desk phone',
      type: 'text',
    });
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Intro call', timeZone: 'UTC', settings: { questions: [ask('phone', phone.id)] } },
      NOW,
    );
    // The only live page asks every guest for it, so it is no wall.
    expect((await editAttribute(w.owner, { attributeId: phone.id, isRequired: true })).isRequired).toBe(true);

    const entry = await enterBookingPage({ db }, page.publicKey);
    await bookPublicSlot(entry, deps, bookInput({ answers: { phone: '020 7946 0000' } }));
    const [booking] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(booking?.personRecordId).toBeDefined();
    expect(await w.textsOf(w.people, phone.id)).toEqual(['020 7946 0000']);
    const [listed] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(listed?.answers?.[0]).toEqual(expect.objectContaining({ key: 'phone', saved: true }));

    // The same guest again: found, never overwritten.
    await bookPublicSlot(
      entry,
      deps,
      bookInput({ start: '2026-11-02T10:00:00.000Z', answers: { phone: '020 7946 9999' } }),
    );
    expect(await w.textsOf(w.people, phone.id)).toEqual(['020 7946 0000']);
    const people = await w.query(sql`select 1 from records where object_id = ${w.people}::uuid and deleted_at is null`);
    expect(people).toHaveLength(1);

    // The live page can't then take the question away, or make it skippable: the wall would come back.
    for (const questions of [[], [ask('phone', phone.id, false)]]) {
      const [refusal] = await refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { questions } }));
      expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'questions' });
      expect(refusal?.message).toContain('Desk phone is required there');
    }
    // Paused, it makes nothing, so the edit saves.
    const optional = [ask('phone', phone.id, false)];
    const paused = await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { status: 'paused', questions: optional },
    });
    expect(paused.questions).toEqual(optional);
    // And it can't go live again asking it optionally.
    const [goingLive] = await refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { status: 'live' } }));
    expect(goingLive).toMatchObject({ code: 'CONFIG_INVALID', field: 'status' });
  });

  it('still refuses Required while any live page skips it, asks it optionally, or files elsewhere', async () => {
    const w = await workspace();
    const pronouns = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Pronouns',
      type: 'text',
    });
    await createBookingPage(
      w.owner,
      { id: newId(), title: 'Asks it', timeZone: 'UTC', settings: { questions: [ask('pronouns', pronouns.id)] } },
      NOW,
    );
    const optional = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Asks it optionally',
        timeZone: 'UTC',
        settings: { questions: [ask('pronouns', pronouns.id, false)] },
      },
      NOW,
    );
    const [refusal] = await refusalOf(editAttribute(w.owner, { attributeId: pronouns.id, isRequired: true }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'isRequired' });
    expect(refusal?.message).toContain('Asks it optionally');
    expect(refusal?.message).not.toContain('Asks it,');
    expect(refusal?.message).toContain('add a required question for it');

    // A required question hidden behind a Show when can go unasked, so it doesn't count either.
    const shown: BookingQuestions = [
      { id: 'plan', key: 'plan', label: 'Plan', answerType: 'short_text', required: false, update: 'fill' },
      {
        ...ask('pronouns', pronouns.id),
        showWhen: { join: 'all', rules: [{ key: 'plan', op: 'is_answered' }] },
      },
    ];
    await updateBookingPage(w.owner, { pageId: optional.id, settings: { questions: shown } });
    expect(await refusalOf(editAttribute(w.owner, { attributeId: pronouns.id, isRequired: true }))).toEqual([
      expect.objectContaining({ code: 'CONFIG_INVALID', field: 'isRequired' }),
    ]);

    // Asked of every guest on both: no wall.
    await updateBookingPage(w.owner, { pageId: optional.id, settings: { questions: [ask('pronouns', pronouns.id)] } });
    expect((await editAttribute(w.owner, { attributeId: pronouns.id, isRequired: true })).isRequired).toBe(true);

    // A page filing its answers onto another object still makes the Person without them, so it walls People.
    const elsewhere = await createObject(w.owner, {
      id: newId(),
      singularName: 'Applicant',
      pluralName: 'Applicants',
      icon: 'inbox',
      hue: 'blue',
    });
    await createAttribute(w.owner, {
      objectId: elsewhere.id,
      id: newId(),
      title: 'Work email',
      type: 'email',
      isUnique: true,
    });
    await createBookingPage(
      w.owner,
      { id: newId(), title: 'Applies', timeZone: 'UTC', settings: { answersObjectId: elsewhere.id } },
      NOW,
    );
    const team = await createAttribute(w.owner, { objectId: w.people, id: newId(), title: 'Team', type: 'text' });
    const [walled] = await refusalOf(editAttribute(w.owner, { attributeId: team.id, isRequired: true }));
    expect(walled?.message).toContain('Applies');
    // Not every walled page could fix it with a question, so the refusal doesn't offer that.
    expect(walled?.message).not.toContain('add a required question');
  });

  it('keeps the Person when an optional answer is refused, marking only that answer not saved', async () => {
    const w = await workspace();
    const phone = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Desk phone',
      type: 'text',
    });
    const handle = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Handle',
      type: 'text',
      isUnique: true,
    });
    // Someone already holds the handle the guest will type, so the record refuses that answer.
    const name = (
      await w.query<{ id: string }>(
        sql`select id::text from attributes where object_id = ${w.people}::uuid and api_slug = 'name'`,
      )
    )[0]?.id;
    await createRecord(w.owner, {
      objectId: w.people,
      values: { [name ?? '']: { firstName: 'Lin' }, [handle.id]: 'taken' },
    });
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Intro call',
        timeZone: 'UTC',
        settings: { questions: [ask('phone', phone.id), ask('handle', handle.id, false)] },
      },
      NOW,
    );
    await editAttribute(w.owner, { attributeId: phone.id, isRequired: true });
    const entry = await enterBookingPage({ db }, page.publicKey);
    await bookPublicSlot(entry, deps, bookInput({ answers: { phone: '555 0100', handle: 'taken' } }));

    const [booking] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(booking?.personRecordId).toBeDefined();
    expect(await w.textsOf(w.people, phone.id)).toEqual(['555 0100']);
    const [listed] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(listed?.answers).toEqual([
      expect.objectContaining({ key: 'phone', saved: true }),
      expect.objectContaining({ key: 'handle', saved: false }),
    ]);
  });

  it('refuses turning filing back on for a live page the field turned Required behind', async () => {
    const w = await workspace();
    const phone = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Desk phone',
      type: 'text',
    });
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Kept out',
        timeZone: 'UTC',
        settings: { fileToCrm: false, questions: [ask('phone', phone.id, false)] },
      },
      NOW,
    );
    // Kept out of the CRM, it makes no record, so it walls nothing.
    expect((await editAttribute(w.owner, { attributeId: phone.id, isRequired: true })).isRequired).toBe(true);
    const [refusal] = await refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { fileToCrm: true } }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(refusal?.message).toContain('Desk phone is required there');
    // Asking for it of every guest, it files again.
    const filing = await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { fileToCrm: true, questions: [ask('phone', phone.id)] },
    });
    expect(filing.fileToCrm).toBe(true);
  });
});

describe('a required field of another answers object a page asks for', () => {
  it('lets the page file there, and makes the guest’s record with the answer, marked saved', async () => {
    const w = await workspace();
    const object = await createObject(w.owner, {
      id: newId(),
      singularName: 'Graphic Designer',
      pluralName: 'Graphic Designers',
      icon: 'inbox',
      hue: 'blue',
    });
    await createAttribute(w.owner, {
      objectId: object.id,
      id: newId(),
      title: 'Work email',
      type: 'email',
      isUnique: true,
    });
    const portfolio = await createAttribute(w.owner, {
      objectId: object.id,
      id: newId(),
      title: 'Portfolio',
      type: 'text',
      isRequired: true,
    });
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Portfolio review', timeZone: 'UTC' }, NOW);

    // Asked optionally, a guest can skip it: still a wall.
    const [optional] = await refusalOf(
      updateBookingPage(w.owner, {
        pageId: page.id,
        settings: { answersObjectId: object.id, questions: [ask('portfolio', portfolio.id, false)] },
      }),
    );
    expect(optional).toMatchObject({ code: 'CONFIG_INVALID', field: 'answersObjectId' });
    expect(optional?.message).toContain('Portfolio is required there');

    // Asked of every guest, it is filled.
    const filed = await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { answersObjectId: object.id, questions: [ask('portfolio', portfolio.id)] },
    });
    expect(filed.answersObjectId).toBe(object.id);

    const entry = await enterBookingPage({ db }, page.publicKey);
    await bookPublicSlot(entry, deps, bookInput({ answers: { portfolio: 'grace.example/work' } }));
    expect(await w.textsOf(object.id, portfolio.id)).toEqual(['grace.example/work']);
    const [listed] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(listed?.answers?.[0]).toEqual(expect.objectContaining({ key: 'portfolio', saved: true }));

    // The live page can't make that question skippable now.
    const [skippable] = await refusalOf(
      updateBookingPage(w.owner, { pageId: page.id, settings: { questions: [ask('portfolio', portfolio.id, false)] } }),
    );
    expect(skippable).toMatchObject({ code: 'CONFIG_INVALID', field: 'questions' });

    // And a field turned Required on that object is let through only when the page asks for it.
    const studio = await createAttribute(w.owner, { objectId: object.id, id: newId(), title: 'Studio', type: 'text' });
    expect(await refusalOf(editAttribute(w.owner, { attributeId: studio.id, isRequired: true }))).toEqual([
      expect.objectContaining({ code: 'CONFIG_INVALID', field: 'isRequired' }),
    ]);
    await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { questions: [ask('portfolio', portfolio.id), ask('studio', studio.id)] },
    });
    expect((await editAttribute(w.owner, { attributeId: studio.id, isRequired: true })).isRequired).toBe(true);
  });
});
