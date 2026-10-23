// The words of routing rules and Show when (spec 0043), in one place.
import type { ConditionOp, HiddenField } from '@crm/data/forms';

const OPS: Readonly<Record<ConditionOp, string>> = {
  is: 'is',
  is_not: 'is not',
  is_any_of: 'is any of',
  contains: 'contains',
  is_answered: 'is answered',
  is_empty: 'is empty',
  more_than: 'is more than',
  less_than: 'is less than',
};

/** The visit's hidden fields, named as a submission's Came from names them. */
const HIDDEN: Readonly<Record<HiddenField, string>> = {
  utm_source: 'UTM source',
  utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign',
  utm_term: 'UTM term',
  utm_content: 'UTM content',
  page: 'Page',
  referrer: 'Referrer',
};

export const strings = {
  // Conditions
  op: (op: ConditionOp) => OPS[op],
  when: 'When',
  and: 'and',
  or: 'or',
  join: 'Match',
  joinAll: 'All of these',
  joinAny: 'Any of these',
  fact: 'Reads',
  question: 'Question',
  questionOrField: 'Question or field',
  questionOrHidden: 'Question or hidden field',
  comparison: 'Comparison',
  value: 'Value',
  pickValue: 'Pick a value',
  pickValues: 'Pick values',
  pickFact: 'Pick a question',
  addCondition: 'Add a condition',
  removeCondition: (index: number) => `Remove condition ${String(index + 1)}`,
  yes: 'Yes',
  no: 'No',
  removedQuestion: 'A removed question',
  fieldOf: (side: 'person' | 'company', title: string) => `${side === 'person' ? 'Person' : 'Company'} · ${title}`,
  hiddenField: (field: HiddenField) => HIDDEN[field],
  // On a team page a hidden field is the one the sending form's visit brought.
  fromForm: (name: string) => `Form · ${name}`,
  // The heading the hidden fields sit under in the fact picker, after the questions or fields.
  hiddenFields: 'Hidden fields',
  hiddenFieldsFromForm: 'From the form',
  conditionsIncomplete: 'Finish each condition, or remove it.',

  // Show when on a question
  showWhen: 'Show when',
  showWhenHint: 'Show this question only when earlier answers match. Hidden answers are not kept.',
  alwaysShown: 'Always shown',
  addShowWhen: 'Add a condition',
  clearShowWhen: 'Always show it',
  noEarlier: 'Add a question before this one to show it by its answer.',
  readsLater: 'A condition reads a question that is no longer before this one. Pick another, or remove it.',
  shownWhen: (line: string) => `Shows when ${line}`,

  // Rules
  routing: 'Routing',
  formRoutingLine: (count: number) =>
    count === 0
      ? 'Send people somewhere else by their answers. Without a rule, After sending applies.'
      : `${String(count)} ${count === 1 ? 'rule' : 'rules'}, tried in order. When none matches, After sending applies.`,
  pageRoutingLine: (count: number) =>
    count === 0
      ? 'Pick who takes a booking by what you know about the visitor. Without a rule, the whole rotation shares them.'
      : `${String(count)} ${count === 1 ? 'rule' : 'rules'}, tried in order. When none matches, or nobody it picks is free, the whole rotation shares it.`,
  routingTip:
    'Rules are tried from the top; the first that matches decides. Use them to send qualified leads to a longer meeting and others to a message.',
  routingTipExample: 'When Budget is Over $10k, book Intro call with Sam or Bea, and tag Qualified.',
  addRule: 'Add a rule',
  ruleLimit: 'A form or page holds 20 rules.',
  ruleGone: 'This rule was removed meanwhile. Close it and add it again.',
  ruleTitle: (index: number, name: string | undefined) =>
    name === undefined || name === '' ? `Rule ${String(index + 1)}` : `${String(index + 1)}. ${name}`,
  ruleMore: (index: number) => `More for rule ${String(index + 1)}`,
  edit: 'Edit',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  /** The remove confirm's question: the rule by its name, or its place when it has none ("Remove rule 2?"). */
  removeTitle: (index: number, name: string | undefined) =>
    name === undefined || name === '' ? `Remove rule ${String(index + 1)}?` : `Remove “${name}”?`,
  removeText: 'Leads it would have matched go to the next rule, or where they go with no rule.',
  typeValue: 'Type a value',
  removeAction: 'Remove rule',
  cancel: 'Cancel',
  saving: 'Saving',
  saved: 'Routing saved',
  waitsForPublish: 'Changes here go live when you publish.',
  noPages: 'Make a booking page first, then send people to it.',

  // The rule dialog
  newRule: 'New rule',
  editRule: (title: string) => `Edit rule: ${title}`,
  name: 'Name',
  namePlaceholder: 'Enterprise',
  nameHint: 'Optional. Shown in the list and the report.',
  then: 'Then',
  routeKind: 'Send them to',
  routeBook: 'A booking page',
  routeMessage: 'A thank you message',
  routeRedirect: 'Another web page',
  page: 'Booking page',
  pageItem: (title: string, minutes: number) => `${title} · ${String(minutes)} min`,
  hosts: 'Who can take it',
  hostsOptional: 'Who can take it (none picked: anyone in the rotation)',
  poolEmpty: 'Add people to this page’s rotation first, then pick who takes these leads.',
  noQuestions: 'Add a question to the form first.',
  noFields: 'The person’s and company’s fields couldn’t be read. Reload the page to try again.',
  hostsHint: 'Only these people get the booking. When none of them is free, the rotation picks.',
  hostsAll: 'Anyone in the rotation',
  hostsNeeded: 'Pick at least one person.',
  message: 'Message',
  messageHint: 'Shown after they send the form.',
  bookingMessage: 'Message before booking',
  url: 'Web page address',
  urlInvalid: 'Give a full address that starts with https://.',
  tag: 'Tag the lead',
  tagNone: 'No tag',
  tagQualified: 'Qualified',
  tagNotQualified: 'Not qualified',
  save: 'Save rule',
  addRuleAction: 'Add rule',

  // Summaries
  routeLine: (route: string, tag: string | undefined) => (tag === undefined ? route : `${route} · ${tag}`),
  toPage: (title: string, hosts: readonly string[]) =>
    hosts.length === 0 ? `Book ${title}` : `Book ${title} with ${hosts.join(' or ')}`,
  toMessage: 'Show a message',
  toRedirect: (url: string) => `Go to ${url}`,
  toHosts: (hosts: readonly string[]) => `Only ${hosts.join(' or ')}`,
  missingPage: 'a removed page',

  // The report
  report: 'Report',
  reportWindow: 'Period',
  days: (days: number) => `Last ${String(days)} days`,
  reportRule: 'Rule',
  matched: 'Matched',
  booked: 'Booked',
  noShow: 'No show',
  qualified: 'Qualified',
  fallback: 'None matched',
  removedRule: 'A removed rule',
  reportEmpty: 'Nothing routed yet',
  reportEmptyText: 'Counts show here once leads are routed.',
  reportFailed: 'The report couldn’t load.',
  share: (count: number, of: number) =>
    of === 0 ? String(count) : `${String(count)} (${String(Math.round((count / of) * 100))}%)`,
};
