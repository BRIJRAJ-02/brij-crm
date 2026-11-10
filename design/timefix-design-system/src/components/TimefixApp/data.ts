import type { FormQuestion } from '../HostedForm/answers.ts';
// The whole app's CRM data for the prototype: Northwind's team, the people, companies and deals they work, tasks, notes and the inbox.
// Bookings keeps its own state (BookingsFlow); everything else reads this. One pure reducer, new objects only.

/** Someone in the workspace. */
export interface Member { readonly id: string; readonly name: string; readonly email: string; readonly role: 'Owner' | 'Admin' | 'Member' | 'Guest'; readonly title: string }
/** The kinds of record the workspace keeps; custom objects add more. */
export type ObjectId = 'people' | 'companies' | 'deals';
/** A deal's stage, in pipeline order. */
export type Stage = 'Lead' | 'Qualified' | 'Proposal' | 'Won' | 'Lost';
export const STAGES: ReadonlyArray<Stage> = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];

export interface Company { readonly id: string; readonly name: string; readonly domain: string; readonly industry: string; readonly size: string; readonly city: string; readonly owner: string; readonly created: Date }
export interface Person { readonly id: string; readonly name: string; readonly email: string; readonly phone?: string; readonly title: string; readonly companyId?: string; readonly owner: string; readonly tags: ReadonlyArray<string>; readonly lastContact?: Date; readonly created: Date }
export interface Deal { readonly id: string; readonly name: string; readonly companyId: string; readonly contactId?: string; readonly stage: Stage; readonly amount: number; readonly owner: string; readonly close: Date; readonly created: Date }
/** Which record a task, note or comment belongs to. */
export interface RecordLink { readonly object: ObjectId; readonly id: string }

export interface AppTask { readonly id: string; readonly title: string; readonly done: boolean; readonly due?: Date; readonly assignee: string; readonly record?: RecordLink; readonly description?: string; readonly created: Date }
export interface AppNote { readonly id: string; readonly title: string; readonly body: string; readonly author: string; readonly record: RecordLink; readonly updated: Date }
/** One thing for you in the Inbox. */
export interface InboxItem {
  readonly id: string; readonly kind: 'mention' | 'reply' | 'assignment' | 'booking'; readonly actor: string; readonly text: string; readonly excerpt?: string;
  readonly at: Date; readonly read: boolean; readonly done: boolean; readonly record?: RecordLink; readonly taskId?: string;
}
/** A comment thread on a record. */
export interface Comment { readonly id: string; readonly record: RecordLink; readonly author: string; readonly body: string; readonly at: Date; readonly resolved: boolean; readonly replies: ReadonlyArray<{ readonly id: string; readonly author: string; readonly body: string; readonly at: Date }> }
/** A line on a record's timeline. */
export interface Activity { readonly id: string; readonly record: RecordLink; readonly kind: 'created' | 'changed' | 'call' | 'meeting' | 'note' | 'task' | 'email' | 'form'; readonly actor: string; readonly text: string; readonly at: Date }

/** A saved way to look at an object: its filters, sorts, columns and layout. Private views are only yours. */
export interface SavedView {
  readonly id: string; readonly name: string; readonly layout: 'table' | 'board';
  readonly filters: ReadonlyArray<{ readonly id: string; readonly field: string; readonly operator: string; readonly values: ReadonlyArray<string> }>;
  readonly sorts: ReadonlyArray<{ readonly field: string; readonly direction: 'ascending' | 'descending' }>;
  readonly hidden: ReadonlyArray<string>; readonly isPrivate?: boolean;
}

/** A list: records of one object gathered for a purpose, with the list's own fields (a stage, a priority, the next step). */
export interface ListEntry { readonly id: string; readonly recordId: string; readonly stage: string; readonly priority: 'High' | 'Medium' | 'Low'; readonly next: string; readonly added: Date }
export interface CrmList { readonly id: string; readonly name: string; readonly object: ObjectId; readonly stages: ReadonlyArray<string>; readonly entries: ReadonlyArray<ListEntry>; readonly oncePerRecord: boolean }

