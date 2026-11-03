// A page's published versions (spec 0068, AC-6812): the next one kept, the oldest past the last 20 let go. Apart from
// `publish.ts` so a new page keeps its first version as it is made (`createBookingPage`), with no import between the
// page services and Publish going both ways.
import { PAGE_VERSIONS_KEPT } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';

const { pageVersions } = schema;

/** The member a version names, or null for anyone else (an API key, the system). */
export function publisherOf(scope: EngineScope): string | null {
  const { principal } = scope.access;
  return principal.kind === 'member' ? principal.memberId : null;
}

/**
 * Keeps `snapshot` as the page's next version and lets go of those past the last 20. The page row is locked by the
 * caller, so two publishes of one page never take the same number.
 */
export async function keepVersion(
  tx: WorkspaceTx,
  scope: EngineScope,
  pageId: string,
  snapshot: object,
  now: Date,
): Promise<number> {
  const [last] = await tx
    .select({ version: pageVersions.version })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageKind, 'booking'), eq(pageVersions.pageId, pageId)))
    .orderBy(desc(pageVersions.version))
    .limit(1);
  const version = (last?.version ?? 0) + 1;
  await tx.insert(pageVersions).values({
    workspaceId: scope.workspaceId,
    pageKind: 'booking',
    pageId,
    version,
    snapshot,
    publishedByMemberId: publisherOf(scope),
    publishedAt: now,
  });
  await tx
    .delete(pageVersions)
    .where(
      and(
        eq(pageVersions.pageKind, 'booking'),
        eq(pageVersions.pageId, pageId),
        lt(pageVersions.version, version - PAGE_VERSIONS_KEPT + 1),
      ),
    );
  return version;
}
