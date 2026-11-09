// What a change to a link page does beside the change itself, in the change's own transaction. The page's own owner
// editing it shows it the first time (`showLinkPage`, spec 0058, AC-23). A team page manager editing someone else's
// (spec 0070, `isTeamPageEdit`) never shows it, and writes the History row instead (AC-7004), so a change that commits
// always has its row and a change that rolls back has none.
import type { LinkPageTeamChange } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { isTeamPageEdit } from '../access/door.ts';
import { showLinkPage } from '../booking/handles.ts';
import type { EngineScope } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';

/**
 * After a write to `owner`'s link page in `workspace`, inside its transaction: the owner's own edit shows the page
 * (once, never over their Private choice); someone else's writes one `link_page.changed_for` row naming what changed,
 * with the manager as actor and the member as target.
 */
export async function touchLinkPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  owner: string,
  workspace: string,
  change: LinkPageTeamChange,
): Promise<void> {
  const { principal } = scope.access;
  if (isTeamPageEdit(scope) && principal.kind === 'member') {
    await writeAudit(tx, workspace, scope.actor, {
      action: 'link_page.changed_for',
      targetType: 'member',
      targetId: principal.memberId,
      after: { change },
    });
    return;
  }
  // A change no editor of the page makes (search engines on or off, the QR's style) never shows it.
  if (change === 'blocks' || change === 'look') await showLinkPage(tx, owner, workspace);
}
