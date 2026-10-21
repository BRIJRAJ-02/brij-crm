// Lead routing's one format (spec 0043, AC-1601 to AC-1604, AC-1608): an
// ordered list of rules, each "when these answers or fields match, then this
// route", the first match deciding and the surface's own setting the
// fallback. Forms keep theirs in the version document; team booking pages on
// the page. The evaluator is `matchesShowWhen` (`show-when.ts`, no Zod).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { CONDITION_OPS, CONDITIONS_MAX, NUMBER_OPS, RECORD_FACT, VALUELESS_OPS } from './show-when.ts';
import { QUESTION_KEY } from './answer-types.ts';
import { Uuid, uuidWith } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** A condition's fact key: a question key, or `person.<attributeId>` / `company.<attributeId>`. */
export const FactKey = z
  .string()
  .max(80)
  .refine((key) => QUESTION_KEY.test(key) || RECORD_FACT.test(key), { error: 'Pick a question or a field.' });

/** One condition (AC-1602): a value fitting its operator. */
export const ConditionSchema = z
  .strictObject({
    key: FactKey,
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().trim().max(200), z.array(z.string().trim().max(200)).min(1).max(20)]).optional(),
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
    message: z.string().trim().max(2_000).default(''),
  }),
  z.strictObject({ kind: z.literal('message'), message: z.string().trim().max(2_000).default('') }),
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

/** Lead routing's procedures (spec 0043): the per rule report; rules are saved with their form or page. */
export const routingContract = {
  report: oc.input(RoutingReportInput).output(RoutingReport),
};
