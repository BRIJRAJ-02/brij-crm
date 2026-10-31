// Lead routing's one format (spec 0043, AC-1601 to AC-1604, AC-1608): an
// ordered list of rules, each "when these answers or fields match, then this
// route", the first match deciding and the surface's own setting the
// fallback. Forms keep theirs in the version document; team booking pages on
// the page. The evaluator is `matchesShowWhen` (`show-when.ts`, no Zod).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { CONDITION_OPS, CONDITIONS_MAX, isHiddenFact, NUMBER_OPS, RECORD_FACT, VALUELESS_OPS } from './show-when.ts';
import { QUESTION_KEY } from './answer-types.ts';
import { Uuid, uuidWith } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/**
 * A condition's fact key: a question key, `person.<attributeId>` / `company.<attributeId>`, or one of the visit's
 * hidden fields (`hidden.utm_source`). Which of them a surface may read is the publish and save checks' call.
 */
export const FactKey = z
  .string()
  .max(80)
  .refine((key) => QUESTION_KEY.test(key) || RECORD_FACT.test(key) || isHiddenFact(key), {
    error: 'Pick a question or a field.',
  });

/** A condition's typed value: at most 200 characters. */
const RuleValueText = z.string().trim().max(200, { error: 'Keep the value to 200 characters.' });

/** One condition (AC-1602): a value fitting its operator. */
export const ConditionSchema = z
  .strictObject({
    key: FactKey,
    op: z.enum(CONDITION_OPS),
    value: z
      .union([
        RuleValueText,
        z.array(RuleValueText).min(1, { error: 'Pick at least one.' }).max(20, { error: 'Pick 20 or fewer.' }),
      ])
      .optional(),
  })
  .superRefine((condition, context) => {
    const blank =
      condition.value === undefined ||
      (typeof condition.value === 'string' ? condition.value === '' : condition.value.length === 0);
    if (VALUELESS_OPS.includes(condition.op)) return;
    if (blank) context.addIssue({ code: 'custom', path: ['value'], message: 'Give a value to compare with.' });
    else if (NUMBER_OPS.includes(condition.op)) {
      const text = typeof condition.value === 'string' ? condition.value : '';
      if (!Number.isFinite(Number(text.replaceAll(',', ''))) || text === '') {
        context.addIssue({ code: 'custom', path: ['value'], message: 'Give a number.' });
      }
    }
  });

/** Conditions joined by all or any: 1 to 5 (AC-1036, AC-1601). */
export const ShowWhenSchema = z.strictObject({
  join: z.enum(['all', 'any']),
  rules: z
    .array(ConditionSchema)
    .min(1, { error: 'Add a condition.' })
    .max(CONDITIONS_MAX, { error: `Use at most ${String(CONDITIONS_MAX)} conditions.` }),
});

/** At most this many rules on one form or one team page (AC-1601). */
export const ROUTING_RULES_MAX = 20;
/** At most this many hosts a route narrows to (AC-1604, AC-1608). */
export const ROUTE_HOSTS_MAX = 8;

/** Some members of a team page's rotations: one is a specific host. */
export const RouteHosts = z
  .array(Uuid)
  .min(1, { error: 'Pick at least one person.' })
  .max(ROUTE_HOSTS_MAX, { error: `Pick at most ${String(ROUTE_HOSTS_MAX)} people.` });

/** An https address a rule sends visitors to (http only for localhost, for local testing). */
const RouteUrl = z
  .url({ error: 'Give a full address that starts with https://.' })
  .max(2_048)
  .refine(
    (value) => {
      // Zod runs this even after `.url()` refused the value: a throw here would answer a typed address with a 500.
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    },
    { error: 'Give a full address that starts with https://.' },
  );

/**
 * Where a rule sends a lead. A form's rules use `book` (a booking page, the
 * meeting type, optionally only some of a team page's hosts), `message` or
 * `redirect`; a team page's rules use `hosts`.
 */
export const Route = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('book'),
    bookingPageId: uuidWith('Pick a booking page.'),
    hosts: RouteHosts.optional(),
    message: z.string().trim().max(2_000, { error: 'Keep the message to 2,000 characters.' }).default(''),
  }),
  z.strictObject({
    kind: z.literal('message'),
    message: z.string().trim().max(2_000, { error: 'Keep the message to 2,000 characters.' }).default(''),
  }),
  z.strictObject({ kind: z.literal('redirect'), url: RouteUrl }),
  z.strictObject({ kind: z.literal('hosts'), hosts: RouteHosts }),
]);
/** Where a rule sends a lead. */
export type Route = z.infer<typeof Route>;

/** A rule's id inside its list: stable across edits and reorders, the report's key. */
export const RuleId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'A rule id is 1 to 40 letters or digits.' });

