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
  | { readonly type: 'setup/hide'; readonly hidden: boolean };

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
    i('i-1', 'mention', 'Sam Kim', 'mentioned you on Globex platform', 12, false, { excerpt: '@Priya can you join the pricing call on Thursday?', record: { object: 'deals', id: 'd-globex' } }),
    i('i-2', 'assignment', 'Jo Mendes', 'assigned you a task', 55, false, { excerpt: 'Book a security review with Amara', taskId: 't-2', record: { object: 'people', id: 'p-amara' } }),
    i('i-3', 'booking', 'Pepper Potts', 'booked Discovery call', 130, false, { excerpt: 'Tomorrow, 11:00 – 11:30 AM' }),
    i('i-4', 'reply', 'Ava Chen', 'replied in Stark stores', 300, true, { excerpt: 'They want a demo for the regional managers too.', record: { object: 'deals', id: 'd-stark' } }),
    i('i-5', 'mention', 'Jo Mendes', 'mentioned you on Initech', 1500, true, { excerpt: '@Priya pricing sheet is in the files tab.', record: { object: 'companies', id: 'c-initech' } }),
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
  return { me, members, people, companies, deals, tasks, notes, inbox, comments, activity, setupDone: ['workspace', 'booking', 'link'], setupHidden: false };
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
