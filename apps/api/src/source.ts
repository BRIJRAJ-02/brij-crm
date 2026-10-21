// Where a request came from, for the audit log (spec 0031, AC-830): every
// membership, role, invitation, team and workspace change writes its row with
// the request's id and the client's IP, the latter only when the edge vouched
// for it.
import type { AuditSource } from '@crm/core';
import type { RequestContext } from './orpc.ts';

/** The request's id, and the IP only when the edge vouched for it. */
export function sourceOf(context: Pick<RequestContext, 'requestId' | 'clientIp'>): AuditSource {
  return { requestId: context.requestId, ...(context.clientIp === undefined ? {} : { ip: context.clientIp }) };
}