/** One routing rule (AC-1601). `qualified` tags the lead: true, false, or absent for no tag. */
export const RoutingRule = z.strictObject({
  id: RuleId,
  name: z.string().trim().max(60, { error: 'Keep a rule’s name to 60 characters.' }).optional(),
  when: ShowWhenSchema,
  then: Route,
  qualified: z.boolean().optional(),
});
/** One routing rule. */
export type RoutingRule = z.infer<typeof RoutingRule>;

/** A surface's rules, in order; the first match decides, none means the surface's own fallback. */
export const RoutingRules = z
  .strictObject({
    rules: z
      .array(RoutingRule)
      .max(ROUTING_RULES_MAX, { error: `Use at most ${String(ROUTING_RULES_MAX)} rules.` })
      .default([]),
  })
  .superRefine((routing, context) => {
    const ids = new Set<string>();
    routing.rules.forEach((rule, index) => {
      if (ids.has(rule.id))
        context.addIssue({ code: 'custom', path: ['rules', index, 'id'], message: 'Two rules share one id.' });
      ids.add(rule.id);
    });
  });
/** A surface's rules. */
export type RoutingRules = z.infer<typeof RoutingRules>;
/** A surface's rules as written, before defaults. */
export type RoutingRulesInput = z.input<typeof RoutingRules>;

/** The routes a form's rules may take (AC-1604). */
export const FORM_ROUTES: readonly Route['kind'][] = ['book', 'message', 'redirect'];
/** The routes a team page's rules may take (AC-1608). */
export const PAGE_ROUTES: readonly Route['kind'][] = ['hosts'];

/** The report's windows, in days (AC-1612). */
export const ROUTING_REPORT_WINDOWS = [30, 90] as const;

/** One row of a surface's report: a rule (or the fallback, `ruleId` absent) and its counts in the window. */
export const RoutingReportRow = z.object({
  /** Absent for the fallback; a rule since deleted keeps its id here, and the screen calls it a removed rule. */
  ruleId: z.string().optional(),
  matched: z.number().int().min(0),
  booked: z.number().int().min(0),
  noShow: z.number().int().min(0),
  qualified: z.number().int().min(0),
  notQualified: z.number().int().min(0),
});
/** One row of a surface's report. */
export type RoutingReportRow = z.infer<typeof RoutingReportRow>;

/** `routing.report`'s input: a form or a team page, and the window. */
export const RoutingReportInput = WorkspaceScoped.extend({
  surface: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('form'), formId: Uuid }),
    z.object({ kind: z.literal('booking_page'), pageId: Uuid }),
  ]),
  days: z.union([z.literal(30), z.literal(90)]).default(30),
});
/** `routing.report`'s input. */
export type RoutingReportInput = z.input<typeof RoutingReportInput>;

/** A surface's report: one row per rule that decided in the window, and the fallback's. */
export const RoutingReport = z.object({
  days: z.number().int(),
  rows: z.array(RoutingReportRow),
});
/** A surface's report. */
export type RoutingReport = z.infer<typeof RoutingReport>;

/**
 * One thing that happened beyond the rule (spec 0037, AC-1358), in order: a page with no free time in the next 14
 * days, the form's After someone sends it used instead, the visitor told someone will contact them, or the free time
 * not checked (it took past 2.5 seconds, or a calendar couldn't be read).
 */
export const RoutingStep = z.object({
  kind: z.enum(['no_free_time', 'fallback', 'contact', 'unchecked']),
  pageId: Uuid.optional(),
  reason: z.enum(['timeout', 'calendar']).optional(),
});
/** One step of a decision. */
export type RoutingStep = z.infer<typeof RoutingStep>;

/** How far the free time check at submit looks ahead, in days (spec 0037's Numbers). */
export const FREE_TIME_DAYS = 14;
/** The longest the free time check at submit may take before the route is answered unchecked (AC-1380). */
export const FREE_TIME_LIMIT_MS = 2_500;
/** What a visitor reads when no page a form would send them to has free time (AC-1358). */
export const NO_FREE_TIME_MESSAGE = 'Thanks. Someone from our team will contact you.';

/** What a surface does when no rule matches: a page (by name), a message, a link, or the page's whole rotation. */
export const RoutingFallback = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), pageId: Uuid, name: z.string() }),
  z.object({ kind: z.literal('message') }),
  z.object({ kind: z.literal('redirect') }),
  z.object({ kind: z.literal('rotation') }),
]);
/** What a surface does when no rule matches. */
export type RoutingFallback = z.infer<typeof RoutingFallback>;