/** A form: its questions as you edit them, the live ones guests answer, where answers go and what happens after. */
export interface FormResponse { readonly id: string; readonly at: Date; readonly answers: Readonly<Record<string, string>>; readonly spam?: boolean; readonly personId?: string }
export interface AppForm {
  readonly id: string; readonly name: string; readonly slug: string; readonly status: 'draft' | 'live' | 'paused';
  readonly questions: ReadonlyArray<FormQuestion>; readonly live?: ReadonlyArray<FormQuestion>; readonly mode: 'one' | 'page';
  readonly saveTo: 'people' | 'none'; readonly owner: string; readonly after: { readonly kind: 'thanks' | 'booking'; readonly message: string };
  readonly responses: ReadonlyArray<FormResponse>; readonly views: number; readonly updated: Date;
}

/** The CRM side of the app. */
export interface AppState {
  readonly me: string;
  readonly members: ReadonlyArray<Member>;
  readonly people: ReadonlyArray<Person>;
  readonly companies: ReadonlyArray<Company>;
  readonly deals: ReadonlyArray<Deal>;
  readonly tasks: ReadonlyArray<AppTask>;
  readonly notes: ReadonlyArray<AppNote>;
  readonly inbox: ReadonlyArray<InboxItem>;
  readonly comments: ReadonlyArray<Comment>;
  readonly activity: ReadonlyArray<Activity>;
  /** Home's setup steps already done. */
  readonly setupDone: ReadonlyArray<string>;
  readonly setupHidden: boolean;
  readonly views: Readonly<Record<ObjectId, ReadonlyArray<SavedView>>>;
  readonly lists: ReadonlyArray<CrmList>;
  readonly forms: ReadonlyArray<AppForm>;
}

export type AppAction =
  | { readonly type: 'task/set'; readonly task: AppTask }
  | { readonly type: 'task/remove'; readonly id: string }
  | { readonly type: 'note/set'; readonly note: AppNote }
  | { readonly type: 'note/remove'; readonly id: string }
  | { readonly type: 'inbox/set'; readonly item: InboxItem }
  | { readonly type: 'inbox/all-read' }
  | { readonly type: 'person/set'; readonly person: Person }
  | { readonly type: 'company/set'; readonly company: Company }
  | { readonly type: 'deal/set'; readonly deal: Deal }
  | { readonly type: 'records/remove'; readonly object: ObjectId; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'records/restore'; readonly state: AppState }
  | { readonly type: 'comment/set'; readonly comment: Comment }
  | { readonly type: 'activity/add'; readonly activity: Activity }
  | { readonly type: 'setup/done'; readonly id: string }
  | { readonly type: 'setup/hide'; readonly hidden: boolean }
  | { readonly type: 'views/set'; readonly object: ObjectId; readonly views: ReadonlyArray<SavedView> }
  | { readonly type: 'list/set'; readonly list: CrmList }
  | { readonly type: 'list/remove'; readonly id: string }
  | { readonly type: 'form/set'; readonly form: AppForm }
  | { readonly type: 'form/remove'; readonly id: string };

const upsert = <T extends { readonly id: string }>(list: ReadonlyArray<T>, item: T): ReadonlyArray<T> => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]);

