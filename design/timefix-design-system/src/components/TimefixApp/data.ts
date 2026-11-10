import type { LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
import type { SchemaAttribute } from '../AttributeSettings/AttributeSettings.tsx';
// The whole app's CRM data for the prototype: Northwind's team, the people, companies and deals they work, tasks, notes and the inbox.
// Bookings keeps its own state (BookingsFlow); everything else reads this. One pure reducer, new objects only.

/** Someone in the workspace. */
export interface Member { readonly id: string; readonly name: string; readonly email: string; readonly role: 'Owner' | 'Admin' | 'Member' | 'Guest'; readonly title: string }
/** The kinds of record the workspace keeps; custom objects add more. */
export type ObjectId = 'people' | 'companies' | 'deals';
/** A deal's stage, in pipeline order. */
export type Stage = 'Lead' | 'Qualified' | 'Proposal' | 'Won' | 'Lost';
export const STAGES: ReadonlyArray<Stage> = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];

export interface Company { readonly id: string; readonly name: string; readonly domain: string; readonly industry: string; readonly size: string; readonly city: string; readonly owner: string; readonly created: Date; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
export interface Person { readonly id: string; readonly name: string; readonly email: string; readonly phone?: string; readonly title: string; readonly companyId?: string; readonly owner: string; readonly tags: ReadonlyArray<string>; readonly lastContact?: Date; readonly created: Date; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
export interface Deal { readonly id: string; readonly name: string; readonly companyId: string; readonly contactId?: string; readonly stage: Stage; readonly amount: number; readonly owner: string; readonly close: Date; readonly created: Date; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
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
  /** A deals board's columns: by stage (default) or by owner. */
  readonly groupBy?: 'stage' | 'owner';
  readonly filters: ReadonlyArray<{ readonly id: string; readonly field: string; readonly operator: string; readonly values: ReadonlyArray<string> }>;
  readonly sorts: ReadonlyArray<{ readonly field: string; readonly direction: 'ascending' | 'descending' }>;
  readonly hidden: ReadonlyArray<string>; readonly isPrivate?: boolean;
}

/** A list: records of one object gathered for a purpose, with the list's own fields (a stage, a priority, the next step). */
export interface ListEntry { readonly id: string; readonly recordId: string; readonly stage: string; readonly priority: 'High' | 'Medium' | 'Low'; readonly next: string; readonly added: Date }
export interface CrmList { readonly id: string; readonly name: string; readonly object: ObjectId; /** Archived lists leave the sidebar; Settings › Lists brings them back. */ readonly archived?: boolean; readonly stages: ReadonlyArray<string>; readonly entries: ReadonlyArray<ListEntry>; readonly oncePerRecord: boolean }

/** A form: its questions as you edit them, the live ones guests answer, where answers go and what happens after. */
export interface FormResponse { readonly id: string; readonly at: Date; readonly answers: Readonly<Record<string, string>>; readonly spam?: boolean; readonly personId?: string }
export interface AppForm {
  readonly id: string; readonly name: string; readonly slug: string; readonly status: 'draft' | 'live' | 'paused';
  readonly questions: ReadonlyArray<FormQuestion>; readonly live?: ReadonlyArray<FormQuestion>; readonly mode: 'one' | 'page';
  readonly saveTo: 'people' | 'none'; readonly owner: string; readonly after: { readonly kind: 'thanks' | 'booking'; readonly message: string };
  readonly responses: ReadonlyArray<FormResponse>; readonly views: number; readonly updated: Date;
  /** The published layout, name and after-send settings, so a change to any of them counts as an unpublished edit. */
  readonly liveConfig?: string;
  /** A line under the title on the form. */
  readonly subtitle?: string;
  /** Which People attribute each answer fills, by question id ("email", "title", or an owner-made attribute). */
  readonly mapping?: Readonly<Record<string, string>>;
  /** "If <question> is <answer>, go to <question>" rules (one question at a time). */
  readonly logic?: ReadonlyArray<{ readonly id: string; readonly when: string; readonly is: string; readonly goto: string }>;
}

/** An object's definition: its names and attributes. People, Companies and Deals come built in; owners add their own. */
export interface ObjectSchema { readonly id: string; readonly one: string; readonly many: string; readonly custom: boolean; readonly attributes: ReadonlyArray<SchemaAttribute>;
  /** Configuration: the name the API uses, its colour, the attribute that names a record, and whether it's archived (out of the sidebar). */
  readonly apiName?: string; readonly colour?: string; readonly recordName?: string; readonly archived?: boolean;
  /** Access: what each role may do with these records. */
  readonly access?: Readonly<Record<string, 'edit' | 'view' | 'none'>> }

/** A deleted record, kept 30 days so it can come back. */
export interface TrashItem { readonly id: string; readonly object: ObjectId; /** Set when a merge removed it: the record it went into. */ readonly mergedInto?: string; readonly record: Person | Company | Deal; readonly at: Date; readonly by: string }
/** One line of the workspace's history: who did what. */
export interface HistoryLine { readonly id: string; readonly text: string; readonly at: Date }

/** A record of an owner-made object: a name plus its attribute values. */
export interface CustomRecord { readonly id: string; readonly name: string; readonly owner: string; readonly created: Date; readonly extra: Readonly<Record<string, string>> }

/** A saved chart of deals. */
export interface Report {
  readonly id: string; readonly name: string; readonly measure: 'count' | 'amount';
  /** What it counts (deals by default) and how it groups them. Amount is for deals only. */
  readonly object?: 'deals' | 'people' | 'companies';
  readonly group: 'stage' | 'owner' | 'industry' | 'company' | 'tag' | 'city';
  /** Only records owned by this person; none means everyone's. */
  readonly owner?: string;
}

/** A file on a record. The prototype keeps the file itself in memory so Download gives it back. */
export interface RecordFile { readonly id: string; readonly record: RecordLink; readonly name: string; readonly size: number; readonly type: string; readonly at: Date; readonly by: string; readonly blob?: Blob }

/** How the workspace and you are set up: everything Settings changes, kept so it sticks and reaches the rest of the app. */
export interface Prefs {
  readonly workspace: { readonly name: string; readonly slug: string; readonly currency: string; readonly country: string; readonly colour: string; readonly logo?: string;
    /** The workspace's own time zone (bookings, digests); people can set their own in Preferences. */ readonly zone?: string;
    /** How long form answers are kept: forever, or 12 or 24 months. */ readonly retention?: string;
    /** Brand: the colour on dark pages, and the look guests see. */ readonly colourDark?: string; readonly template?: string };
  readonly theme: 'system' | 'light' | 'dark'; readonly timeZone: string; readonly dateFormat: string; readonly weekStart: 'mon' | 'sun' | 'sat'; readonly startPage: string;
  readonly showPhoto: boolean; readonly notify: Readonly<Record<string, boolean>>;
  readonly twoFactor: boolean; readonly devices: ReadonlyArray<{ readonly id: string; readonly what: string; readonly where: string; readonly current?: boolean }>;
  readonly apps: Readonly<Record<'menu' | 'seating' | 'appointments', boolean>>;
  readonly rules: Readonly<Record<'require2fa' | 'google' | 'inviteLink' | 'domainJoin', boolean>>;
  readonly grants: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly teams: ReadonlyArray<{ readonly id: string; readonly name: string; readonly members: ReadonlyArray<string>; /** Records the team sees, per object: all, their own, or the team's. */ readonly access?: Readonly<Record<string, 'all' | 'own' | 'team'>> }>;
  readonly invites: ReadonlyArray<{ readonly id: string; readonly email: string; readonly role: string; readonly at: Date }>;
  readonly joinRequests: ReadonlyArray<{ readonly id: string; readonly name: string; readonly email: string }>;
  readonly apiKeys: ReadonlyArray<{ readonly id: string; readonly name: string; readonly scope: 'read' | 'write'; readonly last4: string; readonly at: Date }>;
  readonly sidebarHidden: ReadonlyArray<string>;
  /** Home sections someone turned off in Preferences: today, tasks, numbers, link, team, reports. */
  readonly homeHidden?: ReadonlyArray<string>;
  /** Your photo, shown in the sidebar, on your pages and in Members. */
  readonly photo?: string;
  /** The invite link: the role it gives, how long it lasts, and its code (a new code stops the old link). */
  readonly inviteLinkOpts?: { readonly role: string; readonly expires: string; readonly code: string; /** Most people the link lets in; "any" is no cap. */ readonly uses?: string };
  /** Partner hubs that reach the workspace from outside, and what they can see. */
  readonly partners?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly scopes: ReadonlyArray<string>; readonly at: Date; readonly lastCall?: Date }>;
  /** Sign-ins over the last 90 days, newest first: yours in Security, everyone's in History. */
  readonly signIns?: ReadonlyArray<{ readonly id: string; readonly who: string; readonly what: string; readonly where: string; readonly at: Date; readonly ok: boolean }>;
  /** Backup codes left unused; making new ones resets to six. */
  readonly backupLeft?: number;
  /** Per calendar account: shown on my week, meetings logged to the CRM, its colour. */
  readonly calendarOpts?: Readonly<Record<string, { readonly week: boolean; readonly log: boolean; readonly colour: string }>>;
  /** What teammates see of my calendar: full details or busy only. */
  readonly teammatesSee?: 'full' | 'busy';
  /** New people from meeting guests are added to People. */
  readonly addFromMeetings?: boolean;
  readonly lastSync?: Date;
  /** Roles the workspace made beyond Owner, Admin, Member and Guest; new people get the default one. */
  readonly roles?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly defaultRole?: string;
  /** How long a sign-in lasts before asking again, in days. */
  readonly sessionDays?: string;
  /** Who sees my scheduling (calendar, hours, meetings). */
  readonly schedSee?: 'everyone' | 'teams' | 'admins';
  /** Imports and exports, newest first, with the file to download again. */
  readonly jobs?: ReadonlyArray<{ readonly id: string; readonly kind: 'import' | 'export'; readonly what: string; readonly rows: number; readonly by: string; readonly at: Date; readonly file?: string; readonly name?: string }>;
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
  readonly objects: ReadonlyArray<ObjectSchema>;
  readonly trash: ReadonlyArray<TrashItem>;
  readonly history: ReadonlyArray<HistoryLine>;
  readonly files: ReadonlyArray<RecordFile>;
  /** Reactions on comments and replies, by comment id: kind → who. */
  readonly prefs: Prefs;
  /** Duplicate pairs someone said aren't ("a|b"). */
  readonly notDupes: ReadonlyArray<string>;
  /** The published link page; until someone publishes, the starter page shows. */
  readonly linkPage?: LinkPageDraft;
  /** Link page changes not published yet: kept while you move around the app. */
  readonly linkDraft?: LinkPageDraft;
  /** Saved charts in Insights › Reports. */
  readonly reports: ReadonlyArray<Report>;
  /** Records of objects owners made (Projects, Vendors), by object id. */
  readonly customRecords: Readonly<Record<string, ReadonlyArray<CustomRecord>>>;
  /** "Preview as": see the app as a member or guest would, read only where they can't change things. */
  readonly previewRole?: 'Member' | 'Guest';
  readonly reactions: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>;
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
  | { readonly type: 'records/fields'; readonly object: ObjectId; readonly changes: ReadonlyArray<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }> }
  | { readonly type: 'records/untrash'; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'records/drop'; readonly object: ObjectId; readonly ids: ReadonlyArray<string>; readonly note?: string }
  | { readonly type: 'records/relink'; readonly from: RecordLink; readonly to: RecordLink; readonly only?: ReadonlyArray<string> }
  | { readonly type: 'dupes/dismiss'; readonly key: string; readonly on: boolean }
  | { readonly type: 'list/entries'; readonly id: string; readonly add?: ReadonlyArray<ListEntry>; readonly remove?: ReadonlyArray<string>; readonly stages?: Readonly<Record<string, string>>; /** Any fields on entries, by entry id. */ readonly patches?: Readonly<Record<string, Partial<ListEntry>>> }
  | { readonly type: 'list/insert'; readonly list: CrmList; readonly at: number }
  | { readonly type: 'comment/set'; readonly comment: Comment }
  | { readonly type: 'activity/add'; readonly activity: Activity }
  | { readonly type: 'setup/done'; readonly id: string }
  | { readonly type: 'setup/hide'; readonly hidden: boolean }
  | { readonly type: 'views/set'; readonly object: ObjectId; readonly views: ReadonlyArray<SavedView> }
  | { readonly type: 'list/set'; readonly list: CrmList }
  | { readonly type: 'list/remove'; readonly id: string }
  | { readonly type: 'form/set'; readonly form: AppForm }
  | { readonly type: 'form/remove'; readonly id: string }
  | { readonly type: 'form/insert'; readonly form: AppForm; readonly at: number }
  | { readonly type: 'link/publish'; readonly page: LinkPageDraft }
  | { readonly type: 'link/draft'; readonly page: LinkPageDraft | undefined }
  | { readonly type: 'report/set'; readonly report: Report }
  | { readonly type: 'report/remove'; readonly id: string }
  | { readonly type: 'custom/set'; readonly object: string; readonly record: CustomRecord }
  | { readonly type: 'custom/remove'; readonly object: string; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'custom/restore'; readonly object: string; readonly records: ReadonlyArray<CustomRecord> }
  | { readonly type: 'preview/set'; readonly role?: 'Member' | 'Guest' }
  | { readonly type: 'trash/merged'; readonly id: string; readonly into: string }
  | { readonly type: 'form/patch'; readonly id: string; readonly patch: (f: AppForm) => Partial<AppForm> }
  | { readonly type: 'object/set'; readonly object: ObjectSchema }
  | { readonly type: 'trash/restore'; readonly id: string }
  | { readonly type: 'trash/purge'; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'history/add'; readonly text: string }
  | { readonly type: 'file/set'; readonly file: RecordFile }
  | { readonly type: 'file/remove'; readonly id: string }
  | { readonly type: 'reaction/toggle'; readonly id: string; readonly kind: string }
  | { readonly type: 'prefs/set'; readonly prefs: Partial<Prefs>; readonly note?: string }
  /** A change worked out from the current prefs, so an Undo puts back one item without touching later changes. */
  | { readonly type: 'prefs/update'; readonly fn: (p: Prefs) => Partial<Prefs> }
  | { readonly type: 'member/set'; readonly member: Member; readonly note?: string }
  | { readonly type: 'member/remove'; readonly id: string; readonly reassignTo?: string }
  | { readonly type: 'me/rename'; readonly name: string };

let lineSeq = 0;
const line = (text: string): HistoryLine => ({ id: `h-${Date.now().toString(36)}-${(lineSeq++).toString(36)}`, text, at: new Date() });
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
      const list: ReadonlyArray<Person | Company | Deal> = a.object === 'people' ? state.people : a.object === 'companies' ? state.companies : state.deals;
      const binned = list.filter((x) => gone.has(x.id)).map((record) => ({ id: `tr-${record.id}`, object: a.object, record, at: new Date(), by: state.me }));
      const kept = a.object === 'people' ? { people: state.people.filter((x) => !gone.has(x.id)) } : a.object === 'companies' ? { companies: state.companies.filter((x) => !gone.has(x.id)) } : { deals: state.deals.filter((x) => !gone.has(x.id)) };
      return { ...state, ...kept, trash: [...binned, ...state.trash], history: [line(`${state.me} deleted ${binned.length === 1 ? binned[0]?.record.name ?? 'a record' : `${binned.length} ${a.object}`}`), ...state.history] };
    }
    case 'records/fields': {
      const by = new Map(a.changes.map((c) => [c.id, c.patch]));
      // `extra` merges key by key, so an Undo of one custom field never touches the others.
      const apply = <T extends { readonly id: string }>(x: T): T => { const patch = by.get(x.id); if (!patch) return x; const ex = patch.extra as Readonly<Record<string, string>> | undefined; return { ...x, ...patch, ...(ex ? { extra: { ...((x as { readonly extra?: Readonly<Record<string, string>> }).extra ?? {}), ...ex } } : {}) }; };
      return a.object === 'people' ? { ...state, people: state.people.map(apply) } : a.object === 'companies' ? { ...state, companies: state.companies.map(apply) } : { ...state, deals: state.deals.map(apply) };
    }
    case 'records/untrash': {
      const items = state.trash.filter((t) => a.ids.includes(t.record.id)); if (items.length === 0) return state;
      const back = (o: ObjectId) => items.filter((t) => t.object === o).map((t) => t.record);
      return { ...state, trash: state.trash.filter((t) => !items.includes(t)), people: [...(back('people') as ReadonlyArray<Person>), ...state.people], companies: [...(back('companies') as ReadonlyArray<Company>), ...state.companies],
        deals: [...(back('deals') as ReadonlyArray<Deal>), ...state.deals], history: [line(`${state.me} restored ${items.length === 1 ? items[0]?.record.name ?? 'a record' : `${items.length} records`}`), ...state.history] };
    }
    case 'records/drop': {
      const gone = new Set(a.ids);
      const kept = a.object === 'people' ? { people: state.people.filter((x) => !gone.has(x.id)) } : a.object === 'companies' ? { companies: state.companies.filter((x) => !gone.has(x.id)) } : { deals: state.deals.filter((x) => !gone.has(x.id)) };
      return { ...state, ...kept, history: a.note ? [line(a.note), ...state.history] : state.history };
    }
    case 'records/relink': {
      const hit = (r: RecordLink | undefined, id: string) => r !== undefined && r.object === a.from.object && r.id === a.from.id && (!a.only || a.only.includes(id));
      const mv = <T extends { readonly id: string; readonly record?: RecordLink }>(x: T): T => (hit(x.record, x.id) ? { ...x, record: a.to } : x);
      const ok = (id: string) => !a.only || a.only.includes(id);
      return { ...state, tasks: state.tasks.map(mv), notes: state.notes.map(mv), comments: state.comments.map(mv), activity: state.activity.map(mv), inbox: state.inbox.map(mv), files: state.files.map(mv),
        deals: state.deals.map((d) => (a.from.object === 'people' && d.contactId === a.from.id && ok(d.id) ? { ...d, contactId: a.to.id } : a.from.object === 'companies' && d.companyId === a.from.id && ok(d.id) ? { ...d, companyId: a.to.id } : d)),
        people: a.from.object === 'companies' ? state.people.map((p) => (p.companyId === a.from.id && ok(p.id) ? { ...p, companyId: a.to.id } : p)) : state.people,
        lists: state.lists.map((l) => (l.object !== a.from.object ? l : { ...l, entries: l.entries.map((e) => (e.recordId === a.from.id && ok(e.id) && !(l.oncePerRecord && l.entries.some((x) => x.recordId === a.to.id)) ? { ...e, recordId: a.to.id } : e)) })),
        forms: a.from.object === 'people' ? state.forms.map((f) => ({ ...f, responses: f.responses.map((r) => (r.personId === a.from.id && ok(r.id) ? { ...r, personId: a.to.id } : r)) })) : state.forms };
    }
    case 'dupes/dismiss': return { ...state, notDupes: a.on ? [...state.notDupes.filter((k) => k !== a.key), a.key] : state.notDupes.filter((k) => k !== a.key) };
    case 'list/entries': return { ...state, lists: state.lists.map((l) => (l.id !== a.id ? l : { ...l, entries: [...l.entries.filter((e) => !(a.remove ?? []).includes(e.id)).map((e) => (a.stages?.[e.id] !== undefined ? { ...e, stage: a.stages[e.id] ?? e.stage } : e)).map((e) => (a.patches?.[e.id] ? { ...e, ...a.patches[e.id] } : e)), ...(a.add ?? [])] })) };
    case 'list/insert': return { ...state, lists: [...state.lists.slice(0, a.at), a.list, ...state.lists.slice(a.at)].filter((l, n, all) => all.findIndex((x) => x.id === l.id) === n) };
    case 'comment/set': return { ...state, comments: upsert(state.comments, a.comment) };
    case 'activity/add': return { ...state, activity: [a.activity, ...state.activity] };
    case 'setup/done': return state.setupDone.includes(a.id) ? state : { ...state, setupDone: [...state.setupDone, a.id] };
    case 'setup/hide': return { ...state, setupHidden: a.hidden };
    case 'views/set': return { ...state, views: { ...state.views, [a.object]: a.views } };
    case 'list/set': return { ...state, lists: state.lists.some((l) => l.id === a.list.id) ? state.lists.map((l) => (l.id === a.list.id ? a.list : l)) : [...state.lists, a.list] };
    case 'list/remove': return { ...state, lists: state.lists.filter((l) => l.id !== a.id) };
    case 'form/set': return { ...state, forms: upsert(state.forms, a.form) };
    case 'form/remove': return { ...state, forms: state.forms.filter((f) => f.id !== a.id) };
    case 'form/insert': return { ...state, forms: [...state.forms.slice(0, a.at), a.form, ...state.forms.slice(a.at)].filter((f, n, all) => all.findIndex((x) => x.id === f.id) === n) };
    case 'link/draft': return { ...state, linkDraft: a.page };
    case 'link/publish': return { ...state, linkPage: a.page, linkDraft: undefined, setupDone: state.setupDone.includes('link') ? state.setupDone : [...state.setupDone, 'link'], history: [line(`${state.me} published the link page`), ...state.history] };
    case 'report/set': return { ...state, reports: state.reports.some((r) => r.id === a.report.id) ? state.reports.map((r) => (r.id === a.report.id ? a.report : r)) : [...state.reports, a.report] };
    case 'report/remove': return { ...state, reports: state.reports.filter((r) => r.id !== a.id) };
    case 'custom/set': { const list = state.customRecords[a.object] ?? []; return { ...state, customRecords: { ...state.customRecords, [a.object]: list.some((r) => r.id === a.record.id) ? list.map((r) => (r.id === a.record.id ? a.record : r)) : [a.record, ...list] } }; }
    case 'custom/remove': return { ...state, customRecords: { ...state.customRecords, [a.object]: (state.customRecords[a.object] ?? []).filter((r) => !a.ids.includes(r.id)) } };
    case 'custom/restore': return { ...state, customRecords: { ...state.customRecords, [a.object]: [...a.records, ...(state.customRecords[a.object] ?? []).filter((r) => !a.records.some((x) => x.id === r.id))] } };
    case 'preview/set': return { ...state, previewRole: a.role };
    case 'trash/merged': return { ...state, trash: state.trash.map((t) => (t.record.id === a.id ? { ...t, mergedInto: a.into } : t)) };
    case 'form/patch': return { ...state, forms: state.forms.map((f) => (f.id === a.id ? { ...f, ...a.patch(f) } : f)) };
    case 'trash/restore': {
      const t = state.trash.find((x) => x.id === a.id); if (!t) return state;
      const rest = { ...state, trash: state.trash.filter((x) => x.id !== a.id), history: [line(`${state.me} restored ${t.record.name}`), ...state.history] };
      return t.object === 'people' ? { ...rest, people: [t.record as Person, ...state.people] } : t.object === 'companies' ? { ...rest, companies: [t.record as Company, ...state.companies] } : { ...rest, deals: [t.record as Deal, ...state.deals] };
    }
    case 'trash/purge': return { ...state, trash: state.trash.filter((x) => !a.ids.includes(x.id)), history: [line(`${state.me} deleted ${a.ids.length} ${a.ids.length === 1 ? 'record' : 'records'} for good`), ...state.history] };
    case 'file/set': return { ...state, files: upsert(state.files, a.file) };
    case 'file/remove': return { ...state, files: state.files.filter((f) => f.id !== a.id) };
    case 'reaction/toggle': {
      const cur = state.reactions[a.id] ?? {}; const who = cur[a.kind] ?? [];
      const next = who.includes(state.me) ? who.filter((x) => x !== state.me) : [...who, state.me];
      return { ...state, reactions: { ...state.reactions, [a.id]: { ...cur, [a.kind]: next } } };
    }
    case 'prefs/update': return { ...state, prefs: { ...state.prefs, ...a.fn(state.prefs) } };
    case 'prefs/set': return { ...state, prefs: { ...state.prefs, ...a.prefs }, history: a.note ? [line(a.note), ...state.history] : state.history };
    case 'member/set': return { ...state, members: state.members.some((m) => m.id === a.member.id) ? state.members.map((m) => (m.id === a.member.id ? a.member : m)) : [...state.members, a.member], history: a.note ? [line(a.note), ...state.history] : state.history };
    case 'member/remove': {
      const gone = state.members.find((m) => m.id === a.id); if (!gone) return state;
      const to = a.reassignTo ?? state.me;
      const move = <T extends { readonly owner: string }>(x: T): T => (x.owner === gone.name ? { ...x, owner: to } : x);
      return { ...state, members: state.members.filter((m) => m.id !== a.id), people: state.people.map(move), companies: state.companies.map(move), deals: state.deals.map(move),
        tasks: state.tasks.map((t) => (t.assignee === gone.name ? { ...t, assignee: to } : t)), history: [line(`${state.me} removed ${gone.name}; their records went to ${to}`), ...state.history] };
    }
    case 'me/rename': {
      const was = state.me; const to = a.name.trim(); if (!to || to === was) return state;
      const own = <T extends { readonly owner: string }>(x: T): T => (x.owner === was ? { ...x, owner: to } : x);
      return { ...state, me: to, members: state.members.map((m) => (m.name === was ? { ...m, name: to } : m)), people: state.people.map(own), companies: state.companies.map(own), deals: state.deals.map(own),
        tasks: state.tasks.map((t) => (t.assignee === was ? { ...t, assignee: to } : t)), prefs: { ...state.prefs, teams: state.prefs.teams.map((t) => ({ ...t, members: t.members.map((n) => (n === was ? to : n)) })) },
        history: [line(`${was} changed their name to ${to}`), ...state.history] };
    }
    case 'history/add': return { ...state, history: [line(a.text), ...state.history] };
    case 'object/set': return { ...state, objects: state.objects.some((o) => o.id === a.object.id) ? state.objects.map((o) => (o.id === a.object.id ? a.object : o)) : [...state.objects, a.object] };
  }
}

