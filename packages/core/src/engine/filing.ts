// A person filed under their company by their email's domain (spec 0059,
// AC-5911 to AC-5919), inside the person's own write: when a People record is
// made, or its Email addresses change, and its Company is empty after the
// write, the first address not at a free mail domain links the company that
// holds its host or registrable domain, or a company made now from it. It
// runs in its own savepoint with the write's scope, so a refusal (no access,
// a rule, the record limit) files nothing and never fails the person's write.
// The People and Companies helpers here are shared with the booking's visitor
// filing (spec 0025), which runs first and sets Company itself.
import { sql } from 'drizzle-orm';
import { domainOf, isPublicEmailDomain, type FiledCompany } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkRecordRoom } from './limits.ts';
import { refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';
import { loadAttributes, type AttributeDef } from './values.ts';
import type { WriteContext } from './write.ts';
import { isOpen } from '../access/policy.ts';
import { attributeLevel, attributeVisible, checkObject } from '../access/visibility.ts';

/** The attribute of an object with this api slug, live. */
export function bySlug(attributes: ReadonlyMap<string, AttributeDef>, apiSlug: string): AttributeDef | undefined {
  return [...attributes.values()].find((attribute) => attribute.apiSlug === apiSlug && attribute.archivedAt === null);
}

/** The object's live `owner` attribute set to the member, when it has one that names members; nothing otherwise. */
export function ownerValue(
  attributes: ReadonlyMap<string, AttributeDef>,
  memberId: string | undefined,
): Readonly<Record<string, unknown>> {
  const owner = memberId === undefined ? undefined : bySlug(attributes, 'owner');
  if (owner?.type !== 'actor_reference' || memberId === undefined) return {};
  const value = { type: 'member', id: memberId };
  return { [owner.id]: owner.isMulti ? [value] : value };
}

/** The live record holding `key` as a current unique value of `attribute`, if any. */
export async function holderOf(tx: WorkspaceTx, attributeId: string, key: string): Promise<string | undefined> {
  const found = await tx.execute<{ record_id: string }>(sql`
    select v.record_id::text as record_id
    from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.record_id and r.deleted_at is null
    where v.attribute_id = ${attributeId}::uuid and v.unique_key = ${key} and v.active_until is null
    limit 1
  `);
  return found.rows[0]?.record_id;
}

/**
 * Whether the person links a company now: any current link of the attribute's relationship, to a company in the
 * trash or one the writer can't see included, so filing never replaces one. An attribute with no relationship
 * counts as set.
 */
export async function hasCompany(tx: WorkspaceTx, personId: string, attribute: AttributeDef): Promise<boolean> {
  if (attribute.relationshipId === null) return true;
  const found = await tx.execute(sql`
    select 1 from record_links
    where relationship_id = ${attribute.relationshipId}::uuid and active_until is null
      and (from_record_id = ${personId}::uuid or to_record_id = ${personId}::uuid)
    limit 1
  `);
  return found.rows.length > 0;
}

/** Second level labels under a two letter country code that a company registers beneath (`acme.co.uk`). */
const COUNTRY_SECOND_LEVELS: ReadonlySet<string> = new Set([
  'co',
  'com',
  'net',
  'org',
  'ac',
  'gov',
  'edu',
  'ltd',
  'plc',
]);

/**
 * The domain a company registers, from a host (AC-5912): its last two labels, or its last three when the second
 * last is a common second level (`co`, `com`, `org` and the like) under a two letter country code, so
 * `eu.acme.com` gives `acme.com` and `mail.big-corp.co.uk` gives `big-corp.co.uk`.
 */
export function registrableDomain(host: string): string {
  const labels = host
    .trim()
    .toLowerCase()
    .split('.')
    .filter((label) => label !== '');
  const last = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  const take = labels.length > 2 && /^[a-z]{2}$/.test(last) && COUNTRY_SECOND_LEVELS.has(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * A company's name from its registrable domain (AC-5913): the first label, hyphens and underscores read as
 * spaces, each word capitalised (`acme.com` gives "Acme", `big-corp.co.uk` gives "Big Corp"). Empty when the
 * label has no letters or digits.
 */
export function companyNameOf(domain: string): string {
  const [first = ''] = domain.split('.');
  return first
    .split(/[-_]+/)
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** The host and registrable domain an address files by, or undefined for a free mail domain or no domain. */
export function filingDomains(email: string): { readonly host: string; readonly registrable: string } | undefined {
  const host = domainOf(email);
  if (host === '' || !host.includes('.')) return undefined;
  const registrable = registrableDomain(host);
  if (isPublicEmailDomain(host) || isPublicEmailDomain(registrable)) return undefined;
  return { host, registrable };
}

/**
 * How a company filing makes counts against the record limit: `deferred`, its slot counted with the write's and
 * taken at the write's end (`WriteContext.deferSlots`), once there is room beside what the write counted so far; or,
 * in a batch that takes its records' slots itself, last (an import, spec 0040), the `room` it has left, where the
 * company takes no slot and the batch counts it from the answer. `off` files nothing: an undo putting old values
 * back, so undoing an email change never links the person again.
 */
export type FilingSlots = 'deferred' | 'off' | { readonly room: number };

/**
 * The record writes filing makes, passed in, so this module never imports `records.ts` (which calls it): a
 * company's create with its attributes already loaded and its slot counted here, and the person's Company link.
 */
export interface FilingWrites {
  readonly insert: (
    context: WriteContext,
    input: { readonly objectId: string; readonly values: Readonly<Record<string, unknown>> },
    known: { readonly attributes: ReadonlyMap<string, AttributeDef>; readonly countsSlots: true },
  ) => Promise<{ readonly recordId: string }>;
  readonly update: (
    context: WriteContext,
    input: { readonly recordId: string; readonly values: Readonly<Record<string, { readonly value: unknown }>> },
  ) => Promise<Readonly<Record<string, { readonly versionId?: string }>>>;
}

/** What a filing needs of the person's write: the person, their object's attributes, and what the write changed. */
export interface FilingInput {
  readonly personId: string;
  readonly objectId: string;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** The attributes the write gave a new version: filing runs only when Email addresses is one. */
  readonly written: ReadonlySet<string>;
  readonly slots: FilingSlots;
}

/** The first current address on the person that files, in the order the person holds them. */
async function filingEmail(
  tx: WorkspaceTx,
  personId: string,
  email: AttributeDef,
): Promise<{ readonly host: string; readonly registrable: string } | undefined> {
  const rows = await tx.execute<{ text_value: string }>(sql`
    select text_value from "values"
    where owner_id = ${personId}::uuid and attribute_id = ${email.id}::uuid and active_until is null
      and not is_cleared and text_value is not null
    order by position
  `);
  for (const row of rows.rows) {
    const domains = filingDomains(row.text_value);
    if (domains !== undefined) return domains;
  }
  return undefined;
}

/** Whether the object is the workspace's standard People, and its live standard Companies, in one read. */
async function standardObjects(tx: WorkspaceTx, objectId: string): Promise<string | undefined> {
  const rows = await tx.execute<{ is_people: boolean; companies: string | null }>(sql`
    select
      exists (select 1 from objects where id = ${objectId}::uuid and standard_key = 'people') as is_people,
      (select id::text from objects where standard_key = 'companies' and archived_at is null limit 1) as companies
  `);
  const [row] = rows.rows;
  return row?.is_people === true && row.companies !== null ? row.companies : undefined;
}

/**
 * Where a write to this object files companies: the standard Companies, the person's Company attribute, and the
 * Companies attributes filing never writes (all but Domains and Name), when the object is the standard People with
 * the attributes filing reads; undefined otherwise. A form's access widens by exactly these (spec 0059, AC-5916),
 * so a submission files as any other write does and can write nothing else on Companies.
 */
export async function companyFilingTarget(
  tx: WorkspaceTx,
  objectId: string,
  attributes: ReadonlyMap<string, AttributeDef>,
): Promise<
  { readonly companies: string; readonly companyAttributeId: string; readonly unwritten: readonly string[] } | undefined
> {
  const email = bySlug(attributes, 'email_addresses');
  const company = bySlug(attributes, 'company');
  if (email?.type !== 'email' || company?.type !== 'record_reference') return undefined;
  const companies = await standardObjects(tx, objectId);
  if (companies === undefined) return undefined;
  const companyAttributes = await loadAttributes(tx, companies);
  const filed = new Set([bySlug(companyAttributes, 'domains')?.id, bySlug(companyAttributes, 'name')?.id]);
  const unwritten = [...companyAttributes.keys()].filter((id) => !filed.has(id));
  return { companies, companyAttributeId: company.id, unwritten };
}

/** A company's name as the writer may read it: empty when the name field is hidden from them or not text. */
async function companyName(
  tx: WorkspaceTx,
  scope: EngineScope,
  recordId: string,
  name: AttributeDef | undefined,
): Promise<string> {
  if (name?.type !== 'text' || !attributeVisible(scope.access, name)) return '';
  const rows = await tx.execute<{ text_value: string }>(sql`
    select text_value from "values"
    where owner_id = ${recordId}::uuid and attribute_id = ${name.id}::uuid and active_until is null
      and not is_cleared and text_value is not null
    order by position limit 1
  `);
  return rows.rows[0]?.text_value ?? '';
}

/** The values a company made from `domain` starts with: its domain, its name and, for a member, its owner. */
function madeCompanyValues(
  scope: EngineScope,
  attributes: ReadonlyMap<string, AttributeDef>,
  domains: AttributeDef,
  domain: string,
): Readonly<Record<string, unknown>> {
  const name = bySlug(attributes, 'name');
  const named = companyNameOf(domain);
  const { actor, access } = scope;
  // The owner only where the member may set it: a read only Owner never costs them the company.
  const owned = ownerValue(attributes, actor.type === 'member' && actor.id !== null ? actor.id : undefined);
  const owner = bySlug(attributes, 'owner');
  const mayOwn = owner !== undefined && (isOpen(access) || attributeLevel(access, owner) === 'write');
  return {
    [domains.id]: domains.isMulti ? [domain] : domain,
    ...(name?.type === 'text' && named !== '' ? { [name.id]: named } : {}),
    ...(mayOwn ? owned : {}),
  };
}

/**
 * Files the person under their company (see the file's header), answering the company linked, or undefined when
 * nothing was filed. Two writes for one new domain take turns on a transaction lock keyed by the workspace and
 * the registrable domain, taken before the holder is looked for, so the second finds the first's company
 * (AC-5917). Everything it writes (the company, its values, the link, their history) joins the person's write, so
 * the hooks give it the same audit entries and change events (AC-5918).
 */
export async function fileCompany(
  context: WriteContext,
  input: FilingInput,
  writes: FilingWrites,
): Promise<FiledCompany | undefined> {
  const { tx, scope } = context;
  const email = bySlug(input.attributes, 'email_addresses');
  const company = bySlug(input.attributes, 'company');
  // Not a person's write, or not one that changed their emails: nothing is read at all.
  if (
    input.slots === 'off' ||
    email?.type !== 'email' ||
    company?.type !== 'record_reference' ||
    !input.written.has(email.id)
  ) {
    return undefined;
  }
  const companies = await standardObjects(tx, input.objectId);
  if (companies === undefined) return undefined;
  const domain = await filingEmail(tx, input.personId, email);
  if (domain === undefined || (await hasCompany(tx, input.personId, company))) return undefined;
  const companyAttributes = await loadAttributes(tx, companies);
  const domains = bySlug(companyAttributes, 'domains');
  // Matching reads Domains, so a writer who can't see it files nothing: which company holds a domain they may not
  // see is never told to them by a link (hidden means absent).
  if (domains?.type !== 'domain' || !attributeVisible(scope.access, domains)) return undefined;
  // A batch's room for a company made now; undefined when its slot is counted with the write's.
  const room = typeof input.slots === 'object' ? input.slots.room : undefined;
  const holder = (tx: WorkspaceTx) =>
    holderOf(tx, domains.id, domain.host).then(
      async (found) =>
        found ?? (domain.host === domain.registrable ? undefined : holderOf(tx, domains.id, domain.registrable)),
    );

  const filed = await context.perRecord(async (step): Promise<FiledCompany | undefined> => {
    // A company that holds the domain is linked with no lock; only a write that may make one takes the domain's
    // lock, then looks again, so it finds a company another write made meanwhile (READ COMMITTED).
    let held = await holder(step.tx);
    if (held === undefined) {
      await step.tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`company-domain:${scope.workspaceId}:${domain.registrable}`}, 0))`,
      );
      held = await holder(step.tx);
    }
    let recordId = held;
    if (recordId === undefined) {
      if (room === undefined) await checkRecordRoom(step.tx, step.scope, step.deferredSlots() + 1);
      else if (room < 1) return undefined;
      await checkObject(step.tx, step.scope.access, companies, 'write');
      const made = await writes.insert(
        step,
        {
          objectId: companies,
          values: madeCompanyValues(step.scope, companyAttributes, domains, domain.registrable),
        },
        { attributes: companyAttributes, countsSlots: true },
      );
      if (room === undefined) step.deferSlots(1);
      recordId = made.recordId;
    }
    const reference = { objectId: companies, recordId };
    // The link goes through the write path, so a company the writer can't see, or a Company field they can't
    // change, refuses here and files nothing (AC-5919).
    const results = await writes.update(step, {
      recordId: input.personId,
      values: { [company.id]: { value: company.isMulti ? [reference] : reference } },
    });
    const linkVersionId = results[company.id]?.versionId;
    // No link written means nothing to answer for: the savepoint goes back, the company made for it too.
    if (linkVersionId === undefined) throw refuse('CONFIG_INVALID', 'The company could not be linked.');
    return {
      objectId: companies,
      recordId,
      name: await companyName(step.tx, step.scope, recordId, bySlug(companyAttributes, 'name')),
      made: held === undefined,
      attributeId: company.id,
      linkVersionId,
    };
  });
  return filed.ok ? filed.value : undefined;
}