/** One routed surface on Routing › Overview (AC-1383): its rules, its fallback and the last 30 days' counts. */
export const RoutingSurface = z.object({
  kind: z.enum(['form', 'booking_page']),
  id: Uuid,
  name: z.string(),
  /** The workspace link (migration 0128), always listed, first. */
  isWorkspaceLink: z.boolean(),
  /** `live`, `paused`, or for a form `draft` (never published) and `archived`. */
  status: z.string(),
  rules: z.number().int().min(0),
  /** Each rule by id and name, in order, for the Decisions filter; one over a field hidden from the reader has none. */
  ruleList: z.array(z.object({ id: z.string(), name: z.string().optional() })),
  fallback: RoutingFallback,
  /** Decisions in the last 30 days that a rule (not the fallback) made. */
  matched: z.number().int().min(0),
  /** Decisions in the last 30 days that led to a booking. */
  booked: z.number().int().min(0),
});
/** One routed surface. */
export type RoutingSurface = z.infer<typeof RoutingSurface>;

/** Routing › Overview: the workspace link first, then every form and team page with rules. */
export const RoutingOverview = z.object({ surfaces: z.array(RoutingSurface) });
/** Routing › Overview. */
export type RoutingOverview = z.infer<typeof RoutingOverview>;

/** The most decisions one page of Routing › Decisions holds. */
export const ROUTING_DECISIONS_PAGE = 50;

/** `routing.decisions`' filters (AC-1383) and its cursor. */
export const RoutingDecisionsInput = WorkspaceScoped.extend({
  surfaceId: Uuid.optional(),
  /** A rule's id, or `fallback` for decisions no rule made. */
  ruleId: z.union([RuleId, z.literal('fallback')]).optional(),
  hostId: Uuid.optional(),
  qualified: z.enum(['yes', 'no', 'none']).optional(),
  /** Days, `YYYY-MM-DD`, inclusive, read in UTC. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
});
/** `routing.decisions`' input. */
export type RoutingDecisionsInput = z.infer<typeof RoutingDecisionsInput>;

/** A decision's step as the log shows it: with the page's name. */
export const RoutingStepView = RoutingStep.extend({ pageName: z.string().optional() });
/** A decision's step as the log shows it. */
export type RoutingStepView = z.infer<typeof RoutingStepView>;

/**
 * One decision as Routing › Decisions shows it (AC-1375): names and outcomes only, no record fact, and only when the
 * reader may see the person it was for.
 */
export const RoutingDecision = z.object({
  id: Uuid,
  decidedAt: z.string(),
  surface: z.object({ kind: z.enum(['form', 'booking_page']), id: Uuid, name: z.string() }),
  /**
   * The rule that decided: its place and name in the surface's rules now, neither once it is removed, and `hidden`
   * (no place, no name) when it reads a field the reader can't see. Absent: the fallback.
   */
  rule: z
    .object({
      id: z.string(),
      position: z.number().int().min(1).optional(),
      name: z.string().optional(),
      hidden: z.literal(true).optional(),
    })
    .optional(),
  qualified: z.boolean().optional(),
  /** The page a form sent the visitor to. */
  routedPage: z.object({ id: Uuid, name: z.string() }).optional(),
  /** The hosts the decision narrowed to, by name. */
  hosts: z.array(z.object({ id: Uuid, name: z.string() })),
  /** The booking that followed, with its host and start. */
  booking: z
    .object({ id: Uuid, hostName: z.string(), startsAt: z.string(), status: z.string(), noShow: z.boolean() })
    .optional(),
  /** Who it was for: the booking's visitor, or the form's lead, by name. */
  guest: z.string().optional(),
  steps: z.array(RoutingStepView),
  /** Rules passed over because a fact couldn't be read, by place ("Rule 2"). */
  skipped: z.array(z.string()),
});
/** One decision. */
export type RoutingDecision = z.infer<typeof RoutingDecision>;

/** A page of decisions, newest first, and the cursor for the next. */
export const RoutingDecisionPage = z.object({ decisions: z.array(RoutingDecision), next: z.string().optional() });
/** A page of decisions. */
export type RoutingDecisionPage = z.infer<typeof RoutingDecisionPage>;

/** `routing.decision`'s input. */
export const RoutingDecisionInput = WorkspaceScoped.extend({ id: Uuid });
/** `routing.decision`'s input. */
export type RoutingDecisionInput = z.infer<typeof RoutingDecisionInput>;

/**
 * Lead routing's procedures (spec 0043; spec 0037 L6): the per rule report for a surface's editors, and for holders
 * of `routing.manage` the Overview and the Decisions log across every surface. Rules are saved with their form or page.
 */
export const routingContract = {
  report: oc.input(RoutingReportInput).output(RoutingReport),
  overview: oc.input(WorkspaceScoped).output(RoutingOverview),
  decisions: oc.input(RoutingDecisionsInput).output(RoutingDecisionPage),
  decision: oc.input(RoutingDecisionInput).output(RoutingDecision),
};