/** A date as "2026-11-10" in local time (toISOString would shift it a day in some zones). */
export const ymdOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** "2026-11-10" back to a local date, at the hour given. */
export const dayFrom = (v: string, hour = 12): Date | undefined => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour) : undefined; };

/** A note nobody wrote in: no text and no real title. Leaving one throws it away. */
export const isEmptyNote = (title: string, body: string): boolean => !body.trim() && (!title.trim() || title.trim() === 'Untitled note');

/** Who answered a form: the first email question, and the question that asks their name (else the first short answer). */
export function formWho(questions: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly title: string }>, answers: Readonly<Record<string, string>>): { readonly name: string; readonly email: string } {
  const email = questions.find((q) => q.kind === 'email');
  const name = questions.find((q) => q.kind === 'short' && /name/i.test(q.title)) ?? questions.find((q) => q.kind === 'short');
  return { name: (name && answers[name.id]?.trim()) || '', email: (email && answers[email.id]?.trim()) || '' };
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
    { ...p('p-liam2', 'Liam Ortiz', 'VP Ops', 'c-acme', 'Jo Mendes', [], 40, 3), email: 'l.ortiz@acme.com', phone: '+91 98200 11001' },
    { ...p('p-noor2', 'Noor H.', 'Chief Technology Officer', 'c-globex', 'Ava Chen', ['Technical'], undefined, 2), email: 'noor@globex.io' },
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
    forms: [contactForm(now), feedbackForm(now)],
    objects: builtInObjects(members.map((m) => ({ id: m.id, name: m.name }))),
    trash: [{ id: 'tr-old', object: 'companies', record: { id: 'c-old', name: 'Vandelay Imports', domain: 'vandelay.com', industry: 'Retail', size: '11–50', city: 'Pune', owner: 'Sam Kim', created: dayAt(now, -200) }, at: dayAt(now, -4), by: 'Sam Kim' }],
    history: [
      { id: 'h0', text: 'Jo Mendes uploaded Acme pricing.pdf to Acme Corp', at: dayAt(now, -2, 14) },
      { id: 'h1', text: 'Sam Kim changed Jo Mendes to Admin', at: dayAt(now, 0, 9) }, { id: 'h2', text: 'Priya Raman turned on Table seating', at: dayAt(now, -1, 16) },
      { id: 'h3', text: 'Ava Chen added the attribute Lead source to People', at: dayAt(now, -7, 11) }, { id: 'h4', text: 'Sam Kim deleted Vandelay Imports', at: dayAt(now, -4, 15) }, { id: 'h5', text: 'Priya Raman invited Rahul Verma', at: dayAt(now, -9, 10) },
    ],
    files: [{ id: 'fl-1', record: { object: 'companies', id: 'c-acme' }, name: 'Acme pricing.pdf', size: 248_000, type: 'application/pdf', at: dayAt(now, -2, 14), by: 'Jo Mendes' },
      { id: 'fl-2', record: { object: 'deals', id: 'd-acme' }, name: 'Rollout plan v3.docx', size: 91_000, type: 'application/msword', at: dayAt(now, -1, 11), by: 'Priya Raman' }],
    reactions: { 'cm-1': { agree: ['Jo Mendes'] } },
    notDupes: [],
    customRecords: {},
    reports: [{ id: 'r-stage', name: 'Pipeline by stage', measure: 'amount', group: 'stage' }, { id: 'r-owner', name: 'Deals by owner', measure: 'count', group: 'owner' }],
    prefs: {
      workspace: { name: 'Northwind', slug: 'northwind', currency: 'inr', country: 'in', colour: 'teal' },
      theme: 'system', timeZone: 'ist', dateFormat: 'dmy', weekStart: 'mon', startPage: 'home', showPhoto: true,
      notify: { mention: true, task: true, booking: true, form: false, digest: true }, twoFactor: false,
      devices: [{ id: 'dv1', what: 'MacBook Pro · Chrome', where: 'Mumbai', current: true }, { id: 'dv2', what: 'iPhone · Safari', where: 'Mumbai · 2h ago' }, { id: 'dv3', what: 'Windows · Edge', where: 'Pune · 3d ago' }],
      signIns: [
        { id: 'si1', who: 'Priya Raman', what: 'MacBook Pro · Chrome', where: 'Mumbai', at: dayAt(now, 0, 9), ok: true },
        { id: 'si2', who: 'Sam Kim', what: 'MacBook Air · Safari', where: 'Bengaluru', at: dayAt(now, 0, 8), ok: true },
        { id: 'si3', who: 'Priya Raman', what: 'iPhone · Safari', where: 'Mumbai', at: dayAt(now, -1, 19), ok: true },
        { id: 'si4', who: 'Jo Mendes', what: 'Windows · Edge', where: 'Pune', at: dayAt(now, -2, 10), ok: false },
        { id: 'si5', who: 'Jo Mendes', what: 'Windows · Edge', where: 'Pune', at: dayAt(now, -2, 10), ok: true },
        { id: 'si6', who: 'Priya Raman', what: 'Windows · Edge', where: 'Pune', at: dayAt(now, -3, 14), ok: true },
        { id: 'si7', who: 'Ava Chen', what: 'iPad · Safari', where: 'Delhi', at: dayAt(now, -5, 11), ok: true },
      ],
      backupLeft: 6, teammatesSee: 'busy', addFromMeetings: true, sessionDays: '30', schedSee: 'teams',
      jobs: [{ id: 'jb1', kind: 'import', what: 'People from old-crm.csv', rows: 214, by: 'Sam Kim', at: dayAt(now, -9, 16), name: 'old-crm.csv' }],
      apps: { menu: true, seating: true, appointments: true }, rules: { require2fa: false, google: true, inviteLink: false, domainJoin: true },
      grants: { owner: ['records.edit', 'schema', 'members', 'bookings'], admin: ['records.edit', 'schema', 'members', 'bookings'], member: ['records.edit', 'bookings'], guest: [] },
      teams: [{ id: 'tm1', name: 'Sales', members: ['Priya Raman', 'Sam Kim', 'Jo Mendes'] }, { id: 'tm2', name: 'Customer success', members: ['Ava Chen'] }],
      invites: [{ id: 'iv1', email: 'rahul@northwind.com', role: 'member', at: dayAt(now, -1, 10) }],
      joinRequests: [{ id: 'jr1', name: 'Meera Iyer', email: 'meera@northwind.com' }],
      apiKeys: [], sidebarHidden: [],
    } };
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

