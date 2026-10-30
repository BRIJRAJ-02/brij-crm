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

/** What a field rule can say: read only, or hidden. A field with no rule is as open as its object (AC-846). */
export const FIELD_RULE_LEVELS = ['read', 'hidden'] as const;
/** What a field rule can say: read only, or hidden. */
export const FieldRuleLevel = z.enum(FIELD_RULE_LEVELS);
/** What a field rule can say. */
export type FieldRuleLevel = z.infer<typeof FieldRuleLevel>;

/** A subject's field rules on an object: attribute id to level; a field not named is as open as the object. */
export const FieldRules = z.record(Uuid, FieldRuleLevel);
/** A subject's field rules on an object. */
export type FieldRules = z.infer<typeof FieldRules>;

/** One subject's standing on an object. */
export const SubjectAccess = z.object({
  subject: RuleSubject,
  level: ObjectAccessLevel,
  records: RecordScope,
  /** What the subject gets with no rule at all: a role's default (members edit), nothing for a team. */
  defaultLevel: ObjectAccessLevel,
  /** True while no rule is stored (the subject is at its default); a team row always has one. */
  isDefault: z.boolean(),
  /** Its field rules on the object; a field not named is as open as the object's level. */
  fields: FieldRules,
  /** How many active people the subject covers. */
  people: z.number().int().nonnegative(),
});
/** One subject's standing on an object. */
export type SubjectAccess = z.infer<typeof SubjectAccess>;

/** The field a record scope reads: the object's Owner (or its first Member field). */
export const OwnerAttribute = z.object({ id: Uuid, title: z.string() });
/** The field a record scope reads. */
export type OwnerAttribute = z.infer<typeof OwnerAttribute>;

/** A field an object's access rules can name: a live attribute, with whether it is the record's name (never hidden). */
export const RuleField = z.object({ id: Uuid, title: z.string(), isPrimary: z.boolean() });
/** A field an object's access rules can name. */
export type RuleField = z.infer<typeof RuleField>;

/** An object's access: each rule role in the roles list's order, then each team with a rule. */
export const ObjectAccess = z.object({
  objectId: Uuid,
  /** The object's live fields in their order, for the field checklist. */
  fields: z.array(RuleField),
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
  rule: z
    .object({
      level: ObjectAccessLevel,
      records: RecordScope,
      /** Replaces the subject's field rules; left out, they stay as they are. */
      fields: FieldRules.optional(),
    })
    .nullable(),
  mutationId: Uuid,
});
/** Setting one subject's access to an object. */
export type SetObjectAccessInput = z.infer<typeof SetObjectAccessInput>;

/**
 * What a change takes away from people who had it (spec 0032, AC-850): how many people lose some access (a lower
 * level, fewer records, a field hidden or made read only), how many shared views name a field that went from some of
 * them, and how many live forms file onto one. All zero for a change that only opens things up.
 */
export const AccessImpact = z.object({
  people: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  forms: z.number().int().nonnegative(),
});
/** What a change takes away. */
export type AccessImpact = z.infer<typeof AccessImpact>;

/** What a set answers: the object's access as it stands, and what the change took away. */
export const SetObjectAccessResult = z.object({ access: ObjectAccess, impact: AccessImpact });
/** What a set answers. */
export type SetObjectAccessResult = z.infer<typeof SetObjectAccessResult>;

/** Who "Preview as" shows the object to: a person, or someone in a team (a Member who is in it). */
export const PreviewAs = z.discriminatedUnion('type', [
  z.object({ type: z.literal('member'), memberId: Uuid }),
  z.object({ type: z.literal('team'), teamId: Uuid }),
]);
/** Who "Preview as" shows the object to. */
export type PreviewAs = z.infer<typeof PreviewAs>;

/** Previewing an object as someone. */
export const AccessPreviewInput = ObjectAccessRead.extend({ as: PreviewAs });
/** Previewing an object as someone. */
export type AccessPreviewInput = z.infer<typeof AccessPreviewInput>;

/**
 * The object as someone sees it, read through the access door as them (spec 0032, AC-858): what they may do, the
 * fields they have (hidden ones are absent) and how many records they see (`atLeast` when that is only a floor).
 * Never a write.
 */
export const AccessPreview = z.object({
  /** Who is shown: the person's name, or the team's. */
  name: z.string(),
  level: ObjectAccessLevel,
  fields: z.array(z.object({ id: Uuid, title: z.string(), canEdit: z.boolean() })),
  count: z.number().int().nonnegative(),
  atLeast: z.boolean(),
});
/** The object as someone sees it. */
export type AccessPreview = z.infer<typeof AccessPreview>;

/** The access rules namespace; every one needs `access.manage`. */
export const accessRulesContract = {
  get: oc.input(ObjectAccessRead).output(ObjectAccess),
  set: oc.input(SetObjectAccessInput).output(SetObjectAccessResult),
  preview: oc.input(AccessPreviewInput).output(AccessPreview),
};