/** The one reducer: new objects only. */
export function appReducer(state: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'task/set': return { ...state, tasks: upsert(state.tasks, a.task) };
    case 'task/remove': return { ...state, tasks: state.tasks.filter((t) => t.id !== a.id) };
    case 'note/set': return { ...state, notes: upsert(state.notes, a.note) };
    case 'note/remove': return { ...state, notes: state.notes.filter((n) => n.id !== a.id) };
    case 'inbox/set': return { ...state, inbox: state.inbox.map((x) => (x.id === a.item.id ? a.item : x)) };
    case 'inbox/all-read': return { ...state, inbox: state.inbox.map((x) => ({ ...x, read: true })) };
    case 'person/set': return { ...state, people: upsert(state.people, a.person) };
    case 'company/set': return { ...state, companies: upsert(state.companies, a.company) };
    case 'deal/set': return { ...state, deals: upsert(state.deals, a.deal) };
    case 'records/remove': {
      const gone = new Set(a.ids);
      return a.object === 'people' ? { ...state, people: state.people.filter((x) => !gone.has(x.id)) }
        : a.object === 'companies' ? { ...state, companies: state.companies.filter((x) => !gone.has(x.id)) }
          : { ...state, deals: state.deals.filter((x) => !gone.has(x.id)) };
    }
    case 'records/restore': return a.state;
    case 'comment/set': return { ...state, comments: upsert(state.comments, a.comment) };
    case 'activity/add': return { ...state, activity: [a.activity, ...state.activity] };
    case 'setup/done': return state.setupDone.includes(a.id) ? state : { ...state, setupDone: [...state.setupDone, a.id] };
    case 'setup/hide': return { ...state, setupHidden: a.hidden };
    case 'views/set': return { ...state, views: { ...state.views, [a.object]: a.views } };
    case 'list/set': return { ...state, lists: state.lists.some((l) => l.id === a.list.id) ? state.lists.map((l) => (l.id === a.list.id ? a.list : l)) : [...state.lists, a.list] };
    case 'list/remove': return { ...state, lists: state.lists.filter((l) => l.id !== a.id) };
    case 'form/set': return { ...state, forms: upsert(state.forms, a.form) };
    case 'form/remove': return { ...state, forms: state.forms.filter((f) => f.id !== a.id) };
  }
}

