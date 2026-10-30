// Access rules by role and team (spec 0032, milestones 1 and 3): who may see and change an object's records. Each
// rule names a subject (the Member role, or one team) and gives it a level on the object (none, view or edit) and a
// record scope (all of its records, the ones it owns, or its team's). Owners and admins are never restricted.
// Where several apply to one person, the most open wins, so a role restricts and a team grants.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** What a subject may do with an object's records. */
export const OBJECT_ACCESS_LEVELS = ['none', 'read', 'write'] as const;
/** What a subject may do with an object's records: nothing (the object is absent), view, or edit. */
export const ObjectAccessLevel = z.enum(OBJECT_ACCESS_LEVELS);
/** What a subject may do with an object's records. */
export type ObjectAccessLevel = z.infer<typeof ObjectAccessLevel>;

/** Which of an object's records a subject sees. */
export const RECORD_SCOPES = ['all', 'own', 'team'] as const;
/** Which of an object's records a subject sees: all, the ones naming them, or the ones naming their team. */
export const RecordScope = z.enum(RECORD_SCOPES);
/** Which of an object's records a subject sees. */
export type RecordScope = z.infer<typeof RecordScope>;

/**
 * The roles a rule can be about: every role but the two that manage access, so owners and admins can never be locked
 * out of the data (spec 0032, AC-842, AC-843). Read from the roles list, so a role added there (Guest) is one more
 * subject here, and `ROLE_DEFAULT_LEVEL` below fails to compile until it says what that role gets with no rule.
 */
export const RuleRole = Role.exclude(['owner', 'admin']);
/** A role a rule can be about. */
export type RuleRole = z.infer<typeof RuleRole>;

/** What each rule role may do with an object it has no rule for (spec 0032, AC-844): members edit. */
export const ROLE_DEFAULT_LEVEL = {
  member: 'write',
} as const satisfies Record<RuleRole, ObjectAccessLevel>;

/** Who a rule is about: everyone with a role, or everyone in one team. Never one named person. */
export const RuleSubject = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), role: RuleRole }),
  z.object({ type: z.literal('team'), teamId: Uuid }),
]);
/** Who a rule is about. */
export type RuleSubject = z.infer<typeof RuleSubject>;

/** One subject's standing on an object. */
export const SubjectAccess = z.object({
  subject: RuleSubject,
  level: ObjectAccessLevel,
  records: RecordScope,
  /** What the subject gets with no rule at all: a role's default (members edit), nothing for a team. */
  defaultLevel: ObjectAccessLevel,
  /** True while no rule is stored (the subject is at its default); a team row always has one. */
  isDefault: z.boolean(),
  /** How many active people the subject covers. */
  people: z.number().int().nonnegative(),
});
/** One subject's standing on an object. */
export type SubjectAccess = z.infer<typeof SubjectAccess>;

/** The field a record scope reads: the object's Owner (or its first Member field). */
export const OwnerAttribute = z.object({ id: Uuid, title: z.string() });
/** The field a record scope reads. */
export type OwnerAttribute = z.infer<typeof OwnerAttribute>;

/** An object's access: each rule role in the roles list's order, then each team with a rule. */
export const ObjectAccess = z.object({
  objectId: Uuid,
  /** What `own` and `team` read; absent when the object has no Member field, so neither can be offered. */
  ownerAttribute: OwnerAttribute.optional(),
  subjects: z.array(SubjectAccess),
});
/** An object's access. */
export type ObjectAccess = z.infer<typeof ObjectAccess>;

/** Reading an object's access. */
export const ObjectAccessRead = WorkspaceScoped.extend({ objectId: Uuid });
/** Reading an object's access. */
export type ObjectAccessRead = z.infer<typeof ObjectAccessRead>;

/**
 * Setting one subject's access to an object. `rule` replaces what is stored; `null` clears it (a team row goes, the
 * Member role returns to its default).
 */
export const SetObjectAccessInput = ObjectAccessRead.extend({
  subject: RuleSubject,
  rule: z.object({ level: ObjectAccessLevel, records: RecordScope }).nullable(),
  mutationId: Uuid,
});
/** Setting one subject's access to an object. */
export type SetObjectAccessInput = z.infer<typeof SetObjectAccessInput>;

/** The access rules namespace; both need `access.manage`. */
export const accessRulesContract = {
  get: oc.input(ObjectAccessRead).output(ObjectAccess),
  set: oc.input(SetObjectAccessInput).output(ObjectAccess),
};
