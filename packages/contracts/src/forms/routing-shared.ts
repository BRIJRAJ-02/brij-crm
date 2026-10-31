// What every routed surface shares (spec 0037, L7): skills and who holds them, the workspace's routing settings
// (Won means, AC-1385) and Test (AC-1392). Skills are read by any member (a team page's editor picks them in a host
// route); every write, the settings and Test need `routing.manage`.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { QUESTION_KEY } from './answer-types.ts';
import { SKILL_GROUPS, SKILL_NAME_MAX, SKILLS_MAX } from './routing-limits.ts';
import { RoutingFallback, routingLogContract } from './routing.ts';
import { isHiddenFact, KNOWN_VALUES } from './show-when.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** A skill's group. */
export const SkillGroup = z.enum(SKILL_GROUPS);
/** A skill's group. */
export type SkillGroup = z.infer<typeof SkillGroup>;

/** A skill's name: trimmed, 1 to 40 characters, unique in its group ignoring case (the server checks that). */
export const SkillName = z
  .string()
  .trim()
  .min(1, { error: 'Give the skill a name.' })
  .max(SKILL_NAME_MAX, { error: `Keep a skill’s name to ${String(SKILL_NAME_MAX)} characters.` });

/** One skill (AC-1382). */
export const RoutingSkill = z.object({
  id: Uuid,
  group: SkillGroup,
  name: z.string(),
  position: z.number().int(),
});
/** One skill. */
export type RoutingSkill = z.infer<typeof RoutingSkill>;

/** One member's skills, by id. */
export const MemberSkills = z.object({ memberId: Uuid, skillIds: z.array(Uuid) });
/** One member's skills. */
export type MemberSkills = z.infer<typeof MemberSkills>;

/**
 * The workspace's skills and who holds them: every active member who holds any, and whether Won means is set (so a
 * team page's editor is offered Known's Customer only then, AC-1393).
 */
export const SkillsView = z.object({
  skills: z.array(RoutingSkill),
  members: z.array(MemberSkills),
  wonMeansSet: z.boolean(),
});
/** The workspace's skills and who holds them. */
export type SkillsView = z.infer<typeof SkillsView>;

/** A new skill, under the id the screen minted. */
export const CreateSkillInput = WorkspaceScoped.extend({
  id: Uuid,
  group: SkillGroup,
  name: SkillName,
  mutationId: Uuid,
});
/** A new skill. */
export type CreateSkillInput = z.infer<typeof CreateSkillInput>;

/** A skill renamed or moved to another group. */
export const UpdateSkillInput = WorkspaceScoped.extend({
  id: Uuid,
  group: SkillGroup.optional(),
  name: SkillName.optional(),
  mutationId: Uuid,
});
/** A skill changed. */
export type UpdateSkillInput = z.infer<typeof UpdateSkillInput>;

/** A skill deleted: refused 409 `SKILL_IN_USE` while a host route names it. */
export const DeleteSkillInput = WorkspaceScoped.extend({ id: Uuid, mutationId: Uuid });
/** A skill deleted. */
export type DeleteSkillInput = z.infer<typeof DeleteSkillInput>;

