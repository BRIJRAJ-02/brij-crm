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
  showWhenHint: 'Hidden answers aren’t kept.',
  alwaysShown: 'Always shown',
  addShowWhen: 'Add a condition',
  clearShowWhen: 'Always show it',
  noEarlier: 'Add an earlier question first.',
  readsLater: 'A condition uses a later question. Pick another, or remove it.',
  shownWhen: (line: string) => `Shows when ${line}`,

  // Rules
  routing: 'Routing',
  formRoutingLine: (count: number) =>
    count === 0
      ? 'Send people elsewhere by their answers.'
      : `${String(count)} ${count === 1 ? 'rule' : 'rules'}, top first. No match: After sending applies.`,
  pageRoutingLine: (count: number) =>
    count === 0
      ? 'Pick who takes a booking by the visitor’s answers.'
      : `${String(count)} ${count === 1 ? 'rule' : 'rules'}, top first. No match: the whole rotation shares it.`,
  routingTip: 'The first rule that matches decides.',
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
  /** What removing a rule does, in the card's own words for where people go when no rule matches. */
  removeText: (kind: 'form' | 'page') =>
    kind === 'form'
      ? 'Its leads go to the next rule, or After sending.'
      : 'Its leads go to the next rule, or the whole rotation.',
  typeValue: 'Set value…',
  removeAction: 'Remove rule',
  cancel: 'Cancel',
  saving: 'Saving',
  saved: 'Routing saved',
  waitsForPublish: 'Live on publish.',
  noPages: 'Make a booking page first, then send people to it.',

  // The rule dialog
  newRule: 'New rule',
  editRule: (title: string) => `Edit rule: ${title}`,
  name: 'Name',
  namePlaceholder: 'Enterprise',
  nameHint: 'Optional.',
  then: 'Then',
  routeKind: 'Send them to',
  routeBook: 'A booking page',
  routeMessage: 'A thank you message',
  routeRedirect: 'Another web page',
  page: 'Booking page',
  pageItem: (title: string, minutes: number) => `${title} · ${String(minutes)} min`,
  hosts: 'Who can take it',
  hostsOptional: 'Who can take it (none: anyone)',
  poolEmpty: 'Add people to this page’s rotation first.',
  noQuestions: 'Add a question to the form first.',
  noFields: 'Couldn’t read the fields. Reload the page.',
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
  reportFailed: 'The report couldn’t load.',
  share: (count: number, of: number) =>
    of === 0 ? String(count) : `${String(count)} (${String(Math.round((count / of) * 100))}%)`,
};
