// The audit log's kinds (spec 0046, AC-4605): every catalog action is listed in
// exactly one kind, or is the one not listed; and the list input and entry
// shapes refuse what they don't know.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_KIND_NAMES,
  AUDIT_KINDS,
  AUDIT_NOT_LISTED,
  AuditEntryView,
  AuditListInput,
  auditKindOf,
} from './audit.ts';
import { AUDIT_ACTIONS } from './team.ts';

describe('the kinds of change', () => {
  it('hold every AUDIT_ACTIONS entry exactly once, or leave it in AUDIT_NOT_LISTED', () => {
    const placed = [...AUDIT_KIND_NAMES.flatMap((kind) => AUDIT_KINDS[kind]), ...AUDIT_NOT_LISTED];
    expect([...placed].sort()).toEqual([...AUDIT_ACTIONS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('leaves a member’s own preferences and profile order out, and names each listed action’s kind', () => {
    expect(AUDIT_NOT_LISTED).toEqual([
      'member.preferences_changed',
      'booking_page.profile_reordered',
      // A preview (spec 0032, AC-858) is stored and never listed.
      'access.previewed',
      // A merge (spec 0049) reads on the kept record's timeline instead.
      'record.merged',
    ]);
    // Spec 0037's scheduling rows (AC-1263) are listed with their sentences since J5.
    expect(auditKindOf('schedule.changed')).toBe('scheduling');
    expect(auditKindOf('booking.changed_for')).toBe('scheduling');
    expect(auditKindOf('member.preferences_changed')).toBeUndefined();
    expect(auditKindOf('form.owner_changed')).toBe('scheduling');
    expect(auditKindOf('booking.record_linked')).toBe('scheduling');
    expect(auditKindOf('invitation.revoked')).toBe('joining');
    expect(auditKindOf('workspace_security.changed')).toBe('security');
  });
});

describe('audit.list’s input', () => {
  it('pages 50 by default, 1 to 100, and refuses a key it doesn’t know', () => {
    expect(AuditListInput.parse({ workspace: 'acme' })).toEqual({ workspace: 'acme', limit: 50 });
    expect(AuditListInput.safeParse({ workspace: 'acme', limit: 0 }).success).toBe(false);
    expect(AuditListInput.safeParse({ workspace: 'acme', limit: 101 }).success).toBe(false);
    expect(AuditListInput.safeParse({ workspace: 'acme', cursor: 'x'.repeat(201) }).success).toBe(false);
    expect(AuditListInput.safeParse({ workspace: 'acme', person: { kind: 'system' } }).success).toBe(false);
  });
});

describe('an entry', () => {
  const base = {
    id: '0199f0a0-0000-7000-8000-000000000001',
    at: '2026-10-23T06:52:11.123456Z',
    actor: { kind: 'system' },
    changes: [],
  };
  const booking = { type: 'booking', id: '0199f0a0-0000-7000-8000-000000000002', isGone: false };

  it('takes the database’s microseconds, and a record link row names the booking only', () => {
    expect(
      AuditEntryView.safeParse({ ...base, action: 'booking.record_linked', target: booking, params: {} }).success,
    ).toBe(true);
    // A record id can't ride along in the target or the params.
    expect(
      AuditEntryView.safeParse({
        ...base,
        action: 'booking.record_linked',
        target: { ...booking, recordId: '0199f0a0-0000-7000-8000-000000000003' },
        params: {},
      }).success,
    ).toBe(false);
    expect(
      AuditEntryView.safeParse({
        ...base,
        action: 'booking.record_unlinked',
        target: booking,
        params: { recordId: '0199f0a0-0000-7000-8000-000000000003' },
      }).success,
    ).toBe(false);
  });

  it('refuses a raw before or after, an IP, or an action outside the listed ones', () => {
    const renamed = {
      ...base,
      action: 'workspace.updated',
      target: { type: 'workspace' },
      params: { fields: ['name'], from: 'Acme', to: 'Acme Ltd' },
    };
    expect(AuditEntryView.safeParse(renamed).success).toBe(true);
    expect(AuditEntryView.safeParse({ ...renamed, before: { name: 'Acme' } }).success).toBe(false);
    expect(AuditEntryView.safeParse({ ...renamed, ip: '10.0.0.1' }).success).toBe(false);
    expect(
      AuditEntryView.safeParse({ ...base, action: 'member.preferences_changed', target: { type: 'workspace' } })
        .success,
    ).toBe(false);
  });
});
