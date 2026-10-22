import { deleteWorkspace, getWorkspaceSettings, updateWorkspace, type WorkspaceDeletion } from '@crm/core';
import { renderWorkspaceDeleted } from '@crm/emails';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Settings › Workspace › General (spec 0031, slice 7, AC-822, AC-823): inside a workspace, behind the member door.
// The directory's copy of the name and its deleted mark follow once the tenant change commits (see
// `RequestContext.directory`); a failure there is logged and leaves only the switcher's label stale.

/** Runs a directory write that follows a committed change, logging (never throwing) a failure. */
export async function followInDirectory(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    log.error(`The directory missed a ${what}`, errorFields(error));
    captureFault(error, { task: `directory-${what}` });
  }
}

/** A day as the email writes it: "19 November 2026", in UTC (the purge runs on UTC days). */
export function noticeDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/**
 * Emails every active member that the workspace was deleted (AC-823), one at
 * a time, never throwing: a failed send is logged without the address.
 * Owners also get the way back to restore it within the window.
 */
async function tellMembersDeleted(
  context: Pick<RequestContext, 'mailer' | 'appUrl' | 'requestId'>,
  deletion: WorkspaceDeletion,
): Promise<void> {
  const { name, slug, purgeAfter } = deletion.deleted;
  const until = noticeDay(purgeAfter);
  const appOrigin = new URL(context.appUrl).origin;
  for (const person of deletion.notify) {
    if (person.email === '') continue;
    try {
      const message = await renderWorkspaceDeleted(
        { deletedBy: deletion.deletedBy, until, ...(person.isOwner ? { restorePath: `/w/${slug}` } : {}) },
        { appOrigin, workspaceName: name },
      );
      await context.mailer.send({ to: person.email, ...message });
    } catch (error) {
      log.error('A workspace deleted email was not sent', {
        requestId: context.requestId,
        mail: context.mailer.transport,
        ...errorFields(error),
      });
      captureFault(error, { task: 'workspace-deleted-mail' });
    }
  }
}

/** The open workspace's own settings, and the owner's delete. */
export const workspaceRouter = member.workspace.router({
  get: member.workspace.get.handler(({ context }) => getWorkspaceSettings(context.scope)),
  update: member.workspace.update.handler(async ({ context, input }) => {
    const updated = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateWorkspace(
        context.scope,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          // A new address moves the directory inside the same transaction (migration 0082), so nothing follows it.
          ...(input.slug === undefined ? {} : { slug: input.slug }),
        },
        hooks,
        sourceOf(context),
      ),
    );
    if (updated.renamed) {
      await followInDirectory('rename', () =>
        context.directory.renameWorkspace(context.scope.workspaceId, updated.settings.name),
      );
    }
    return updated.settings;
  }),
  delete: member.workspace.delete.handler(async ({ context, input }) => {
    const deletion = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteWorkspace(context.scope, { confirmName: input.confirmName }, hooks, sourceOf(context)),
    );
    await followInDirectory('delete', () => context.directory.setWorkspaceDeleted(context.scope.workspaceId, true));
    // Each member is told (AC-823), after the commit and without holding up the answer; on Vercel the instance stays
    // up until the last one is sent.
    context.keepAlive(tellMembersDeleted(context, deletion));
    return deletion.deleted;
  }),
});
