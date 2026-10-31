// "Preview as" (spec 0032, AC-858): an admin sees an object as a member, or someone in a team, would. Every read goes
// through the real door's policy with that person's access (`previewScope`): their fields (hidden ones are simply
// absent) and how many records they see. Nothing here writes a record, and the scope it reads with never leaves this
// file. The one row it writes is the audit's (`access.previewed`), so who looked at what is kept.
import type { AccessPreview, PreviewAs } from '@crm/contracts';
import { listAttributes } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { countMatches } from '../engine/query/page.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { requirePermission } from './check.ts';
import { previewScope } from './door.ts';
import type { EngineScope } from './mint.ts';
import { fieldLevel, objectLevel } from './policy.ts';
import { inWorkspace } from './run.ts';

/**
 * The object as `as` would see it. Needs `access.manage`; a person or team of another workspace, or an object that
 * isn't here, is NOT_FOUND. An object the person can't see answers level `none` with nothing in it (hidden means
 * absent, to the preview as to them). The count is exact up to the engine's cap and says when it is only a floor
 * (`atLeast`); a count that takes too long is left out rather than failing the preview (`count` 0, `atLeast`). Writes
 * one `access.previewed` audit row, once the reads are done, and nothing else.
 */
export async function previewAccess(
  scope: EngineScope,
  input: { readonly objectId: string; readonly as: PreviewAs },
  options: { readonly source?: AuditSource } = {},
): Promise<AccessPreview> {
  requirePermission(scope, 'access.manage');
  const objectId = checkId(input.objectId, "That object doesn't exist.");
  const previewed = await previewScope(scope, input.as);
  const seen = previewed.scope;
  // An object that isn't here has no fields: NOT_FOUND, as everywhere.
  if ((await listAttributes(scope, objectId)).length === 0) throw refuse('NOT_FOUND', "That object doesn't exist.");
  const level = objectLevel(seen.access, objectId);
  const answer = await (async (): Promise<AccessPreview> => {
    if (level === 'none') return { name: previewed.name, level, fields: [], count: 0, atLeast: false };
    const attributes = await listAttributes(seen, objectId);
    const count = await countMatches(seen, { objectId }).catch((error: unknown) => {
      // Too slow or cancelled: the preview still shows the fields, with the count as unknown.
      if (isRefusal(error) && error.refusal.code === 'QUERY_CANCELLED') return { count: 0, atLeast: true };
      throw error;
    });
    return {
      name: previewed.name,
      level,
      fields: attributes.map((attribute) => ({
        id: attribute.id,
        title: attribute.title,
        canEdit:
          level === 'write' &&
          !attribute.isSystem &&
          fieldLevel(seen.access, { id: attribute.id, objectId }) === 'write',
      })),
      count: count.count,
      atLeast: count.atLeast,
    };
  })();
  const named = input.as.type === 'member' ? input.as.memberId : input.as.teamId;
  await inWorkspace(scope, (tx) =>
    writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'access.previewed',
        targetType: input.as.type === 'member' ? 'member' : 'team',
        targetId: named,
        after: { objectId, name: previewed.name },
      },
      options.source,
    ),
  );
  return answer;
}
