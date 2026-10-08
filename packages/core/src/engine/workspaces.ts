// Creating a workspace (spec 0004, AC-1): the tenant row, its counters, the
// first member, and the standard objects and relationships from the template,
// in one write.
// It runs inside withWorkspace() for the new id, so even the first insert is
// checked by row level security; no owner connection is needed.
//
// A signed in user's workspace (spec 0005, AC-30) is the same write with the
// client's id, plus the directory rows in the same transaction, and a repeated
// request returns the workspace it already made.
import { and, eq } from 'drizzle-orm';
import { addWorkspaceToDirectory, DIRECTORY_SLUG_CONSTRAINT, schema } from '@crm/db';
import { STANDARD_OBJECTS, STANDARD_RELATIONSHIPS, STANDARD_TEMPLATE_VERSION } from '../templates/standard-v1.ts';
import { insertAttribute, insertObject } from './definitions.ts';
import { isUuidV7, newId } from './ids.ts';
import { insertOption } from './options.ts';
import { isRefusal, postgresError, refuse } from './refusals.ts';
import { insertRelationship } from './relationships.ts';
import { systemScope } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from './scope.ts';
import { runWrite, type AfterWrite } from './write.ts';

const { attributes, members, workspaceCounters, workspaces } = schema;

/** What a new workspace needs. */
export interface WorkspaceInput {
  readonly name: string;
  readonly slug: string;
  readonly firstMember: { readonly name: string; readonly email: string; readonly userId?: string };
}

/** The new workspace, its first member, and the standard objects by key. */
export interface CreatedWorkspace {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly objects: Readonly<Record<string, string>>;
}

/** The unique indexes a taken workspace address trips: live workspaces, and every slug the directory ever held. */
const SLUG_CONSTRAINTS: ReadonlySet<string> = new Set(['workspaces_slug', DIRECTORY_SLUG_CONSTRAINT]);
const WORKSPACE_KEY = 'workspaces_pkey';
/** A workspace address (spec 0005): lowercase letters and digits in single dash runs, 3 to 40 characters. */
const WORKSPACE_SLUG = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Creates a workspace with its first member, its owner, and the standard objects. The system is the actor. */
export async function createWorkspace(
  db: EngineScope['db'],
  input: WorkspaceInput,
  hooks: readonly AfterWrite[] = [],
): Promise<CreatedWorkspace> {
  return insertWorkspace(db, input, { workspaceId: newId(), memberId: newId() }, hooks);
}

/** The write behind both entries, with its ids chosen by the caller. */
async function insertWorkspace(
  db: EngineScope['db'],
  input: WorkspaceInput,
  ids: { readonly workspaceId: string; readonly memberId: string },
  hooks: readonly AfterWrite[],
): Promise<CreatedWorkspace> {
  const { workspaceId, memberId } = ids;
  // The bootstrap's own system scope, minted here: the workspace doesn't exist yet, so no member could enter it.
  const scope = systemScope(db, workspaceId);
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        const system = { createdByType: 'system', updatedByType: 'system' } as const;
        await tx.insert(workspaces).values({ id: workspaceId, name: input.name.trim(), slug: input.slug, ...system });
        await tx.insert(workspaceCounters).values({ workspaceId });
        await tx.insert(members).values({
          workspaceId,
          id: memberId,
          userId: input.firstMember.userId ?? null,
          name: input.firstMember.name.trim(),
          email: input.firstMember.email.trim(),
          // Whoever makes a workspace owns it (spec 0009, AC-132).
          role: 'owner',
          ...system,
        });
        const objects: Record<string, string> = {};
        for (const standard of STANDARD_OBJECTS) {
          const { standardKey, ...object } = standard.object;
          const { objectId } = await insertObject(context, {
            ...object,
            standard: { key: standardKey, templateVersion: STANDARD_TEMPLATE_VERSION },
          });
          for (const { options, defaultFirstOption, ...attribute } of standard.attributes) {
            const { attributeId } = await insertAttribute(context, { ...attribute, objectId });
            const optionIds: string[] = [];
            for (const option of options ?? []) {
              optionIds.push((await insertOption(context, { attributeId, ...option })).optionId);
            }
            const [first] = optionIds;
            if (defaultFirstOption === true && first !== undefined) {
              await tx
                .update(attributes)
                .set({ defaultValue: { kind: 'static', value: first } })
                .where(eq(attributes.id, attributeId));
            }
          }
          objects[standardKey] = objectId;
        }
        const objectOf = (key: string): string => {
          const id = objects[key];
          if (id === undefined) throw new Error(`The template has no ${key} object.`);
          return id;
        };
        for (const { cardinality, from, to } of STANDARD_RELATIONSHIPS) {
          await insertRelationship(context, {
            cardinality,
            from: { objectId: objectOf(from.object), apiSlug: from.apiSlug, title: from.title },
            to: { objectId: objectOf(to.object), apiSlug: to.apiSlug, title: to.title },
          });
        }
        return { workspaceId, memberId, objects };
      },
      hooks,
    );
    return result;
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint !== undefined && SLUG_CONSTRAINTS.has(pg.constraint)) {
      throw slugTaken();
    }
    throw error;
  }
}

