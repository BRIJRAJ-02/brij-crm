// The audit log's one writer (spec 0031, AC-830): a row per membership, role,
// invitation and workspace change, inside the change's own transaction, so a
// rolled back change leaves no row and a committed one always has its row.
// Specs 0032 and 0033 write theirs through here too.
import { isIP } from 'node:net';
import type { AuditAction } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { actorRow, type Actor } from '../engine/scope.ts';

const { auditEvents } = schema;

/** Where a change came from, beside its actor: the request's id and the client's IP the edge vouched for. */
export interface AuditSource {
  readonly requestId?: string;
  readonly ip?: string;
}

/** One audited change: what happened, to what, and only the fields it changed, before and after. */
export interface AuditEntry {
  readonly action: AuditAction;
  readonly targetType:
    | 'member'
    | 'invitation'
    | 'workspace'
    | 'join_request'
    | 'rotation'
    | 'booking'
    | 'form'
    | 'booking_page'
    | 'team'
    | 'object'
    | 'list'
    | 'record';
  readonly targetId: string;
  /** Changed fields only, never a token, code or secret. */
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/** An IP as Postgres's `inet` takes it (v4 or v6), or nothing: anything else is dropped rather than failing the change. */
const ipOf = (ip: string | undefined): string | null => (ip !== undefined && isIP(ip) !== 0 ? ip : null);

/** Writes one audit row for `actor` in `tx` (the change's own transaction). */
export async function writeAudit(
  tx: WorkspaceTx,
  workspaceId: string,
  actor: Actor,
  entry: AuditEntry,
  source: AuditSource = {},
): Promise<void> {
  const by = actorRow(actor);
  await tx.insert(auditEvents).values({
    workspaceId,
    actorType: by.type,
    actorId: by.id,
    actorMemberId: by.memberId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: ipOf(source.ip),
    requestId: source.requestId?.slice(0, 200) ?? null,
  });
}
