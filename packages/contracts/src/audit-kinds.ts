// `@crm/contracts/audit-kinds`: the kinds of change Settings › History groups the
// audit log's actions into (spec 0046), as plain lists with no Zod, so the
// browser's History screen can name a row's kind without pulling the schema
// library into its load. `audit.test.ts` pins that the kinds and the not
// listed set hold every action in `AUDIT_ACTIONS` exactly once.
import type { AuditAction } from './team.ts';

/** The kinds of change, in the order History's filter lists them (milestone 2). */
export const AUDIT_KIND_NAMES = ['people', 'joining', 'workspace', 'security', 'scheduling'] as const;

/** One kind of change. */
export type AuditKindName = (typeof AUDIT_KIND_NAMES)[number];

/**
 * Each kind's actions. A new audited action lands in exactly one kind (or in
 * `AUDIT_NOT_LISTED`), with its sentence in the History screen, or a test fails.
 */
export const AUDIT_KINDS = {
  people: [
    'member.role_changed',
    'member.removed',
    'member.left',
    'workspace.ownership_transferred',
    'account.deleted',
    'member.profile_updated',
  ],
  joining: [
    'invitation.created',
    'invitation.resent',
    'invitation.revoked',
    'invitation.accepted',
    'invitation.link_set',
    'invitation.link_revoked',
    'workspace.domains_set',
    'join_request.created',
    'join_request.approved',
    'join_request.declined',
  ],
  workspace: ['workspace.updated', 'workspace.deleted', 'workspace.restored'],
  security: [
    'workspace_security.changed',
    'workspace_security.signed_out_everyone',
    'webhook.created',
    'webhook.updated',
    'webhook.secret_rotated',
    'webhook.deleted',
    'webhook.turned_off',
  ],
  scheduling: [
    'rotation.adjusted',
    'rotation.adjustment_undone',
    'booking.reassigned',
    'booking.no_show',
    'booking.no_show_undone',
    'routing.changed',
    'form.owner_changed',
    'form.notify_changed',
    'booking.record_linked',
    'booking.record_unlinked',
    'delegation.granted',
    'delegation.changed',
    'delegation.revoked',
    // Someone's scheduling changed (spec 0037, AC-1263), their own included.
    'schedule.changed',
    'block.created',
    'block.removed',
    'time_off.created',
    'time_off.changed',
    'time_off.deleted',
    'limits.changed',
    'calendar.reconnect_asked',
    'booking.changed_for',
  ],
} as const satisfies Record<AuditKindName, readonly AuditAction[]>;

/**
 * Actions stored but never listed in Workspace changes (spec 0046, owner
 * decision 7): a member's own display preferences are their choice, not a
 * workspace change, and would be the noisiest rows. The order of the
 * sections on a member's own profile page is the same kind of choice, and a
 * drag writes one row per drop.
 */
export const AUDIT_NOT_LISTED = [
  'member.preferences_changed',
  'booking_page.profile_reordered',
] as const satisfies readonly AuditAction[];

/** An action Workspace changes lists: every catalog action outside `AUDIT_NOT_LISTED`. */
export type ListedAuditAction = (typeof AUDIT_KINDS)[AuditKindName][number];

/** How many rows a page of Workspace changes holds unless the caller asks for fewer. */
export const AUDIT_PAGE = 50;

/** The kind an action is listed under, or undefined for one that isn't listed. */
export function auditKindOf(action: string): AuditKindName | undefined {
  return AUDIT_KIND_NAMES.find((kind) => (AUDIT_KINDS[kind] as readonly string[]).includes(action));
}
