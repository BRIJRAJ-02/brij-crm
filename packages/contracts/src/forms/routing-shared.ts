// What every routed surface shares (spec 0037, L7): skills and who holds them, the workspace's routing settings
// (Won means, AC-1385) and Test (AC-1392). Skills are read by any member (a team page's editor picks them in a host
// route); every write, the settings and Test need `routing.manage`.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { QUESTION_KEY } from './answer-types.ts';
import {
  FIT_LINKS_MAX,
  HOLDOUT_PERCENT_MAX,
  OBJECTIVES,
  SEGMENT_ATTRIBUTES_MAX,
  SKILL_GROUPS,
  SKILL_NAME_MAX,
  SKILLS_MAX,
  SMART_MODES,
  TILT_PERCENT_MAX,
} from './routing-limits.ts';
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

/** The smart ranking's mode (AC-1361): Off is plain fairness, Fit the lead's skills, Learn adds the track record. */
export const SmartMode = z.enum(SMART_MODES);
/** The smart ranking's mode. */
export type SmartMode = z.infer<typeof SmartMode>;

/**
 * One fit link (AC-1362): an option of a select or status field on People, Companies or Deals joined to a skill
 * ("Preferred language is Spanish" to the Spanish skill). A link applies when the lead holds that option.
 */
export const FitLink = z.strictObject({ attributeId: Uuid, optionId: Uuid, skillId: Uuid });
/** One fit link. */
export type FitLink = z.infer<typeof FitLink>;

/** The workspace's fit links, each pair named once, at most 100 (spec 0037's Numbers). */
export const FitLinks = z
  .array(FitLink)
  .max(FIT_LINKS_MAX, { error: `Keep fit to ${String(FIT_LINKS_MAX)} links.` })
  .refine(
    (links) =>
      new Set(links.map((link) => `${link.attributeId}:${link.optionId}:${link.skillId}`)).size === links.length,
    { error: 'Link each option to a skill once.' },
  );
/** The workspace's fit links. */
export type FitLinks = z.infer<typeof FitLinks>;

/** The fairness allowance, a whole 0 to 50 percent (AC-1363). */
export const TiltPercent = z
  .number()
  .int({ error: 'Use a whole number of percent.' })
  .min(0, { error: 'Use 0 to 50 percent.' })
  .max(TILT_PERCENT_MAX, { error: 'Use 0 to 50 percent.' });
/** The fairness allowance. */
export type TiltPercent = z.infer<typeof TiltPercent>;

/** The holdout, a whole 0 to 20 percent of ranked decisions (AC-1389). */
export const HoldoutPercent = z
  .number()
  .int({ error: 'Use a whole number of percent.' })
  .min(0, { error: 'Use 0 to 20 percent.' })
  .max(HOLDOUT_PERCENT_MAX, { error: 'Use 0 to 20 percent.' });
/** The holdout. */
export type HoldoutPercent = z.infer<typeof HoldoutPercent>;

/** The segment attributes (AC-1370): at most two select or status fields of Companies or Deals, each named once. */
export const SegmentAttributeIds = z
  .array(Uuid)
  .max(SEGMENT_ATTRIBUTES_MAX, { error: 'Pick at most two fields.' })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Pick each field once.' });
/** The segment attributes. */
export type SegmentAttributeIds = z.infer<typeof SegmentAttributeIds>;

/** A team page's learning objective (AC-1354): Deals created, Deals won, or Meetings held. */
export const RoutingObjective = z.enum(OBJECTIVES);
/** A team page's learning objective. */
export type RoutingObjective = z.infer<typeof RoutingObjective>;

