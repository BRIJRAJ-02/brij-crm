// The words of Bookings › Routing (spec 0037, L6): Overview and Decisions. Short labels; the explanation of each
// decision is built from what happened, never a paragraph of help.
import type { RoutingFallback, RoutingStepView } from '@crm/data';

export const strings = {
  views: 'Routing view',
  overview: 'Overview',
  decisions: 'Decisions',

  // Overview
  surfacesTable: 'Routed forms and pages',
  name: 'Name',
  rules: 'Rules',
  fallback: 'No rule matches',
  matched: 'Matched',
  booked: 'Booked',
  last30: 'Last 30 days',
  actions: 'Actions',
  editRules: 'Edit rules',
  editRulesOf: (name: string) => `Edit rules of ${name}`,
  kind: { form: 'Form', booking_page: 'Team page' } as const,
  workspaceLink: 'Workspace link',
  paused: 'Paused',
  draft: 'Draft',
  fallbackOf: (fallback: RoutingFallback) =>
    fallback.kind === 'page'
      ? fallback.name || 'A booking page'
      : fallback.kind === 'rotation'
        ? 'Whole rotation'
        : fallback.kind === 'redirect'
          ? 'Web page'
          : 'Message',
  emptyTitle: 'Nothing routes yet',
  newTeamPage: 'New team page',
  decisionsOf: (name: string) => `Decisions of ${name}`,
  failedTitle: 'Routing couldn’t load',
  failedText: 'Check your connection and try again.',

  // Decisions
  decisionsTable: 'Routing decisions',
  when: 'When',
  surface: 'Form or page',
  outcome: 'Outcome',
  guest: 'Guest',
  booking: 'Booking',
  anySurface: 'All forms and pages',
  anyRule: 'Any rule',
  noneMatched: 'None matched',
  anyHost: 'Any host',
  host: 'Host',
  tag: 'Qualified',
  anyTag: 'Any tag',
  qualified: 'Qualified',
  notQualified: 'Not qualified',
  noTag: 'No tag',
  period: 'Period',
  anyTime: 'Any time',
  today: 'Today',
  days: (count: number) => `Last ${String(count)} days`,
  rule: 'Rule',
  ruleLabel: (position: number | undefined, name: string | undefined, hidden: boolean | undefined) =>
    hidden === true
      ? 'A rule'
      : position === undefined
        ? 'A removed rule'
        : name === undefined
          ? `Rule ${String(position)}`
          : `Rule ${String(position)} · ${name}`,
  sentTo: (page: string) => `Sent to ${page}`,
  withHosts: (hosts: readonly string[]) => hosts.join(' or '),
  notBooked: '–',
  cancelled: 'Cancelled',
  noShow: 'No show',
  noDecisions: 'No decisions yet',
  noMatch: 'No decisions match',
  clearFilters: 'Clear filters',
  showMore: 'Show more',
  tryAgain: 'Try again',
  moreFailed: 'Couldn’t load more. Try again.',

  // The explanation
  details: 'Decision',
  decidedAt: 'Decided',
  steps: 'What happened',
  skipped: 'Skipped',
  skippedLine: (labels: readonly string[]) => `${labels.join(', ')}: a field couldn’t be read`,
  bookedWith: (host: string) => `Booked with ${host}`,
  step: (step: RoutingStepView) => {
    const page = step.pageName ?? 'The page';
    switch (step.kind) {
      case 'no_free_time':
        return `${page} had no free time in 14 days`;
      case 'fallback':
        return step.pageId === undefined ? 'Used After sending' : `Used After sending: ${page}`;
      case 'contact':
        return 'Told someone will contact them';
      case 'unchecked':
        return step.reason === 'timeout'
          ? 'Free time not checked: took too long'
          : 'Free time not checked: a calendar couldn’t be read';
    }
  },
};