/** One member's skills, replaced. */
export const SetMemberSkillsInput = WorkspaceScoped.extend({
  memberId: Uuid,
  skillIds: z
    .array(Uuid)
    .max(SKILLS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Pick each skill once.' }),
  mutationId: Uuid,
});
/** One member's skills, replaced. */
export type SetMemberSkillsInput = z.infer<typeof SetMemberSkillsInput>;

/** Won means (AC-1385): the Deals stage field and the stages that count as won. */
export const WonStage = z.strictObject({
  attributeId: Uuid,
  optionIds: z
    .array(Uuid)
    .min(1, { error: 'Pick at least one stage.' })
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Pick each stage once.' }),
});
/** Won means. */
export type WonStage = z.infer<typeof WonStage>;

/** The workspace's routing settings (AC-1351): absent fields are the defaults; `updatedAt` absent until first set. */
export const RoutingSettings = z.object({
  wonStage: WonStage.optional(),
  updatedAt: z.string().optional(),
});
/** The workspace's routing settings. */
export type RoutingSettings = z.infer<typeof RoutingSettings>;

/** The settings changed: `wonStage` null clears it; `updatedAt` as read, or 409 `STALE`. */
export const SetRoutingSettingsInput = WorkspaceScoped.extend({
  wonStage: WonStage.nullable(),
  updatedAt: z.string().max(40).optional(),
  mutationId: Uuid,
});
/** The settings changed. */
export type SetRoutingSettingsInput = z.infer<typeof SetRoutingSettingsInput>;

/** A typed answer Test runs: one value, or several for a choice that takes many. */
const TestAnswer = z.union([z.string().max(200), z.array(z.string().max(200)).max(20)]);

/** Routing › Test's input (AC-1392): a form or a team page, typed answers by key, and an email. */
export const RoutingTestInput = WorkspaceScoped.extend({
  surface: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('form'), formId: Uuid }),
    z.object({ kind: z.literal('booking_page'), pageId: Uuid }),
  ]),
  answers: z
    .record(
      z.string().refine((key) => QUESTION_KEY.test(key) || isHiddenFact(key), { error: 'Pick a question.' }),
      TestAnswer,
    )
    .refine((answers) => Object.keys(answers).length <= 60, { error: 'Answer at most 60 questions.' }),
  email: z.email({ error: 'Give an email address.' }).max(320).optional(),
  mutationId: Uuid,
});
/** Routing › Test's input. */
export type RoutingTestInput = z.infer<typeof RoutingTestInput>;

/** A member or a skill as Test names them. */
const Named = z.object({ id: Uuid, name: z.string() });

/**
 * What Test found (AC-1392): the rule that would decide (absent: the fallback, `fallback`), its tag, the rules skipped
 * as unreadable, where it would send the lead, and, on a team page with an email, what the CRM knows of them.
 */
export const RoutingTestResult = z.object({
  rule: z.object({ id: z.string(), position: z.number().int().min(1), name: z.string().optional() }).optional(),
  qualified: z.boolean().optional(),
  /** By place: "Rule 2". */
  skipped: z.array(z.string()),
  route: z
    .object({
      kind: z.enum(['book', 'message', 'redirect', 'hosts']),
      page: Named.optional(),
      message: z.string().optional(),
      url: z.string().optional(),
      /** The named members, or the members holding the required skills now. */
      hosts: z.array(Named),
      /** The skills required, by name. */
      skills: z.array(Named),
      /** True when the route names skills nobody in the rotation holds: the whole rotation would pick. */
      wholeRotation: z.boolean(),
    })
    .optional(),
  fallback: RoutingFallback.optional(),
  known: z.enum(KNOWN_VALUES).optional(),
});
/** What Test found. */
export type RoutingTestResult = z.infer<typeof RoutingTestResult>;

/**
 * Lead routing's procedures: the report, Overview and Decisions (L6), then skills, member skills, the settings and
 * Test (L7). Skills are listed for any member; the rest need `routing.manage`.
 */
export const routingContract = {
  ...routingLogContract,
  skills: {
    list: oc.input(WorkspaceScoped).output(SkillsView),
    create: oc.input(CreateSkillInput).output(SkillsView),
    update: oc.input(UpdateSkillInput).output(SkillsView),
    delete: oc.input(DeleteSkillInput).output(SkillsView),
  },
  memberSkills: {
    set: oc.input(SetMemberSkillsInput).output(SkillsView),
  },
  settings: {
    get: oc.input(WorkspaceScoped).output(RoutingSettings),
    set: oc.input(SetRoutingSettingsInput).output(RoutingSettings),
  },
  test: oc.input(RoutingTestInput).output(RoutingTestResult),
};