/** The workspace's routing settings (AC-1351): absent fields are the defaults; `updatedAt` absent until first set. */
export const RoutingSettings = z.object({
  wonStage: WonStage.optional(),
  /** Absent until first set: the workspace runs `SMART_MODE_DEFAULT`. */
  smartMode: SmartMode.optional(),
  tiltPercent: TiltPercent.optional(),
  fit: FitLinks.optional(),
  holdoutPercent: HoldoutPercent.optional(),
  segmentAttributeIds: SegmentAttributeIds.optional(),
  learnSince: z.iso.date().optional(),
  /** The model the lift comes from; 0 until a nightly run has trained one. Read only. */
  modelVersion: z.number().int().min(0).optional(),
  /** When the last run finished. Read only. */
  modelTrainedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
/** The workspace's routing settings. */
export type RoutingSettings = z.infer<typeof RoutingSettings>;

/**
 * The settings changed: a field left out stays as it is, `wonStage` null clears it; `updatedAt` as read, or 409
 * `STALE`. One procedure for every lane's settings, so two tabs never write past each other.
 */
export const SetRoutingSettingsInput = WorkspaceScoped.extend({
  wonStage: WonStage.nullable().optional(),
  smartMode: SmartMode.optional(),
  tiltPercent: TiltPercent.optional(),
  fit: FitLinks.optional(),
  holdoutPercent: HoldoutPercent.optional(),
  segmentAttributeIds: SegmentAttributeIds.optional(),
  /** `null` clears Learn from, so every outcome in the window counts again. */
  learnSince: z.iso.date().nullable().optional(),
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

/** `routing.insights`' input (AC-1376): how many weeks of ranked bookings to count; absent is the learning window. */
export const RoutingInsightsInput = WorkspaceScoped.extend({
  weeks: z.number().int().min(1).max(52).optional(),
});
/** `routing.insights`' input. */
export type RoutingInsightsInput = z.infer<typeof RoutingInsightsInput>;

/** One member's row in a cell (AC-1376): their trials, their smoothed rate, their share, and their marking rate. */
export const InsightsMember = z.object({
  memberId: Uuid,
  name: z.string(),
  trials: z.number().int().min(0),
  successes: z.number().int().min(0),
  /** Their smoothed rate, 0 to 1 (AC-1369). */
  rate: z.number(),
  /**
   * How far their smoothed rate sits above or below the team's, in rate units (0.04 is four percentage points).
   * Absent while the cell is cold or the lead's segment was unknown, so the screen says "—" rather than 0, which
   * would read as a judgement on the rep rather than "we aren't using this yet".
   */
  lift: z.number().optional(),
  /** Their share of the cell's trials, 0 to 1, against `fairShare`, an equal share of them. */
  share: z.number(),
  fairShare: z.number(),
  /**
   * How often they mark a meeting of theirs a no show, 0 to 1, over the window (AC-1376); undefined when they
   * hosted none, so nothing is read into a rate over no meetings.
   */
  markingRate: z.number().optional(),
});
/** One member's row in a cell. */
export type InsightsMember = z.infer<typeof InsightsMember>;

/** One learning cell (AC-1369): a page's rotation and segment, for the page's current objective. */
export const InsightsCell = z.object({
  rotationId: Uuid,
  rotationName: z.string(),
  /** `*` for all segments, `?` for a lead missing a value, else the canonical key. */
  segmentKey: z.string(),
  /** The key in words: "All leads", "No value", or "Segment is Enterprise". */
  label: z.string(),
  trials: z.number().int().min(0),
  successes: z.number().int().min(0),
  /** Bookings counted but still inside their outcome window. */
  waiting: z.number().int().min(0),
  /** The cell's team rate, 0 to 1. */
  teamRate: z.number(),
  /** True once the cell has `WARM_TRIALS` finished trials: only then is its lift read. */
  isWarm: z.boolean(),
  /** The earliest day the cell could warm, from the bookings already waiting; absent when it is warm. */
  readyFrom: z.iso.date().optional(),
  members: z.array(InsightsMember),
});
/** One learning cell. */
export type InsightsCell = z.infer<typeof InsightsCell>;

/** One arm of the holdout comparison (AC-1389): its trials, successes, rate and a 90 percent interval. */
export const InsightsArm = z.object({
  trials: z.number().int().min(0),
  successes: z.number().int().min(0),
  rate: z.number(),
  /** The 90 percent interval's ends, 0 to 1; equal to `rate` with no trials. */
  low: z.number(),
  high: z.number(),
});
/** One arm of the comparison. */
export type InsightsArm = z.infer<typeof InsightsArm>;

/** One team page on Insights (AC-1376): its objective, its ranked bookings, its cells and its comparison. */
export const InsightsPage = z.object({
  pageId: Uuid,
  name: z.string(),
  objective: RoutingObjective,
  /** Ranked decisions in the window. */
  ranked: z.number().int().min(0),
  cells: z.array(InsightsCell),
  /** Picks the ranking moved, picks it left where fairness had them, and the holdout (AC-1389). */
  changed: InsightsArm,
  leftAlone: InsightsArm,
  holdout: InsightsArm,
  /** True when the comparison's intervals overlap, so "not yet certain". */
  isCertain: z.boolean(),
});
/** One team page on Insights. */
export type InsightsPage = z.infer<typeof InsightsPage>;

/**
 * Routing › Insights (AC-1376, AC-1386, AC-1389): what the nightly run learned, per team page and segment, with
 * the holdout comparison and each member's numbers. `routing.manage` only.
 */
export const RoutingInsights = z.object({
  /** The model the cells come from; 0 before any run. */
  modelVersion: z.number().int().min(0),
  modelTrainedAt: z.string().optional(),
  /** Learn from (AC-1386): outcomes of bookings made before it are ignored. */
  learnSince: z.iso.date().optional(),
  /** The segment attributes now, by name (AC-1370). */
  segmentAttributes: z.array(z.object({ id: Uuid, name: z.string() })),
  /** True when the segment attributes changed since the run, so segment learning restarts (AC-1370). */
  segmentsRestarted: z.boolean(),
  /** How often the workspace's hosts mark a no show, 0 to 1, over the window; absent with no finished meetings. */
  teamMarkingRate: z.number().optional(),
  pages: z.array(InsightsPage),
});
/** Routing › Insights. */
export type RoutingInsights = z.infer<typeof RoutingInsights>;

/**
 * Lead routing's procedures: the report, Overview and Decisions (L6), then skills, member skills, the settings and
 * Test (L7), and Insights (L9). Skills are listed for any member; the rest need `routing.manage`.
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
  insights: oc.input(RoutingInsightsInput).output(RoutingInsights),
};