/** People, Companies and Deals as Settings › Objects shows them. */
function builtInObjects(owners: ReadonlyArray<{ readonly id: string; readonly name: string }>): ReadonlyArray<ObjectSchema> {
  const sys = (id: string, name: string, type: SchemaAttribute['type'], extra: Partial<SchemaAttribute> = {}): SchemaAttribute => ({ id, name, type, ...extra });
  const owner = sys('owner', 'Owner', 'actor', { candidates: owners });
  const created = sys('created', 'Created at', 'timestamp', { isSystem: true, readOnlyReason: 'Set by the system' });
  return [
    { id: 'people', one: 'Person', many: 'People', custom: false, attributes: [sys('name', 'Name', 'personalName', { isSystem: true, isRequired: true }), sys('email', 'Email', 'email', { isUnique: true }), sys('phone', 'Phone', 'phone'), sys('title', 'Job title', 'text'),
      sys('company', 'Company', 'record'), sys('tags', 'Tags', 'multiSelect', { options: ['Decision maker', 'Champion', 'Technical', 'Budget', 'Partner'].map((x) => ({ id: x, label: x, hue: 'gray' as const })) }), owner, sys('lastContact', 'Last contact', 'date'), created] },
    { id: 'companies', one: 'Company', many: 'Companies', custom: false, attributes: [sys('name', 'Name', 'text', { isSystem: true, isRequired: true }), sys('domain', 'Domain', 'domain', { isUnique: true }),
      sys('industry', 'Industry', 'select', { options: ['Software', 'Fintech', 'Healthcare', 'Manufacturing', 'Logistics', 'Retail'].map((x) => ({ id: x, label: x, hue: 'blue' as const })) }), sys('size', 'Employees', 'text'), sys('city', 'City', 'location'), owner, created] },
    { id: 'deals', one: 'Deal', many: 'Deals', custom: false, attributes: [sys('name', 'Deal', 'text', { isSystem: true, isRequired: true }), sys('company', 'Company', 'record'),
      sys('stage', 'Stage', 'status', { options: ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'].map((x) => ({ id: x, label: x, hue: (x === 'Won' ? 'green' : x === 'Lost' ? 'red' : 'blue') as 'green' | 'red' | 'blue' })) }),
      sys('amount', 'Amount', 'currency', { currency: 'INR' }), sys('close', 'Close date', 'date'), owner, created] },
  ];
}

/** The attribute ids every built-in object draws itself; anything else in Settings › Objects is the owner's own, kept in `extra`. */
export const BUILT_IN_ATTRIBUTES: ReadonlySet<string> = new Set(['name', 'email', 'phone', 'title', 'company', 'tags', 'owner', 'created', 'domain', 'industry', 'size', 'city', 'stage', 'amount', 'close', 'lastContact', 'contact']);

/** Entries whose record still exists: a deleted record's entry waits in the list until it's restored, and isn't counted. */
export const liveEntries = (state: AppState, l: CrmList): ReadonlyArray<ListEntry> => {
  const pool: ReadonlyArray<{ readonly id: string }> = l.object === 'people' ? state.people : l.object === 'companies' ? state.companies : state.deals;
  const ids = new Set(pool.map((r) => r.id));
  return l.entries.filter((e) => ids.has(e.recordId));
};