function slugTaken() {
  return refuse('SLUG_TAKEN', 'That workspace address is taken. Pick another.');
}

/** A workspace a signed in user makes for themselves, with the id their browser chose (the retry key). */
export interface UserWorkspaceInput {
  /** A UUID v7 the client minted; repeating the request with it returns the same workspace. */
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The signed in user (`auth.user.id`), and the name and email their member row gets. */
  readonly firstMember: { readonly userId: string; readonly name: string; readonly email: string };
}

/** The workspace as the directory lists it, its first member, and whether this was a repeat. */
export interface UserWorkspace {
  readonly workspace: { readonly id: string; readonly slug: string; readonly name: string };
  readonly memberId: string;
  /** True when an earlier request with this id already made it (a dropped response, retried). */
  readonly replayed: boolean;
}

/**
 * Creates a signed in user's workspace (spec 0005, AC-30): the workspace, its
 * counters, the standard template, the user's member row, and the directory
 * and membership rows, all in one transaction (the directory rows are written
 * by an after write step, before any `hooks` given). The system is the actor,
 * and the scope is built here; no outbox row is stored, since nobody can be
 * subscribed to a workspace that didn't exist.
 *
 * Idempotent on `id`: if a workspace with that id exists and this user is its
 * active member, it is returned with `replayed: true`. Refuses `ID_TAKEN` when
 * the id belongs to anything else, `SLUG_TAKEN` when the address is taken now
 * or was ever used, and `CONFIG_INVALID` for an id that isn't a UUID v7.
 */
export async function createUserWorkspace(
  db: EngineScope['db'],
  input: UserWorkspaceInput,
  hooks: readonly AfterWrite[] = [],
): Promise<UserWorkspace> {
  if (!isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'A workspace id the client chooses must be a UUID v7.');
  }
  if (!WORKSPACE_SLUG.test(input.slug)) {
    throw refuse('CONFIG_INVALID', 'Use 3 to 40 lowercase letters and digits, with single dashes between them.');
  }
  const memberId = newId();
  const name = input.name.trim();
  const directory: AfterWrite = (_change, tx) =>
    addWorkspaceToDirectory(tx, {
      workspaceId: input.id,
      slug: input.slug,
      name,
      userId: input.firstMember.userId,
      memberId,
    });
  try {
    await insertWorkspace(db, input, { workspaceId: input.id, memberId }, [directory, ...hooks]);
    return { workspace: { id: input.id, slug: input.slug, name }, memberId, replayed: false };
  } catch (error) {
    const pg = postgresError(error);
    const keyClash = pg?.code === '23505' && pg.constraint === WORKSPACE_KEY;
    const slugClash = isRefusal(error) && error.refusal.code === 'SLUG_TAKEN';
    if (!keyClash && !slugClash) throw error;
    // A repeat clashes on the id or the slug (whichever index Postgres checks first), so either looks for it.
    const earlier = await findUserWorkspace(db, input.id, input.firstMember.userId);
    if (earlier.kind === 'mine') return { workspace: earlier.workspace, memberId: earlier.memberId, replayed: true };
    if (earlier.kind === 'taken' || keyClash) throw refuse('ID_TAKEN', 'A workspace with that id already exists.');
    throw error;
  }
}

type EarlierWrite =
  | { readonly kind: 'mine'; readonly workspace: UserWorkspace['workspace']; readonly memberId: string }
  | { readonly kind: 'taken' }
  | { readonly kind: 'absent' };

/**
 * The workspace with this id, read inside it: `mine` when it is live and the
 * user is its active member, `taken` when it exists otherwise, else `absent`.
 */
async function findUserWorkspace(db: EngineScope['db'], workspaceId: string, userId: string): Promise<EarlierWrite> {
  const [row] = await inWorkspace(systemScope(db, workspaceId), (tx) =>
    tx
      .select({ slug: workspaces.slug, name: workspaces.name, deletedAt: workspaces.deletedAt, memberId: members.id })
      .from(workspaces)
      .leftJoin(
        members,
        and(eq(members.workspaceId, workspaces.id), eq(members.userId, userId), eq(members.status, 'active')),
      )
      .where(eq(workspaces.id, workspaceId))
      .limit(1),
  );
  if (row === undefined) return { kind: 'absent' };
  if (row.deletedAt !== null || row.memberId === null) return { kind: 'taken' };
  return { kind: 'mine', workspace: { id: workspaceId, slug: row.slug, name: row.name }, memberId: row.memberId };
}
