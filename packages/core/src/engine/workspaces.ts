// Creating a workspace (spec 0004, AC-1): the tenant row, its counters, the
// first member, and the standard objects from the template, in one write.
// It runs inside withWorkspace() for the new id, so even the first insert is
// checked by row level security; no owner connection is needed.
import { eq } from 'drizzle-orm';
import { schema } from '@crm/db';
import { STANDARD_OBJECTS, STANDARD_TEMPLATE_VERSION } from '../templates/standard-v1.ts';
import { insertAttribute, insertObject } from './definitions.ts';
import { newId } from './ids.ts';
import { insertOption } from './options.ts';
import { postgresError, refuse } from './refusals.ts';
import { SYSTEM_ACTOR, type EngineScope } from './scope.ts';
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

/** Creates a workspace with its first member and the standard objects. The system is the actor. */
export async function createWorkspace(
  db: EngineScope['db'],
  input: WorkspaceInput,
  hooks: readonly AfterWrite[] = [],
): Promise<CreatedWorkspace> {
  const workspaceId = newId();
  const memberId = newId();
  const scope: EngineScope = { db, workspaceId, actor: SYSTEM_ACTOR };
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
        return { workspaceId, memberId, objects };
      },
      hooks,
    );
    return result;
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'workspaces_slug') {
      throw refuse('SLUG_TAKEN', 'That workspace address is taken. Pick another.');
    }
    throw error;
  }
}
