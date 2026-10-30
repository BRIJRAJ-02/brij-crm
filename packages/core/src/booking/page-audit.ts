// A personal booking page changed by someone other than its owner (spec 0037, AC-1263, AC-1264): the
// `booking_page.changed_for` audit row keeps the before and after of the fields that changed, so the owner's
// notice can say what is different ("Intro call: location changed from Video call to Phone"). The row's target is
// the owner (`target_type = 'member'`), so the notice reads it with the owner's other scheduling rows.
import type { BookingPageSettings } from '@crm/contracts';

/** The fields a page's audit row compares, in the order the notice lists them. */
export const PAGE_AUDIT_FIELDS = [
  'title',
  'status',
  'durations',
  'location',
  'scheduleId',
  'bufferBefore',
  'bufferAfter',
  'minNoticeMinutes',
  'windowDays',
  'dailyLimit',
  'slotStep',
  'isPrivate',
  'description',
  'questions',
  'rescheduleHost',
  'defaultView',
  'fileToCrm',
  'answersObjectId',
] as const;

/** One of the fields a page's audit row compares. */
export type PageAuditField = (typeof PAGE_AUDIT_FIELDS)[number];

/** What a page's audit row keeps of one field: plain values, never an address, a note or a question's text. */
export type PageAuditValue = string | number | boolean | null | readonly number[];

/** A page as its audit compares it: the settings, plus the name of the schedule it books by. */
export type PageAudited = Pick<BookingPageSettings, Exclude<PageAuditField, 'questions'>> & {
  readonly questions: readonly unknown[];
  readonly scheduleName: string;
};

/** The longest description an audit row keeps. */
const DESCRIPTION_KEPT = 200;

/** One field as the row keeps it: a location by its kind, the questions by their count, a description cut short. */
function kept(page: PageAudited, field: PageAuditField): PageAuditValue {
  switch (field) {
    case 'location':
      return page.location.type;
    case 'questions':
      return page.questions.length;
    case 'description':
      return page.description.slice(0, DESCRIPTION_KEPT);
    case 'durations':
      return [...page.durations];
    default:
      return page[field];
  }
}

/** One side of a `booking_page.changed_for` row. */
export interface PageAuditSide {
  readonly memberId: string;
  readonly pageId: string;
  readonly title: string;
  /** The schedule's name, beside `scheduleId` when that changed. */
  readonly scheduleName?: string;
  /** Set on the after side of a deleted page. */
  readonly deleted?: true;
  readonly fields: Partial<Record<PageAuditField, PageAuditValue>>;
}

/**
 * The two sides of a page's audit row (pure): only the fields that changed, or undefined when none did. `after`
 * undefined is the page deleted.
 */
export function pageAuditSides(
  owner: string,
  pageId: string,
  before: PageAudited,
  after: PageAudited | undefined,
): { readonly before: PageAuditSide; readonly after: PageAuditSide } | undefined {
  if (after === undefined) {
    return {
      before: { memberId: owner, pageId, title: before.title, fields: {} },
      after: { memberId: owner, pageId, title: before.title, deleted: true, fields: {} },
    };
  }
  const was: Partial<Record<PageAuditField, PageAuditValue>> = {};
  const now: Partial<Record<PageAuditField, PageAuditValue>> = {};
  for (const field of PAGE_AUDIT_FIELDS) {
    const from = kept(before, field);
    const to = kept(after, field);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    was[field] = from;
    now[field] = to;
  }
  if (Object.keys(now).length === 0) return undefined;
  const named = 'scheduleId' in now;
  return {
    before: {
      memberId: owner,
      pageId,
      title: before.title,
      ...(named ? { scheduleName: before.scheduleName } : {}),
      fields: was,
    },
    after: {
      memberId: owner,
      pageId,
      title: after.title,
      ...(named ? { scheduleName: after.scheduleName } : {}),
      fields: now,
    },
  };
}
