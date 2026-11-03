// The shapes Insights' pure helpers take, from the data layer's types (spec 0067).
import type { InsightFunnel, InsightNumbers, InsightSession, InsightSource } from '@crm/data';

export type { InsightFunnel };

/** The numbers the tiles, chart and CSV read: a member's read and a share link's alike. */
export type InsightNumbersLike = Pick<InsightNumbers, 'from' | 'to' | 'grain' | 'totals' | 'previous' | 'buckets'>;

/** A sources row. */
export type InsightSourceRow = InsightSource;

/** A sessions row. */
export type InsightSessionRow = InsightSession;