let seq = 0;
/** A fresh id for something made in the prototype. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const dayAt = (now: Date, days: number, h = 9, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m);

/** Northwind: a small sales team selling to software companies, with a quarter's worth of records. */
export function northwindCrm(now = new Date()): AppState {
  const members: Member[] = [
    { id: 'u-priya', name: 'Priya Raman', email: 'priya@northwind.com', role: 'Owner', title: 'Head of sales' },
    { id: 'u-sam', name: 'Sam Kim', email: 'sam@northwind.com', role: 'Admin', title: 'Account executive' },
    { id: 'u-jo', name: 'Jo Mendes', email: 'jo@northwind.com', role: 'Member', title: 'Account executive' },
    { id: 'u-ava', name: 'Ava Chen', email: 'ava@northwind.com', role: 'Member', title: 'Sales development' },
  ];
  const c = (id: string, name: string, domain: string, industry: string, size: string, city: string, owner: string, ago: number): Company => ({ id, name, domain, industry, size, city, owner, created: dayAt(now, -ago) });
  const companies: Company[] = [
    c('c-acme', 'Acme Corp', 'acme.com', 'Manufacturing', '1,000+', 'Pune', 'Priya Raman', 90), c('c-globex', 'Globex', 'globex.io', 'Software', '201–500', 'Bengaluru', 'Sam Kim', 75),
    c('c-initech', 'Initech', 'initech.co', 'Fintech', '51–200', 'Mumbai', 'Jo Mendes', 60), c('c-umbrella', 'Umbrella Health', 'umbrella.health', 'Healthcare', '501–1,000', 'Hyderabad', 'Priya Raman', 52),
    c('c-hooli', 'Hooli', 'hooli.xyz', 'Software', '1,000+', 'Gurugram', 'Sam Kim', 40), c('c-pied', 'Pied Piper', 'piedpiper.com', 'Software', '11–50', 'Bengaluru', 'Ava Chen', 33),
    c('c-wayne', 'Wayne Logistics', 'wayne.in', 'Logistics', '201–500', 'Chennai', 'Jo Mendes', 21), c('c-stark', 'Stark Retail', 'stark.store', 'Retail', '51–200', 'Delhi', 'Ava Chen', 12),
  ];
  const p = (id: string, name: string, title: string, companyId: string | undefined, owner: string, tags: ReadonlyArray<string>, contactAgo: number | undefined, ago: number, phone?: string): Person => {
    const co = companies.find((x) => x.id === companyId);
    const email = `${name.split(' ')[0]?.toLowerCase() ?? 'hello'}@${co?.domain ?? 'gmail.com'}`;
    return { id, name, title, companyId, owner, tags, email, phone, lastContact: contactAgo === undefined ? undefined : dayAt(now, -contactAgo, 11), created: dayAt(now, -ago) };
  };
  const people: Person[] = [
    p('p-liam', 'Liam Ortiz', 'VP Operations', 'c-acme', 'Priya Raman', ['Decision maker'], 1, 88, '+91 98200 11001'),
    p('p-maria', 'Maria Bell', 'Procurement lead', 'c-acme', 'Priya Raman', ['Champion'], 4, 80),
    p('p-noor', 'Noor Haddad', 'CTO', 'c-globex', 'Sam Kim', ['Decision maker', 'Technical'], 2, 70, '+91 98200 11002'),
    p('p-ben', 'Ben Carter', 'Finance director', 'c-initech', 'Jo Mendes', ['Budget'], 9, 58),
    p('p-amara', 'Amara Okafor', 'Head of IT', 'c-umbrella', 'Priya Raman', ['Technical'], 6, 50),
    p('p-ravi', 'Ravi Shah', 'COO', 'c-umbrella', 'Priya Raman', ['Decision maker'], 14, 49),
    p('p-gavin', 'Gavin Belson', 'CEO', 'c-hooli', 'Sam Kim', ['Decision maker'], 20, 39),
    p('p-dinesh', 'Dinesh Chugtai', 'Engineering manager', 'c-pied', 'Ava Chen', ['Champion'], 3, 31),
    p('p-monica', 'Monica Hall', 'Partner', 'c-pied', 'Ava Chen', [], undefined, 30),
    p('p-lucius', 'Lucius Fox', 'Operations head', 'c-wayne', 'Jo Mendes', ['Decision maker'], 5, 20),
    p('p-pepper', 'Pepper Potts', 'CEO', 'c-stark', 'Ava Chen', ['Decision maker'], 2, 11),
    p('p-happy', 'Harold Hogan', 'Store operations', 'c-stark', 'Ava Chen', [], undefined, 10),
    p('p-ishita', 'Ishita Rao', 'Consultant', undefined, 'Jo Mendes', ['Partner'], 30, 66),
    p('p-tom', 'Tom Walsh', 'Freelance designer', undefined, 'Sam Kim', [], undefined, 5),
  ];
  const d = (id: string, name: string, companyId: string, contactId: string, stage: Stage, amount: number, owner: string, closeIn: number, ago: number): Deal => ({ id, name, companyId, contactId, stage, amount, owner, close: dayAt(now, closeIn), created: dayAt(now, -ago) });
  const deals: Deal[] = [
    d('d-acme', 'Acme rollout, 400 seats', 'c-acme', 'p-liam', 'Proposal', 1840000, 'Priya Raman', 12, 60),
    d('d-acme2', 'Acme support plan', 'c-acme', 'p-maria', 'Qualified', 420000, 'Priya Raman', 40, 20),
    d('d-globex', 'Globex platform', 'c-globex', 'p-noor', 'Qualified', 960000, 'Sam Kim', 25, 45),
    d('d-initech', 'Initech pilot', 'c-initech', 'p-ben', 'Lead', 180000, 'Jo Mendes', 55, 15),
    d('d-umbrella', 'Umbrella clinics', 'c-umbrella', 'p-amara', 'Proposal', 1250000, 'Priya Raman', 8, 44),
    d('d-hooli', 'Hooli enterprise', 'c-hooli', 'p-gavin', 'Lost', 2600000, 'Sam Kim', -5, 38),
    d('d-pied', 'Pied Piper starter', 'c-pied', 'p-dinesh', 'Won', 240000, 'Ava Chen', -10, 30),
    d('d-wayne', 'Wayne fleet', 'c-wayne', 'p-lucius', 'Lead', 640000, 'Jo Mendes', 70, 18),
    d('d-stark', 'Stark stores', 'c-stark', 'p-pepper', 'Qualified', 520000, 'Ava Chen', 30, 9),
    d('d-umbrella2', 'Umbrella renewal', 'c-umbrella', 'p-ravi', 'Won', 380000, 'Priya Raman', -20, 50),
  ];
  const me = 'Priya Raman';
  const t = (id: string, title: string, due: number | undefined, assignee: string, record?: RecordLink, done = false): AppTask => ({ id, title, due: due === undefined ? undefined : dayAt(now, due, 17), assignee, record, done, created: dayAt(now, -3) });
  const tasks: AppTask[] = [
    t('t-1', 'Send the revised proposal to Liam', 0, me, { object: 'deals', id: 'd-acme' }),
    t('t-2', 'Book a security review with Amara', 1, me, { object: 'people', id: 'p-amara' }),
    t('t-3', 'Chase signed order form', -2, me, { object: 'deals', id: 'd-umbrella' }),
    t('t-4', 'Prepare QBR deck for Globex', 3, 'Sam Kim', { object: 'companies', id: 'c-globex' }),
    t('t-5', 'Intro call follow-up', 0, me, { object: 'people', id: 'p-pepper' }),
    t('t-6', 'Update forecast for the quarter', 6, me),
    t('t-7', 'Share case study with Ravi', undefined, me, { object: 'people', id: 'p-ravi' }),
    t('t-8', 'Confirm pilot scope', -1, 'Jo Mendes', { object: 'deals', id: 'd-initech' }),
    t('t-9', 'Send welcome pack', -6, me, { object: 'deals', id: 'd-pied' }, true),
  ];
  const n = (id: string, title: string, body: string, author: string, record: RecordLink, ago: number): AppNote => ({ id, title, body, author, record, updated: dayAt(now, -ago, 15) });
  const notes: AppNote[] = [
    n('n-1', 'Discovery call', 'Liam wants rollout across three plants. Budget approved for Q1. Concern: training time for floor staff.', me, { object: 'deals', id: 'd-acme' }, 2),
    n('n-2', 'Security questionnaire', 'Amara sent 40 questions. SSO and audit logs are must-haves. Due Friday.', me, { object: 'people', id: 'p-amara' }, 1),
    n('n-3', 'Pricing pushback', 'Noor asked for a 15% discount on a two-year term. Holding at 8% for now.', 'Sam Kim', { object: 'deals', id: 'd-globex' }, 4),
    n('n-4', 'Lost: why', 'Hooli went with an in-house build. Keep warm; revisit in six months.', 'Sam Kim', { object: 'deals', id: 'd-hooli' }, 6),
  ];
  const i = (id: string, kind: InboxItem['kind'], actor: string, text: string, ago: number, read: boolean, extra: Partial<InboxItem> = {}): InboxItem => ({ id, kind, actor, text, at: new Date(now.getTime() - ago * 60_000), read, done: false, ...extra });
  const inbox: InboxItem[] = [
    i('i-1', 'mention', 'Sam Kim', 'mentioned you on', 12, false, { excerpt: '@Priya can you join the pricing call on Thursday?', record: { object: 'deals', id: 'd-globex' } }),
    i('i-2', 'assignment', 'Jo Mendes', 'assigned you a task on', 55, false, { excerpt: 'Book a security review with Amara', taskId: 't-2', record: { object: 'people', id: 'p-amara' } }),
    i('i-3', 'booking', 'Pepper Potts', 'booked Discovery call', 130, false, { excerpt: 'Tomorrow, 11:00 – 11:30 AM' }),
    i('i-4', 'reply', 'Ava Chen', 'replied in', 300, true, { excerpt: 'They want a demo for the regional managers too.', record: { object: 'deals', id: 'd-stark' } }),
    i('i-5', 'mention', 'Jo Mendes', 'mentioned you on', 1500, true, { excerpt: '@Priya pricing sheet is in the files tab.', record: { object: 'companies', id: 'c-initech' } }),
  ];
  const comments: Comment[] = [
    { id: 'cm-1', record: { object: 'deals', id: 'd-globex' }, author: 'Sam Kim', body: '@Priya can you join the pricing call on Thursday?', at: new Date(now.getTime() - 12 * 60_000), resolved: false, replies: [] },
    { id: 'cm-2', record: { object: 'deals', id: 'd-stark' }, author: 'Pepper Potts', body: 'Shared the store list with Ava.', at: dayAt(now, -1, 16), resolved: false,
      replies: [{ id: 'cm-2r', author: 'Ava Chen', body: 'They want a demo for the regional managers too.', at: new Date(now.getTime() - 300 * 60_000) }] },
  ];
  const act = (id: string, object: ObjectId, rid: string, kind: Activity['kind'], actor: string, text: string, ago: number): Activity => ({ id, record: { object, id: rid }, kind, actor, text, at: dayAt(now, -ago, 10 + (ago % 6)) });
  const activity: Activity[] = [
    act('a-1', 'deals', 'd-acme', 'changed', 'Priya Raman', 'moved the deal to Proposal', 3), act('a-2', 'deals', 'd-acme', 'meeting', 'Priya Raman', 'met Liam Ortiz: Discovery call', 5),
    act('a-3', 'deals', 'd-acme', 'created', 'Priya Raman', 'created the deal', 60), act('a-4', 'people', 'p-liam', 'call', 'Priya Raman', 'called Liam about the rollout plan', 1),
    act('a-5', 'people', 'p-pepper', 'form', 'Pepper Potts', 'sent the Contact us form', 11), act('a-6', 'deals', 'd-globex', 'changed', 'Sam Kim', 'changed the amount to ₹9,60,000', 2),
    act('a-7', 'companies', 'c-acme', 'created', 'Priya Raman', 'added Acme Corp', 90),
  ];
  return { me, members, people, companies, deals, tasks, notes, inbox, comments, activity, setupDone: ['workspace', 'booking', 'link'], setupHidden: false,
    views: {
      people: [{ id: 'v-p-all', name: 'All people', layout: 'table', filters: [], sorts: [], hidden: [] },
        { id: 'v-p-mine', name: 'My people', layout: 'table', filters: [{ id: 'f1', field: 'owner', operator: 'is', values: [me] }], sorts: [{ field: 'lastContact', direction: 'descending' }], hidden: ['owner'], isPrivate: true },
        { id: 'v-p-dm', name: 'Decision makers', layout: 'table', filters: [{ id: 'f2', field: 'tags', operator: 'contains', values: ['Decision maker'] }], sorts: [], hidden: [] }],
      companies: [{ id: 'v-c-all', name: 'All companies', layout: 'table', filters: [], sorts: [{ field: 'name', direction: 'ascending' }], hidden: [] }],
      deals: [{ id: 'v-d-pipe', name: 'Pipeline', layout: 'board', filters: [], sorts: [{ field: 'amount', direction: 'descending' }], hidden: [] },
        { id: 'v-d-all', name: 'All deals', layout: 'table', filters: [], sorts: [{ field: 'close', direction: 'ascending' }], hidden: [] },
        { id: 'v-d-mine', name: 'My open deals', layout: 'table', filters: [{ id: 'f3', field: 'owner', operator: 'is', values: [me] }, { id: 'f4', field: 'stage', operator: 'is not', values: ['Won', 'Lost'] }], sorts: [{ field: 'close', direction: 'ascending' }], hidden: ['owner'], isPrivate: true }],
    },
    lists: [
      { id: 'l-q4', name: 'Q4 pipeline', object: 'deals', oncePerRecord: true, stages: ['To contact', 'Meeting booked', 'Negotiating', 'Closing'],
        entries: [
          { id: 'e1', recordId: 'd-acme', stage: 'Closing', priority: 'High', next: 'Send revised proposal', added: dayAt(now, -9) },
          { id: 'e2', recordId: 'd-umbrella', stage: 'Negotiating', priority: 'High', next: 'Legal review', added: dayAt(now, -8) },
          { id: 'e3', recordId: 'd-globex', stage: 'Meeting booked', priority: 'Medium', next: 'Pricing call Thursday', added: dayAt(now, -6) },
          { id: 'e4', recordId: 'd-stark', stage: 'Meeting booked', priority: 'Medium', next: 'Demo for regional managers', added: dayAt(now, -4) },
          { id: 'e5', recordId: 'd-wayne', stage: 'To contact', priority: 'Low', next: 'Find the fleet lead', added: dayAt(now, -2) },
        ] },
      { id: 'l-events', name: 'Conference follow-ups', object: 'people', oncePerRecord: true, stages: ['New', 'Emailed', 'Replied'],
        entries: [
          { id: 'e6', recordId: 'p-dinesh', stage: 'Replied', priority: 'Medium', next: 'Book intro', added: dayAt(now, -3) },
          { id: 'e7', recordId: 'p-monica', stage: 'Emailed', priority: 'Low', next: 'Nudge next week', added: dayAt(now, -3) },
          { id: 'e8', recordId: 'p-tom', stage: 'New', priority: 'Low', next: 'Send deck', added: dayAt(now, -1) },
        ] },
    ],
    forms: [contactForm(now), feedbackForm(now)] };
}

