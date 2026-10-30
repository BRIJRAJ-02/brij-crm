// The visitor on the CRM's records (spec 0025, AC-634), inside the booking's
// write: the person matched by email or made (name and email, as the
// `booking` actor), and their company matched or made by the email's domain
// (never for a free email domain) and linked when the person has none. A
// person made now takes the page's answers for its required fields, so a
// required field the page asks for never keeps the guest out of the CRM. An
// existing person's values are never overwritten. The forms matching module
// (spec 0023) takes this over at landing; the free domain list here is its
// seam until the `free-email-domains` package arrives.
import { sql } from 'drizzle-orm';
import { emailDomain } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { insertRecord, updateRecord } from '../engine/records.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';

/** Free email providers: a person on one gets no company (spec 0023's list replaces this). */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'gmx.com',
  'gmx.de',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com',
  'yandex.com',
  'zoho.com',
]);

/** First and last name from what the visitor typed: the last word is the last name. */
export function splitName(name: string): { readonly firstName: string; readonly lastName?: string } {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return { firstName: name.trim() };
  return { firstName: words.slice(0, -1).join(' '), lastName: words.at(-1) ?? '' };
}

/** The attribute of an object with this api slug, live. */
function bySlug(attributes: ReadonlyMap<string, AttributeDef>, apiSlug: string): AttributeDef | undefined {
  return [...attributes.values()].find((attribute) => attribute.apiSlug === apiSlug && attribute.archivedAt === null);
}

/** The object's live `owner` attribute set to the member, when it has one that names members; nothing otherwise. */
function ownerValue(
  attributes: ReadonlyMap<string, AttributeDef>,
  memberId: string | undefined,
): Readonly<Record<string, unknown>> {
  const owner = memberId === undefined ? undefined : bySlug(attributes, 'owner');
  if (owner?.type !== 'actor_reference' || memberId === undefined) return {};
  const value = { type: 'member', id: memberId };
  return { [owner.id]: owner.isMulti ? [value] : value };
}

/** The live record holding `key` as a current unique value of `attribute`, if any. */
async function holderOf(tx: WorkspaceTx, attributeId: string, key: string): Promise<string | undefined> {
  const found = await tx.execute<{ record_id: string }>(sql`
    select v.record_id::text as record_id
    from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.record_id and r.deleted_at is null
    where v.attribute_id = ${attributeId}::uuid and v.unique_key = ${key} and v.active_until is null
    limit 1
  `);
  return found.rows[0]?.record_id;
}

/** Whether the person links a company now. */
async function hasCompany(tx: WorkspaceTx, personId: string, attribute: AttributeDef): Promise<boolean> {
  if (attribute.relationshipId === null) return true;
  const found = await tx.execute(sql`
    select 1 from record_links
    where relationship_id = ${attribute.relationshipId}::uuid and active_until is null
      and (from_record_id = ${personId}::uuid or to_record_id = ${personId}::uuid)
    limit 1
  `);
  return found.rows.length > 0;
}

/**
 * Makes a record with the booking's own `values` and the visitor's `answers` to its required fields
 * (`requiredAnswerValues`), the booking's values winning on a field both name. Tried first in its own savepoint
 * when there are answers: a write refused with them (a value a rule turns down) is made again without them, so an
 * answer never costs the record a field's default would have given it, and the filing after it marks that answer
 * not saved. Without answers it is `insertRecord` exactly, refusing as it does.
 */
export async function insertWithAnswers(
  context: WriteContext,
  input: {
    readonly objectId: string;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly values: Readonly<Record<string, unknown>>;
    readonly timeZone: string;
  },
): Promise<Awaited<ReturnType<typeof insertRecord>>> {
  const { objectId, timeZone, values } = input;
  if (Object.keys(input.answers).length > 0) {
    const tried = await context.perRecord((inner) =>
      insertRecord(inner, { objectId, values: { ...input.answers, ...values }, timeZone }),
    );
    if (tried.ok) return tried.value;
  }
  return insertRecord(context, { objectId, values, timeZone });
}

/** What matching did: the person and company ids, and whether each was made now. */
export interface MatchedVisitor {
  readonly personId?: string;
  readonly companyId?: string;
}

/**
 * Matches or makes the visitor's person and company in the write's own
 * transaction (the caller holds the email's advisory lock, so two bookings
 * by one new visitor make one person). A workspace whose People lost their
 * email attribute matches nobody and makes nobody.
 */
export async function matchVisitor(
  context: WriteContext,
  objects: { readonly people: string; readonly companies: string },
  visitor: {
    readonly name: string;
    readonly email: string;
    readonly timeZone: string;
    /** The owner a person or company made now gets (a round robin booking's host, spec 0029 AC-744); none when absent. */
    readonly ownerMemberId?: string;
    /** The page's answers for People's required fields, which a person made now takes (`requiredAnswerValues`). */
    readonly answers?: Readonly<Record<string, unknown>>;
  },
): Promise<MatchedVisitor> {
  const { tx } = context;
  const people = await loadAttributes(tx, objects.people);
  const email = bySlug(people, 'email_addresses');
  if (email === undefined) return {};
  const domain = emailDomain(visitor.email);
  let companyId: string | undefined;
  if (!FREE_EMAIL_DOMAINS.has(domain)) {
    const companies = await loadAttributes(tx, objects.companies);
    const domains = bySlug(companies, 'domains');
    if (domains !== undefined) {
      companyId = await holderOf(tx, domains.id, domain);
      if (companyId === undefined) {
        const name = bySlug(companies, 'name');
        const made = await insertRecord(context, {
          objectId: objects.companies,
          values: {
            [domains.id]: domains.isMulti ? [domain] : domain,
            ...(name?.type === 'text' ? { [name.id]: domain } : {}),
            ...ownerValue(companies, visitor.ownerMemberId),
          },
          timeZone: visitor.timeZone,
        });
        companyId = made.recordId;
      }
    }
  }
  const company = bySlug(people, 'company');
  const reference =
    companyId === undefined || company === undefined ? undefined : { objectId: objects.companies, recordId: companyId };
  const personId = await holderOf(tx, email.id, visitor.email);
  if (personId !== undefined) {
    // Never overwrite: link the company only when the person has none.
    if (company !== undefined && reference !== undefined && !(await hasCompany(tx, personId, company))) {
      await updateRecord(context, { recordId: personId, values: { [company.id]: { value: reference } } });
    }
    return { personId, ...(companyId === undefined ? {} : { companyId }) };
  }
  const name = bySlug(people, 'name');
  const made = await insertWithAnswers(context, {
    objectId: objects.people,
    answers: visitor.answers ?? {},
    values: {
      [email.id]: email.isMulti ? [visitor.email] : visitor.email,
      ...(name?.type === 'personal_name' ? { [name.id]: splitName(visitor.name) } : {}),
      ...(name?.type === 'text' ? { [name.id]: visitor.name } : {}),
      ...(company !== undefined && reference !== undefined ? { [company.id]: reference } : {}),
      ...ownerValue(people, visitor.ownerMemberId),
    },
    timeZone: visitor.timeZone,
  });
  return { personId: made.recordId, ...(companyId === undefined ? {} : { companyId }) };
}
