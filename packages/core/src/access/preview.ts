// "Preview as" (spec 0032, AC-858): an admin sees an object as a member, or someone in a team, would. Every read goes
// through the real door's policy with that person's access (`previewScope`): their fields (hidden ones are simply
// absent), how many records they see, and the first few by name. Nothing here writes a record, and the scope it reads
// with never leaves this file. The one row it writes is the audit's (`access.previewed`), so who looked at what is kept.
import { PREVIEW_SAMPLE, type AccessPreview, type PreviewAs } from '@crm/contracts';
import { listAttributes } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { countMatches, queryPage } from '../engine/query/page.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { requirePermission } from './check.ts';
import { previewScope } from './door.ts';
import type { EngineScope } from './mint.ts';
import { fieldLevel, objectLevel } from './policy.ts';
import { inWorkspace } from './run.ts';

/**
 * The object as `as` would see it. Needs `access.manage`; a person or team of another workspace, or an object that
 * isn't here, is NOT_FOUND. An object the person can't see answers level `none` with nothing in it (hidden means
 * absent, to the preview as to them). Writes one `access.previewed` audit row and nothing else.
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
  // An object that isn't here (or one the previewer can't see) has no fields: NOT_FOUND, as everywhere.
  if ((await listAttributes(scope, objectId)).length === 0) throw refuse('NOT_FOUND', "That object doesn't exist.");
  const level = objectLevel(seen.access, objectId);
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
  if (level === 'none') return { name: previewed.name, level, fields: [], count: 0, sample: [] };
  const attributes = await listAttributes(seen, objectId);
  const fields = attributes.map((attribute) => ({
    id: attribute.id,
    title: attribute.title,
    canEdit:
      level === 'write' && !attribute.isSystem && fieldLevel(seen.access, { id: attribute.id, objectId }) === 'write',
  }));
  const [count, page] = await Promise.all([
    countMatches(seen, { objectId }),
    queryPage(seen, { objectId, limit: PREVIEW_SAMPLE, attributeIds: [] }),
  ]);
  return {
    name: previewed.name,
    level,
    fields,
    count: count.count,
    sample: page.records.slice(0, PREVIEW_SAMPLE).map((record) => ({ id: record.id, name: record.display.name })),
  };
}