/** ₹18,40,000 (Indian grouping). */
export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
/** A record's display name and sub-line, for chips, ⌘K and links. */
export function recordName(state: AppState, r: RecordLink): { readonly name: string; readonly sub: string } {
  if (r.object === 'people') { const x = state.people.find((y) => y.id === r.id); const co = state.companies.find((y) => y.id === x?.companyId); return { name: x?.name ?? 'Deleted person', sub: [x?.title, co?.name].filter(Boolean).join(' · ') }; }
  if (r.object === 'companies') { const x = state.companies.find((y) => y.id === r.id); return { name: x?.name ?? 'Deleted company', sub: x?.domain ?? '' }; }
  const x = state.deals.find((y) => y.id === r.id); const co = state.companies.find((y) => y.id === x?.companyId);
  return { name: x?.name ?? 'Deleted deal', sub: x ? `${co?.name ?? ''} · ${inr(x.amount)}` : '' };
}

/** "Talk to sales": live, saving people, with a fortnight of answers. */
function contactForm(now: Date): AppForm {
  const q: ReadonlyArray<FormQuestion> = [
    { id: 'q-name', kind: 'short', title: 'Your name', required: true },
    { id: 'q-email', kind: 'email', title: 'Work email', required: true },
    { id: 'q-company', kind: 'short', title: 'Company' },
    { id: 'q-size', kind: 'choice', title: 'How big is your team?', options: ['Just me', '2–10', '11–50', '51–200', '200+'], required: true },
    { id: 'q-need', kind: 'long', title: 'What are you hoping to fix?' },
  ];
  const r = (id: string, mins: number, name: string, email: string, company: string, size: string, need: string, extra: Partial<FormResponse> = {}): FormResponse =>
    ({ id, at: new Date(now.getTime() - mins * 60_000), answers: { 'q-name': name, 'q-email': email, 'q-company': company, 'q-size': size, 'q-need': need }, ...extra });
  return { id: 'f-contact', name: 'Talk to sales', slug: 'talk-to-sales', status: 'live', questions: q, live: q, mode: 'one', saveTo: 'people', owner: 'Priya Raman', views: 1284, updated: new Date(now.getTime() - 2 * 86_400_000),
    after: { kind: 'booking', message: 'Thanks! Pick a time and we’ll walk you through it.' },
    responses: [
      r('r1', 35, 'Pepper Potts', 'pepper@stark.store', 'Stark Retail', '51–200', 'Our stores book demos by phone. We lose half of them.', { personId: 'p-pepper' }),
      r('r2', 300, 'Arjun Mehta', 'arjun@zylo.in', 'Zylo', '11–50', 'Need round robin across 6 reps.'),
      r('r3', 1500, 'Sana Iqbal', 'sana@brightpath.org', 'Brightpath', '2–10', 'Want booking pages for our counsellors.'),
      r('r4', 2900, 'Buy cheap followers', 'promo@spam.biz', '', 'Just me', 'click here', { spam: true }),
      r('r5', 4300, 'Neel Bhatt', 'neel@orbit.dev', 'Orbit', '200+', 'Replacing our old CRM this quarter.'),
    ] };
}
/** "Event feedback": a draft, not shared yet. */
function feedbackForm(now: Date): AppForm {
  const q: ReadonlyArray<FormQuestion> = [
    { id: 'q-r', kind: 'rating', title: 'How was the session?', required: true },
    { id: 'q-best', kind: 'long', title: 'What was most useful?' },
    { id: 'q-more', kind: 'multi', title: 'What should we cover next?', options: ['Routing', 'Round robin', 'Reports', 'Integrations'] },
  ];
  return { id: 'f-feedback', name: 'Event feedback', slug: 'event-feedback', status: 'draft', questions: q, mode: 'page', saveTo: 'none', owner: 'Priya Raman', views: 0, updated: new Date(now.getTime() - 3 * 3_600_000),
    after: { kind: 'thanks', message: 'Thanks for helping us get better.' }, responses: [] };
}
