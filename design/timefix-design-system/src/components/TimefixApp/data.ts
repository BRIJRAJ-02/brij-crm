import type { LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
import type { SchemaAttribute } from '../AttributeSettings/AttributeSettings.tsx';
// The whole app's CRM data for the prototype: Northwind's team, the people, companies and deals they work, tasks, notes and the inbox.
// Bookings keeps its own state (BookingsFlow); everything else reads this. One pure reducer, new objects only.

/** Someone in the workspace. */
import type { GuestLookValue } from '../GuestLook/GuestLook.tsx';
export interface Member { readonly id: string; readonly name: string; readonly email: string; readonly role: 'Owner' | 'Admin' | 'Member' | 'Guest'; readonly title: string }
/** The three objects every workspace starts with. */
export type BuiltIn = 'people' | 'companies' | 'deals';
/** The kinds of record the workspace keeps: the three built in, or an owner-made object's id. */
export type ObjectId = string;
/** Is this one of the three built-in objects? */
export const isBuiltIn = (o: string): o is BuiltIn => o === 'people' || o === 'companies' || o === 'deals';
/** A deal's stage, in pipeline order. */
export type Stage = 'Lead' | 'Qualified' | 'Proposal' | 'Won' | 'Lost';
export const STAGES: ReadonlyArray<Stage> = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
/** How likely a deal in each stage is to close, for weighted amounts and the forecast. */
export const STAGE_ODDS: Readonly<Record<Stage, number>> = { Lead: 10, Qualified: 30, Proposal: 60, Won: 100, Lost: 0 };
/** Days without a stage move before an open deal reads as stale. */
export const STALE_DAYS = 21;
/** Whole days a deal has sat in its stage. */
export const daysInStage = (d: Deal, now = new Date()) => Math.max(0, Math.floor((now.getTime() - (d.stageAt ?? d.created).getTime()) / 86_400_000));

export interface Company { readonly id: string; readonly name: string; readonly domain: string; readonly industry: string; readonly size: string; readonly city: string; readonly owner: string; readonly created: Date; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
export interface Person { readonly id: string; readonly name: string; readonly email: string; readonly phone?: string; readonly title: string; readonly companyId?: string; readonly owner: string; readonly tags: ReadonlyArray<string>; readonly lastContact?: Date; readonly created: Date; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
export interface Deal { readonly id: string; readonly name: string; readonly companyId: string; readonly contactId?: string; readonly stage: Stage; readonly amount: number; readonly owner: string; readonly close: Date; readonly created: Date;
  /** When it entered its stage, for days in stage and stale deals. */ readonly stageAt?: Date;
  /** Lost: why (one of LOST_REASONS), and a note. */ readonly lostReason?: string; readonly lostNote?: string; /** Values of attributes owners added in Settings › Objects. */ readonly extra?: Readonly<Record<string, string>> }
/** Which record a task, note or comment belongs to. */
export interface RecordLink { readonly object: ObjectId; readonly id: string }

export interface AppTask { readonly id: string; readonly title: string; readonly done: boolean; readonly due?: Date; /** The due day has a time too (else it's due by the end of the day). */ readonly dueTime?: boolean; readonly assignee: string; readonly record?: RecordLink; /** More records the task is about (a deal and its two people); it shows on each one's page. */ readonly also?: ReadonlyArray<RecordLink>; readonly description?: string; readonly created: Date;
  /** High or low; unset is normal. */ readonly priority?: 'high' | 'low';
  /** Repeats from its due day: ticking it done adds the next one. */ readonly repeat?: TaskRepeat;
  /** Who made it (the Tasks page's "Created by me"); unset is the assignee. */ readonly createdBy?: string }
/** A note to start from: a title and headings with an empty line or to-do under each (meeting, call and discovery notes). */
export interface NoteTemplate { readonly id: string; readonly label: string; readonly title: string; readonly sections: ReadonlyArray<{ readonly heading: string; readonly todo?: boolean }> }
/** The note templates; Blank is no template. */
export const NOTE_TEMPLATES: ReadonlyArray<NoteTemplate> = [
  { id: 'meeting', label: 'Meeting notes', title: 'Meeting notes', sections: [{ heading: 'Who was there' }, { heading: 'What we talked about' }, { heading: 'Decisions' }, { heading: 'Next steps', todo: true }] },
  { id: 'call', label: 'Call notes', title: 'Call notes', sections: [{ heading: 'Why we spoke' }, { heading: 'What they said' }, { heading: 'Follow-ups', todo: true }] },
  { id: 'discovery', label: 'Discovery', title: 'Discovery call', sections: [{ heading: 'Their goal' }, { heading: 'What gets in the way' }, { heading: 'Who decides, and when' }, { heading: 'Budget' }, { heading: 'Next steps', todo: true }] },
];
/** A template as the editor's document, with the plain text beside it for search and previews. */
export function noteFromTemplate(t: NoteTemplate): { readonly title: string; readonly body: string; readonly doc: import('@tiptap/react').JSONContent } {
  const content = t.sections.flatMap((x) => [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: x.heading }] },
    x.todo ? { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] } : { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
  ]);
  return { title: t.title, body: t.sections.map((x) => x.heading).join('\n'), doc: { type: 'doc', content } };
}

/** How a task repeats. */
export type TaskRepeat = 'day' | 'weekday' | 'week' | 'month';
/** The repeat rules, as people say them. */
export const REPEATS: ReadonlyArray<{ readonly id: TaskRepeat; readonly label: string }> = [
  { id: 'day', label: 'Every day' }, { id: 'weekday', label: 'Every weekday' }, { id: 'week', label: 'Every week' }, { id: 'month', label: 'Every month' },
];
/** The next due day after this one, by the rule (weekdays skip Saturday and Sunday). */
export function nextDue(due: Date, r: TaskRepeat): Date {
  const d = new Date(due);
  if (r === 'month') { d.setMonth(d.getMonth() + 1); return d; }
  d.setDate(d.getDate() + (r === 'week' ? 7 : 1));
  if (r === 'weekday') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
export interface AppNote { readonly id: string; readonly title: string; readonly body: string; readonly author: string; /** The record it sits on; a note can stand on its own. */ readonly record?: RecordLink; readonly updated: Date; /** The editor's document, so formatting survives a save. */ readonly doc?: import('@tiptap/react').JSONContent;
  /** More records it's about: it shows on each one's page too. */ readonly also?: ReadonlyArray<RecordLink> }
/** One thing for you in the Inbox. */
export interface InboxItem {
  readonly id: string; readonly kind: 'mention' | 'reply' | 'assignment' | 'booking' | 'form' | 'automation'; readonly actor: string; readonly text: string; readonly excerpt?: string;
  readonly at: Date; readonly read: boolean; readonly done: boolean; readonly record?: RecordLink; readonly taskId?: string;
  /** Snoozed: out of the inbox until then, back unread. */
  readonly snoozedUntil?: Date;
}
/** A comment thread on a record. */
export interface Comment { readonly id: string; readonly record: RecordLink; readonly author: string; readonly body: string; readonly at: Date; readonly resolved: boolean; readonly replies: ReadonlyArray<CommentReply>;
  /** Earlier wordings, oldest first: an edited comment says so and shows them. */ readonly history?: ReadonlyArray<{ readonly body: string; readonly at: Date }> }
/** A reply in a thread; edits keep the earlier wordings too. */
export interface CommentReply { readonly id: string; readonly author: string; readonly body: string; readonly at: Date; readonly history?: ReadonlyArray<{ readonly body: string; readonly at: Date }> }
/** A line on a record's timeline. */
export interface Activity { readonly id: string; readonly record: RecordLink; readonly kind: 'created' | 'changed' | 'call' | 'meeting' | 'note' | 'task' | 'email' | 'form'; readonly actor: string; readonly text: string; readonly at: Date;
  /** A logged call or meeting: what it was about, how long, how it went, notes, and the other records it was with. */
  readonly title?: string; readonly minutes?: number; readonly outcome?: string; readonly notes?: string; readonly also?: ReadonlyArray<RecordLink> }

/** One filter: a field (or a related record's field, "company.industry"), an operator in words, and its values. */
export interface ViewFilter { readonly id: string; readonly field: string; readonly operator: string; readonly values: ReadonlyArray<string> }
/** Filters in brackets, joined by their own and/or. */
export interface ViewFilterGroup { readonly id: string; readonly match: 'all' | 'any'; readonly rules: ReadonlyArray<ViewFilter> }
/** What a column's footer works out over every matching record. */
export type CalcKind = 'none' | 'count' | 'empty' | 'filled' | 'sum' | 'avg' | 'min' | 'max';
/** Who sees a saved view, and who may change it. */
export type ViewAccess = 'private' | 'everyone' | 'admins';

/** A saved way to look at an object: its filters, sorts, columns and layout. Private views are only yours. */
export interface SavedView {
  readonly id: string; readonly name: string; readonly layout: 'table' | 'board';
  /** The board's columns: any status, select or owner field (stage for deals by default). */
  readonly groupBy?: string;
  /** The table's rows in groups by a status, select or owner field; unset is one list. */
  readonly rowGroup?: string;
  readonly filters: ReadonlyArray<ViewFilter>;
  /** Bracketed filters, each with its own and/or, joined to the rest by `match`. */
  readonly groups?: ReadonlyArray<ViewFilterGroup>;
  /** Column order (ids), and widths the person dragged to. */
  readonly order?: ReadonlyArray<string>; readonly widths?: Readonly<Record<string, number>>;
  /** Footer calculations by column. */
  readonly calcs?: Readonly<Record<string, CalcKind>>;
  /** Board: the number field each column totals, the fields each card shows, and whether empty columns hide. */
  readonly boardSum?: string; readonly cardFields?: ReadonlyArray<string>; readonly hideEmpty?: boolean;
  /** Who sees it: only its maker, everyone, or everyone with only admins changing it. Locked views can't be saved over. */
  readonly access?: ViewAccess; readonly locked?: boolean; readonly createdBy?: string;
  readonly sorts: ReadonlyArray<{ readonly field: string; readonly direction: 'ascending' | 'descending' }>;
  readonly hidden: ReadonlyArray<string>; readonly isPrivate?: boolean;
  /** Filters joined by and (every one, the default) or or (any one). */
  readonly match?: 'all' | 'any';
}

/** A list: records of one object gathered for a purpose, with the list's own fields (a stage, a priority, the next step). */
export interface ListEntry { readonly id: string; readonly recordId: string; readonly stage: string; readonly priority: 'High' | 'Medium' | 'Low'; readonly next: string; readonly added: Date }
export interface CrmList { readonly id: string; readonly name: string; readonly object: ObjectId; /** Archived lists leave the sidebar; Settings › Lists brings them back. */ readonly archived?: boolean; readonly stages: ReadonlyArray<string>; readonly entries: ReadonlyArray<ListEntry>; readonly oncePerRecord: boolean }

/** A form: its questions as you edit them, the live ones guests answer, where answers go and what happens after. */
export interface FormResponse { readonly id: string; readonly at: Date; readonly answers: Readonly<Record<string, string>>; readonly spam?: boolean; readonly personId?: string;
  /** The record it was filed as (a person, company, deal or an owner-made object's record). */ readonly record?: { readonly object: string; readonly id: string };
  /** Doubtful sends wait for a person (Needs review); a send the CRM refused to take can be retried (Failed). */
  readonly state?: 'review' | 'failed';
  /** Why the spam check stopped it, or why it failed. */
  readonly why?: string;
  /** Where it came from: the source, its UTM tags, the page it was sent on and how (the form's own page, an embed, your own HTML). */
  readonly from?: { readonly source: string; readonly medium?: string; readonly campaign?: string; readonly page?: string; readonly via?: 'page' | 'inline' | 'popup' | 'slide' | 'own' };
  /** Seconds from the first answer to Send. */
  readonly secs?: number;
  /** The score from the answers' points, and the ending it reached. */
  readonly score?: number; readonly ending?: string;
  /** Consent questions ticked: the exact words agreed to, by question id. */
  readonly consent?: Readonly<Record<string, string>>;
  /** Answers the record kept its own different value for (Replace was off), by question id. */
  readonly kept?: ReadonlyArray<string> }
/** One visit to a public page: a form ('form:<id>'), the link page ('link') or a booking page ('booking:<id>'); how far it got and whether it finished. */
export interface Visit { readonly id: string; readonly at: Date; readonly page: string; readonly source: string; readonly medium?: string; readonly campaign?: string;
  /** How many steps it reached past the view (0: only looked; for a form, questions reached). */ readonly reached: number; readonly finished: boolean; readonly secs?: number;
  /** The submission or booking it made, when it finished. */ readonly ref?: string }
/** A link page besides your own: one for a team or the company (or your page copied into another workspace), with its own handle,
 *  the members shown on it and who can edit it. Live or Private; a draft waits until Publish. */
export interface SharedLinkPage { readonly id: string; readonly kind: 'me' | 'team' | 'company'; readonly name: string; readonly handle: string; readonly members: ReadonlyArray<string>; readonly editors: ReadonlyArray<string>;
  readonly page: LinkPageDraft; readonly draft?: LinkPageDraft; readonly live: boolean; readonly made: Date; readonly workspace?: string }
/** A thank-you message besides the main one. */
export interface FormEnding { readonly id: string; readonly title: string; readonly line?: string; readonly button?: { readonly label: string; readonly url: string } }
/** An After they send route: when a question has an answer, send them to an ending, a booking page or a link instead. */
export interface FormRoute { readonly id: string; readonly when: string; readonly is: string; readonly to: 'ending' | 'booking' | 'link'; readonly ending?: string; readonly url?: string }
export interface AppForm {
  readonly id: string; readonly name: string; readonly slug: string; readonly status: 'draft' | 'live' | 'paused';
  readonly questions: ReadonlyArray<FormQuestion>; readonly live?: ReadonlyArray<FormQuestion>; readonly mode: 'one' | 'page' | 'steps';
  /** What each response becomes: 'people', 'companies', 'deals', an owner-made object's id, or 'none' (answers stay on the form). */
  readonly saveTo: string; readonly owner: string; readonly after: { readonly kind: 'thanks' | 'booking' | 'redirect'; readonly message: string; /** Redirect: where they go after sending. */ readonly url?: string; /** Say thanks: an optional button under the message ("See our pricing"). */ readonly button?: { readonly label: string; readonly url: string } };
  readonly responses: ReadonlyArray<FormResponse>; readonly views: number; readonly updated: Date;
  /** How many visitors reached each question (one at a time), by question id: where people stop. */
  readonly reached?: Readonly<Record<string, number>>;
  /** The published layout, name and after-send settings, so a change to any of them counts as an unpublished edit. */
  readonly liveConfig?: string;
  /** A line under the title on the form. */
  readonly subtitle?: string;
  /** What the form wears for visitors: one of the four looks or Custom (accent, face, light or dark). Unset is Calm. */
  readonly look?: GuestLookValue;
  /** Which People attribute each answer fills, by question id ("email", "title", or an owner-made attribute). */
  readonly mapping?: Readonly<Record<string, string>>;
  /** "If <question> is <answer>, go to <question>" rules (one question at a time). */
  readonly logic?: ReadonlyArray<{ readonly id: string; readonly when: string; readonly is: string; readonly goto: string }>;
  /** How a response finds the record it updates: 'email', 'phone', 'domain' or 'name'. A match is updated; otherwise a new one is added. */
  readonly matchBy?: string;
  /** People only: also open a deal for each new person, in this stage. */
  readonly alsoDeal?: { readonly stage: string };
  /** Tag the record with the form's name (on unless turned off). */
  readonly tagWith?: boolean;
  /** Also add the record to this list. */
  readonly toList?: string;
  /** Stops taking answers on this day (YYYY-MM-DD) or after this many, with the words visitors then see. */
  readonly closesOn?: string; readonly maxResponses?: number; readonly closedMessage?: string;
  /** Members emailed each response. */
  readonly notify?: ReadonlyArray<string>;
  /** An email to the person who answered, when a question gives their email. */
  readonly confirmEmail?: { readonly subject: string; readonly line: string };
  /** The last button's words. */
  readonly submitLabel?: string;
  /** The workspace it belongs to when it was copied there ('lumen', 'olive'); unset shows in every workspace (the seed). */
  readonly workspace?: string;
  /** The headline visitors read over the form; the form's name until changed on the preview. */
  readonly headline?: string;
  /** How many submissions there were when the owner last looked: newer ones show "New" on the list. */
  readonly seen?: number;
  /** Other thank-you messages, and the After they send routes that pick one (or booking, or a link) by answer. */
  readonly endings?: ReadonlyArray<FormEnding>; readonly routes?: ReadonlyArray<FormRoute>;
  /** The record field the score is saved to ("score" on People), or nowhere. */
  readonly scoreTo?: string;
  /** The visitor's language for the form's own words. */
  readonly lang?: 'en' | 'hi' | 'es' | 'fr' | 'de';
  /** Visitors can save and come back with a link (Finish later). */
  readonly saveProgress?: boolean;
  /** Square corners, and the workspace's brand (logo and colour) instead of the form's own look. */
  readonly corners?: 'rounded' | 'square'; readonly useBrand?: boolean;
  /** A round robin group (a team's id) owns new records instead of one person: each goes to the next teammate. */
  readonly ownerGroup?: string;
  /** The spam check: how sure it must be before a send goes to Spam rather than Needs review. */
  readonly spamLevel?: 'relaxed' | 'normal' | 'strict';
  /** How it sits on someone's site: style, clear background, no title, button words and colour. */
  readonly embed?: { readonly style: 'inline' | 'popup' | 'slide'; readonly clear: boolean; readonly hideTitle: boolean; readonly words: string; readonly colour: string };
  /** Developers: sites your own HTML may post from, refusing unsigned posts, and the signing secret. */
  readonly sites?: ReadonlyArray<string>; readonly signedOnly?: boolean; readonly secret?: string;
}

/** An object's definition: its names and attributes. People, Companies and Deals come built in; owners add their own. */
export interface ObjectSchema { readonly id: string; readonly one: string; readonly many: string; readonly custom: boolean; readonly attributes: ReadonlyArray<SchemaAttribute>;
  /** Configuration: the name the API uses, its colour, the attribute that names a record, and whether it's archived (out of the sidebar). */
  readonly apiName?: string; readonly colour?: string; readonly recordName?: string; readonly archived?: boolean;
  /** Access: what each role may do with these records. */
  readonly access?: Readonly<Record<string, 'edit' | 'view' | 'none'>> }

/** A deleted record, kept 30 days so it can come back. */
export interface TrashItem { readonly id: string; readonly object: ObjectId; /** Set when a merge removed it: the record it went into. */ readonly mergedInto?: string; readonly record: AnyRecord; readonly at: Date; readonly by: string }
/** Any record: a person, company, deal or an owner-made object's record. */
export type AnyRecord = Person | Company | Deal | CustomRecord;
/** One line of the workspace's history: who did what. */
export interface HistoryLine { readonly id: string; readonly text: string; readonly at: Date }

/** A record of an owner-made object: a name plus its attribute values. */
export interface CustomRecord { readonly id: string; readonly name: string; readonly owner: string; readonly created: Date; readonly extra: Readonly<Record<string, string>> }

/** A saved chart of any object's records. */
export interface Report {
  readonly id: string; readonly name: string;
  /** Count records, or add up / average a number field (`field`). "amount" is the deals' value, kept from older reports. */
  readonly measure: 'count' | 'amount' | 'sum' | 'avg'; readonly field?: string;
  /** What it counts (deals by default): any object's id. */
  readonly object?: ObjectId;
  /** The field it groups by; dates group by month or week. */
  readonly group: string; readonly dateBy?: 'month' | 'week';
  /** Only records owned by this person; none means everyone's. */
  readonly owner?: string;
  /** Only the records a saved view shows. */
  readonly viewId?: string;
  /** Bars, a line, or one number. */
  readonly chart?: 'bar' | 'line' | 'number';
}

/** What starts an automation: a record made, a field changing (to anything or to one value), or a task falling due. */
export type AutomationTrigger = { readonly kind: 'created'; readonly object: ObjectId } | { readonly kind: 'changed'; readonly object: ObjectId; readonly field: string; readonly to?: string } | { readonly kind: 'taskDue' };
/** What an automation does: make a task, set a field, or tell someone. "owner" means the record's owner. */
export type AutomationAction = { readonly kind: 'task'; readonly title: string; readonly who: string; readonly days: number } | { readonly kind: 'set'; readonly field: string; readonly value: string } | { readonly kind: 'notify'; readonly who: string; readonly message: string };
/** "When X, only if Y, then Z": runs as the member who last saved or switched it on. */
export interface Automation { readonly id: string; readonly on: boolean; readonly runAs: string; readonly trigger: AutomationTrigger; readonly conditions: ReadonlyArray<ViewFilter>; readonly match: 'all' | 'any'; readonly actions: ReadonlyArray<AutomationAction>; readonly lastRun?: Date; readonly created: Date;
  /** Why it switched itself off (five failures in a row, or the person it ran as left). */ readonly offReason?: string; readonly failures?: number }
/** One run of an automation: when, for which record, and how it went. */
export interface AutomationRun { readonly id: string; readonly automationId: string; readonly at: Date; readonly record?: RecordLink; readonly taskId?: string; readonly status: 'done' | 'failed'; readonly reason?: string; readonly did: string }

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
  readonly jobs?: ReadonlyArray<ImportJob>;
  /** How likely a deal in each stage is to close (%), for weighted amounts and the forecast; unset stages use the defaults. */
  readonly winChance?: Readonly<Record<string, number>>;
}

/** An import or export in Settings › Imports and exports. Imports keep their rows, errors and what Undo needs for 7 days. */
export interface ImportJob { readonly id: string; readonly kind: 'import' | 'export'; readonly what: string; readonly rows: number; readonly by: string; readonly at: Date; readonly file?: string; readonly name?: string;
  readonly object?: ObjectId; readonly made?: number; readonly updated?: number; readonly skipped?: number;
  readonly lines?: ReadonlyArray<{ readonly row: number; readonly name: string; readonly result: 'added' | 'updated' | 'skipped' | 'error'; readonly reason?: string }>;
  readonly undo?: { readonly created: ReadonlyArray<string>; readonly before: ReadonlyArray<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }>; readonly newCompanies?: ReadonlyArray<string> }; readonly undone?: boolean }

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
  /** The link page taken offline: kept as it is, but visitors see nothing until it's back. */
  readonly linkOffline?: boolean;
  /** Link page changes not published yet: kept while you move around the app. */
  readonly linkDraft?: LinkPageDraft;
  /** Saved charts in Insights › Reports. */
  readonly reports: ReadonlyArray<Report>;
  /** Insights shared by a view-only link: its own key (stopping sharing kills it) and when it stops working, if ever. */
  readonly insightsLink?: { readonly key: string; readonly expires?: Date; readonly made: Date };
  /** Named view-only links to Insights: what they cover (all, or chosen pages), when they stop, and whether they were revoked. */
  readonly insightsShares?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly key: string; readonly pages: ReadonlyArray<string>; readonly days: string; readonly made: Date; readonly expires?: Date; readonly revoked?: boolean }>;
  /** Visits to the public pages: forms and the link page (bookings come from meetings). */
  readonly visits?: ReadonlyArray<Visit>;
  /** Link pages for a team or the company. */
  readonly linkPages?: ReadonlyArray<SharedLinkPage>;
  /** The link page's address, once claimed. */
  readonly linkHandle?: string;
  /** Teammates' link pages you manage: invited, or live. */
  readonly teamPages?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly email: string; readonly handle: string; readonly status: 'invited' | 'live'; readonly blocks: number; readonly at: Date }>;
  /** Records of objects owners made (Projects, Vendors), by object id. */
  readonly customRecords: Readonly<Record<string, ReadonlyArray<CustomRecord>>>;
  /** "Preview as": see the app as a member or guest would, read only where they can't change things. */
  readonly previewRole?: 'Member' | 'Guest';
  readonly reactions: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>;
  /** Settings › Automations and what they did. */
  readonly automations: ReadonlyArray<Automation>;
  readonly runs: ReadonlyArray<AutomationRun>;
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
  | { readonly type: 'link/offline'; readonly offline: boolean }
  | { readonly type: 'link/draft'; readonly page: LinkPageDraft | undefined }
  | { readonly type: 'report/set'; readonly report: Report }
  | { readonly type: 'insights/link'; readonly link: AppState['insightsLink'] }
  | { readonly type: 'insights/shares'; readonly shares: NonNullable<AppState['insightsShares']> }
  | { readonly type: 'visit/add'; readonly visit: Visit }
  | { readonly type: 'visit/patch'; readonly id: string; readonly patch: Partial<Visit> }
  | { readonly type: 'link/handle'; readonly handle: string }
  | { readonly type: 'linkpage/set'; readonly page: SharedLinkPage }
  | { readonly type: 'linkpage/patch'; readonly id: string; readonly patch: Partial<SharedLinkPage> }
  | { readonly type: 'linkpage/remove'; readonly id: string }
  | { readonly type: 'team/pages'; readonly pages: NonNullable<AppState['teamPages']> }
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
  | { readonly type: 'me/rename'; readonly name: string }
  | { readonly type: 'activity/set'; readonly activity: Activity }
  | { readonly type: 'activity/remove'; readonly id: string }
  | { readonly type: 'comment/remove'; readonly id: string }
  | { readonly type: 'objects/order'; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'automation/set'; readonly automation: Automation }
  | { readonly type: 'automation/remove'; readonly id: string }
  | { readonly type: 'automation/insert'; readonly automation: Automation; readonly at: number }
  /** Time passing: tasks that fell due run "When a task is due" automations. */
  | { readonly type: 'automations/tick'; readonly now: Date }
  | { readonly type: 'run/add'; readonly runs: ReadonlyArray<AutomationRun> };

let lineSeq = 0;
const line = (text: string): HistoryLine => ({ id: `h-${Date.now().toString(36)}-${(lineSeq++).toString(36)}`, text, at: new Date() });
/** Every record of an object: the three built in, or an owner-made object's. */
export const recordsIn = (state: AppState, object: ObjectId): ReadonlyArray<AnyRecord> => (object === 'people' ? state.people : object === 'companies' ? state.companies : object === 'deals' ? state.deals : state.customRecords[object] ?? []);
/** The state with one object's records replaced. */
const withRecords = (state: AppState, object: ObjectId, list: ReadonlyArray<AnyRecord>): AppState => (object === 'people' ? { ...state, people: list as ReadonlyArray<Person> } : object === 'companies' ? { ...state, companies: list as ReadonlyArray<Company> } : object === 'deals' ? { ...state, deals: list as ReadonlyArray<Deal> } : { ...state, customRecords: { ...state.customRecords, [object]: list as ReadonlyArray<CustomRecord> } });
const upsert = <T extends { readonly id: string }>(list: ReadonlyArray<T>, item: T): ReadonlyArray<T> => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]);

/** The one reducer: new objects only. */
export function appReducer(state: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'task/set': {
      // Ticking a repeating task done adds the next one, due on the next day by its rule (once: undoing and re-ticking adds no second copy).
      const was = state.tasks.find((t) => t.id === a.task.id);
      const tasks = upsert(state.tasks, a.task);
      if (!a.task.done || was?.done || !a.task.repeat || !a.task.due) return { ...state, tasks };
      const due = nextDue(a.task.due, a.task.repeat);
      if (state.tasks.some((t) => !t.done && t.title === a.task.title && t.due?.getTime() === due.getTime())) return { ...state, tasks };
      return { ...state, tasks: [...tasks, { ...a.task, id: newId('t'), done: false, due, created: new Date() }] };
    }
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
      const list = recordsIn(state, a.object);
      const binned = list.filter((x) => gone.has(x.id)).map((record) => ({ id: `tr-${record.id}`, object: a.object, record, at: new Date(), by: state.me }));
      const many = state.objects.find((o) => o.id === a.object)?.many.toLowerCase() ?? a.object;
      return { ...withRecords(state, a.object, list.filter((x) => !gone.has(x.id))), trash: [...binned, ...state.trash], history: [line(`${state.me} deleted ${binned.length === 1 ? binned[0]?.record.name ?? 'a record' : `${binned.length} ${many}`}`), ...state.history] };
    }
    case 'records/fields': {
      // A stage move stamps when it happened; every real change becomes a line on the record's timeline.
      const list = recordsIn(state, a.object);
      const LABEL: Readonly<Record<string, string>> = { name: 'Name', title: 'Job title', email: 'Email', phone: 'Phone', stage: 'Stage', lostReason: 'Lost reason', lostNote: 'Lost note', amount: 'Amount', owner: 'Owner', companyId: 'Company', close: 'Close date', industry: 'Industry', city: 'City', domain: 'Domain', size: 'Size' };
      const show = (k: string, v: unknown) => (k === 'companyId' ? state.companies.find((c) => c.id === v)?.name ?? 'none' : k === 'amount' ? inr(Number(v) || 0) : v instanceof Date ? v.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : String(v ?? '') || 'empty');
      const lines: Activity[] = [];
      const changes = a.changes.map((c) => {
        const was = list.find((x) => x.id === c.id) as Readonly<Record<string, unknown>> | undefined; if (!was) return c;
        for (const [k, v] of Object.entries(c.patch)) {
          if (k === 'tags' || k === 'stageAt') continue;
          if (k === 'extra') { const ex = (v ?? {}) as Readonly<Record<string, string>>; const before = (was.extra ?? {}) as Readonly<Record<string, string>>; for (const [ek, ev] of Object.entries(ex)) { if (before[ek] === ev) continue; const name = state.objects.find((o) => o.id === a.object)?.attributes.find((x) => x.id === ek)?.name ?? ek; lines.push({ id: newId('a'), record: { object: a.object, id: c.id }, kind: 'changed', actor: state.me, text: ev ? `set ${name} to ${ev}` : `cleared ${name}`, at: new Date() }); } continue; }
          if (!LABEL[k] || String(was[k] ?? '') === String(v ?? '')) continue;
          lines.push({ id: newId('a'), record: { object: a.object, id: c.id }, kind: 'changed', actor: state.me, text: v === '' || v === undefined ? `cleared ${LABEL[k]}` : `changed ${LABEL[k]} to ${show(k, v)}`, at: new Date() });
        }
        return a.object === 'deals' && 'stage' in c.patch && c.patch.stage !== was.stage ? { ...c, patch: { ...c.patch, stageAt: new Date() } } : c;
      });
      const by = new Map(changes.map((c) => [c.id, c.patch]));
      // `extra` merges key by key, so an Undo of one custom field never touches the others.
      const apply = <T extends { readonly id: string }>(x: T): T => { const patch = by.get(x.id); if (!patch) return x; const ex = patch.extra as Readonly<Record<string, string>> | undefined; return { ...x, ...patch, ...(ex ? { extra: { ...((x as { readonly extra?: Readonly<Record<string, string>> }).extra ?? {}), ...ex } } : {}) }; };
      const next = withRecords(state, a.object, list.map(apply));
      return lines.length ? { ...next, activity: [...lines, ...next.activity] } : next;
    }
    case 'records/untrash': {
      const items = state.trash.filter((t) => a.ids.includes(t.record.id)); if (items.length === 0) return state;
      const objects = [...new Set(items.map((t) => t.object))];
      const back = objects.reduce((st, o) => withRecords(st, o, [...items.filter((t) => t.object === o).map((t) => t.record), ...recordsIn(st, o)]), state);
      return { ...back, trash: state.trash.filter((t) => !items.includes(t)), history: [line(`${state.me} restored ${items.length === 1 ? items[0]?.record.name ?? 'a record' : `${items.length} records`}`), ...state.history] };
    }
    case 'records/drop': {
      const gone = new Set(a.ids);
      const next = withRecords(state, a.object, recordsIn(state, a.object).filter((x) => !gone.has(x.id)));
      return { ...next, history: a.note ? [line(a.note), ...state.history] : state.history };
    }
    case 'records/relink': {
      const hit = (r: RecordLink | undefined, id: string) => r !== undefined && r.object === a.from.object && r.id === a.from.id && (!a.only || a.only.includes(id));
      const mv = <T extends { readonly id: string; readonly record?: RecordLink }>(x: T): T => (hit(x.record, x.id) ? { ...x, record: a.to } : x);
      const ok = (id: string) => !a.only || a.only.includes(id);
      return { ...state, tasks: state.tasks.map((t) => { const m = mv(t); return m.also ? { ...m, also: m.also.map((r) => (r.object === a.from.object && r.id === a.from.id && ok(t.id) ? a.to : r)) } : m; }), notes: state.notes.map(mv), comments: state.comments.map(mv), activity: state.activity.map(mv), inbox: state.inbox.map(mv), files: state.files.map(mv),
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
    case 'link/offline': return { ...state, linkOffline: a.offline, history: [line(`${state.me} took the link page ${a.offline ? 'offline' : 'back online'}`), ...state.history] };
    case 'link/publish': return { ...state, linkPage: a.page, linkOffline: false, linkDraft: undefined, setupDone: state.setupDone.includes('link') ? state.setupDone : [...state.setupDone, 'link'], history: [line(`${state.me} published the link page`), ...state.history] };
    case 'insights/link': return { ...state, insightsLink: a.link };
    case 'insights/shares': return { ...state, insightsShares: a.shares };
    case 'visit/add': return { ...state, visits: [a.visit, ...(state.visits ?? [])] };
    case 'visit/patch': return { ...state, visits: (state.visits ?? []).map((v) => (v.id === a.id ? { ...v, ...a.patch } : v)) };
    case 'link/handle': return { ...state, linkHandle: a.handle, history: [line(`${state.me} claimed timefix.com/${a.handle}`), ...state.history] };
    case 'team/pages': return { ...state, teamPages: a.pages };
    case 'linkpage/set': return { ...state, linkPages: [...(state.linkPages ?? []).filter((x) => x.id !== a.page.id), a.page] };
    case 'linkpage/patch': return { ...state, linkPages: (state.linkPages ?? []).map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'linkpage/remove': return { ...state, linkPages: (state.linkPages ?? []).filter((x) => x.id !== a.id) };
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
      return withRecords(rest, t.object, [t.record, ...recordsIn(state, t.object)]);
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
    case 'activity/set': return { ...state, activity: upsert(state.activity, a.activity) };
    case 'activity/remove': return { ...state, activity: state.activity.filter((x) => x.id !== a.id) };
    case 'comment/remove': return { ...state, comments: state.comments.filter((c) => c.id !== a.id) };
    case 'objects/order': return { ...state, objects: [...a.ids.map((id) => state.objects.find((o) => o.id === id)).filter((o): o is ObjectSchema => o !== undefined), ...state.objects.filter((o) => !a.ids.includes(o.id))] };
    case 'automation/set': return { ...state, automations: state.automations.some((x) => x.id === a.automation.id) ? state.automations.map((x) => (x.id === a.automation.id ? a.automation : x)) : [...state.automations, a.automation] };
    case 'automation/remove': return { ...state, automations: state.automations.filter((x) => x.id !== a.id) };
    case 'automation/insert': return { ...state, automations: [...state.automations.slice(0, a.at), a.automation, ...state.automations.slice(a.at)].filter((x, n, all) => all.findIndex((y) => y.id === x.id) === n) };
    case 'automations/tick': return state;
    case 'run/add': return { ...state, runs: [...a.runs, ...state.runs].slice(0, 200) };
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
  const d = (id: string, name: string, companyId: string, contactId: string, stage: Stage, amount: number, owner: string, closeIn: number, ago: number): Deal => ({ id, name, companyId, contactId, stage, amount, owner, close: dayAt(now, closeIn), created: dayAt(now, -ago), stageAt: dayAt(now, -Math.round(ago * 0.7)) });
  const deals: Deal[] = [
    d('d-acme', 'Acme rollout, 400 seats', 'c-acme', 'p-liam', 'Proposal', 1840000, 'Priya Raman', 12, 60),
    d('d-acme2', 'Acme support plan', 'c-acme', 'p-maria', 'Qualified', 420000, 'Priya Raman', 40, 20),
    d('d-globex', 'Globex platform', 'c-globex', 'p-noor', 'Qualified', 960000, 'Sam Kim', 25, 45),
    d('d-initech', 'Initech pilot', 'c-initech', 'p-ben', 'Lead', 180000, 'Jo Mendes', 55, 15),
    d('d-umbrella', 'Umbrella clinics', 'c-umbrella', 'p-amara', 'Proposal', 1250000, 'Priya Raman', 8, 44),
    { ...d('d-hooli', 'Hooli enterprise', 'c-hooli', 'p-gavin', 'Lost', 2600000, 'Sam Kim', -5, 38), lostReason: 'Went with a competitor', lostNote: 'Chose an in-house tool; budget went to their platform team.' },
    d('d-pied', 'Pied Piper starter', 'c-pied', 'p-dinesh', 'Won', 240000, 'Ava Chen', -10, 30),
    d('d-wayne', 'Wayne fleet', 'c-wayne', 'p-lucius', 'Lead', 640000, 'Jo Mendes', 70, 18),
    d('d-stark', 'Stark stores', 'c-stark', 'p-pepper', 'Qualified', 520000, 'Ava Chen', 30, 9),
    d('d-umbrella2', 'Umbrella renewal', 'c-umbrella', 'p-ravi', 'Won', 380000, 'Priya Raman', -20, 50),
  ];
  const me = 'Priya Raman';
  const t = (id: string, title: string, due: number | undefined, assignee: string, record?: RecordLink, done = false, createdBy?: string): AppTask => ({ id, title, due: due === undefined ? undefined : dayAt(now, due, 17), assignee, record, done, created: dayAt(now, -3), createdBy });
  const tasks: AppTask[] = [
    { ...t('t-1', 'Send the revised proposal to Liam', 0, me, { object: 'deals', id: 'd-acme' }), also: [{ object: 'people', id: 'p-liam' }] },
    t('t-2', 'Book a security review with Amara', 1, me, { object: 'people', id: 'p-amara' }),
    { ...t('t-3', 'Chase signed order form', -2, me, { object: 'deals', id: 'd-umbrella' }), priority: 'high' },
    t('t-4', 'Prepare QBR deck for Globex', 3, 'Sam Kim', { object: 'companies', id: 'c-globex' }, false, 'Priya Raman'),
    t('t-5', 'Intro call follow-up', 0, me, { object: 'people', id: 'p-pepper' }),
    { ...t('t-6', 'Update forecast for the quarter', 6, me), repeat: 'month' },
    t('t-7', 'Share case study with Ravi', undefined, me, { object: 'people', id: 'p-ravi' }),
    t('t-8', 'Confirm pilot scope', -1, 'Jo Mendes', { object: 'deals', id: 'd-initech' }, false, 'Priya Raman'),
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
    i('i-6', 'form', 'Pepper Potts', 'sent Talk to sales, filed as', 35, false, { excerpt: 'Our stores book demos by phone. We lose half of them.', record: { object: 'people', id: 'p-pepper' } }),
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
    visits: seedVisits(now),
    linkPages: [{ id: 'lp-company', kind: 'company', name: 'Northwind', handle: 'northwind', members: members.map((m) => m.name), editors: ['Priya Raman', 'Sam Kim'], live: true, made: dayAt(now, -20),
      page: { profile: { name: 'Northwind', title: 'Sales software for small teams', bio: 'Book a call with whoever is free, or find one of us below.' }, socials: [{ id: 's1', network: 'linkedin', url: 'https://linkedin.com/company/northwind' }, { id: 's2', network: 'website', url: 'https://northwind.com' }],
        blocks: [{ kind: 'booking', id: 'c1', title: 'Talk to sales', durationMinutes: 30, location: { kind: 'video', label: 'Google Meet' } }, { kind: 'link', id: 'c2', title: 'Pricing', href: 'https://northwind.com/pricing', icon: 'globe', clicks: 318 }, { kind: 'link', id: 'c3', title: 'Read the guide', href: 'https://northwind.com/guide', icon: 'book', clicks: 96 }],
        look: 'calm', accent: '#0F766E' } }],
    teamPages: [{ id: 'tp-sam', name: 'Sam Kim', email: 'sam@northwind.com', handle: 'sam', status: 'live', blocks: 4, at: dayAt(now, -12) }, { id: 'tp-ava', name: 'Ava Chen', email: 'ava@northwind.com', handle: 'ava', status: 'invited', blocks: 0, at: dayAt(now, -1) }],
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
    automations: [
      { id: 'au-1', on: true, runAs: me, created: dayAt(now, -14), lastRun: dayAt(now, -2, 15), trigger: { kind: 'changed', object: 'deals', field: 'stage', to: 'Won' }, conditions: [], match: 'all', actions: [{ kind: 'task', title: 'Send contract', who: 'owner', days: 1 }] },
      { id: 'au-2', on: false, runAs: 'Sam Kim', created: dayAt(now, -20), trigger: { kind: 'created', object: 'deals' }, conditions: [{ id: 'ac1', field: 'amount', operator: 'is greater than', values: ['1000000'] }], match: 'all', actions: [{ kind: 'notify', who: 'Priya Raman', message: 'A big deal just came in' }] },
    ],
    runs: [
      { id: 'run-1', automationId: 'au-1', at: dayAt(now, -2, 15), record: { object: 'deals', id: 'd-pied' }, status: 'done', did: 'Made the task “Send contract” for Ava Chen' },
      { id: 'run-2', automationId: 'au-1', at: dayAt(now, -9, 11), record: { object: 'deals', id: 'd-umbrella2' }, status: 'failed', reason: 'A required value is missing', did: 'Couldn’t make the task' },
    ],
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
  if (!isBuiltIn(r.object)) { const o = state.objects.find((y) => y.id === r.object); const x = (state.customRecords[r.object] ?? []).find((y) => y.id === r.id); return { name: x?.name ?? `Deleted ${o?.one.toLowerCase() ?? 'record'}`, sub: o?.one ?? '' }; }
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
    reached: { 'q-name': 64, 'q-email': 41, 'q-company': 33, 'q-size': 14, 'q-need': 9 },
    after: { kind: 'booking', message: 'Thanks! Pick a time and we’ll walk you through it.' },
    seen: 6,
    responses: [
      r('r1', 35, 'Pepper Potts', 'pepper@stark.store', 'Stark Retail', '51–200', 'Our stores book demos by phone. We lose half of them.', { personId: 'p-pepper', record: { object: 'people', id: 'p-pepper' }, secs: 74, from: { source: 'Google', medium: 'cpc', campaign: 'demo-q4', page: 'northwind.com/pricing', via: 'popup' } }),
      r('r2', 300, 'Arjun Mehta', 'arjun@zylo.in', 'Zylo', '11–50', 'Need round robin across 6 reps.', { secs: 52, from: { source: 'LinkedIn', medium: 'social', campaign: 'launch', page: 'timefix.com/f/talk-to-sales', via: 'page' } }),
      r('r3', 1500, 'Sana Iqbal', 'sana@brightpath.org', 'Brightpath', '2–10', 'Want booking pages for our counsellors.', { state: 'review', why: 'It looked doubtful, so it waits for you to say.', secs: 9, from: { source: 'Direct', page: 'northwind.com/contact', via: 'inline' } }),
      r('r4', 2900, 'Buy cheap followers', 'promo@spam.biz', '', 'Just me', 'click here', { spam: true, why: 'It is full of links.', secs: 2, from: { source: 'Direct', via: 'own', page: 'northwind.com/contact' } }),
      r('r5', 4300, 'Neel Bhatt', 'neel@orbit.dev', 'Orbit', '200+', 'Replacing our old CRM this quarter.', { secs: 118, from: { source: 'Newsletter', medium: 'email', campaign: 'oct-digest', page: 'timefix.com/f/talk-to-sales', via: 'page' } }),
      r('r6', 6100, 'Lena Fox', 'lena@quill.co', 'Quill', '11–50', 'Moving off spreadsheets.', { state: 'failed', why: 'The record couldn’t be saved: its email is on two people.', secs: 63, from: { source: 'Google', medium: 'organic', page: 'northwind.com/blog/crm-guide', via: 'slide' } }),
      r('r7', 8800, 'Omar Haddad', 'omar@dune.ae', 'Dune', '51–200', 'Round robin for a sales team in Dubai.', { secs: 81, from: { source: 'Instagram', medium: 'social', page: 'timefix.com/f/talk-to-sales', via: 'page' } }),
      r('r8', 12000, 'Mia Wong', 'mia@kite.sg', 'Kite', '2–10', 'Booking pages for two founders.', { secs: 47, from: { source: 'Google', medium: 'organic', page: 'timefix.com/f/talk-to-sales', via: 'page' } }),
      r('r9', 17000, 'Ravi Shah', 'ravi@lumen.in', 'Lumen', '11–50', 'Forms that file into our CRM.', { secs: 95, from: { source: 'LinkedIn', medium: 'social', campaign: 'launch', page: 'northwind.com/pricing', via: 'popup' } }),
    ] };
}
/** A month of visits to the contact form and the link page, the same every load: sources, how far each got, and finishes that match the submissions. */
function seedVisits(now: Date): ReadonlyArray<Visit> {
  let x = 7;
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const pick = <T,>(xs: ReadonlyArray<T>, fallback: T): T => xs[Math.floor(rnd() * xs.length)] ?? fallback;
  const sources: ReadonlyArray<readonly [string, string | undefined]> = [['Google', 'organic'], ['Google', 'organic'], ['Google', 'cpc'], ['Direct', undefined], ['Direct', undefined], ['LinkedIn', 'social'], ['Instagram', 'social'], ['Newsletter', 'email']];
  const out: Visit[] = [];
  for (let d = 0; d < 45; d++) {
    const formViews = 2 + Math.floor(rnd() * 4); const linkViews = 5 + Math.floor(rnd() * 9);
    for (let i = 0; i < formViews; i++) {
      const [source, medium] = pick(sources, ['Direct', undefined] as const);
      const reached = rnd() < 0.3 ? 0 : 1 + Math.floor(rnd() * 5);
      out.push({ id: `vf-${d}-${i}`, at: new Date(now.getTime() - (d * 24 + rnd() * 20) * 3_600_000), page: 'form:f-contact', source, medium, reached: Math.min(reached, 4), finished: false });
    }
    for (let i = 0; i < linkViews; i++) {
      const [source, medium] = pick(sources, ['Direct', undefined] as const);
      const pressed = rnd() < 0.42;
      out.push({ id: `vl-${d}-${i}`, at: new Date(now.getTime() - (d * 24 + rnd() * 20) * 3_600_000), page: 'link', source: source === 'Newsletter' ? 'Instagram' : source, medium, reached: pressed ? 1 : 0, finished: pressed, secs: pressed ? 4 + Math.floor(rnd() * 40) : undefined });
    }
  }
  // The submissions finished their visits.
  const fin: ReadonlyArray<readonly [string, number, string, number]> = [['r1', 35, 'Google', 74], ['r2', 300, 'LinkedIn', 52], ['r3', 1500, 'Direct', 9], ['r5', 4300, 'Newsletter', 118], ['r6', 6100, 'Google', 63], ['r7', 8800, 'Instagram', 81], ['r8', 12000, 'Google', 47], ['r9', 17000, 'LinkedIn', 95]];
  fin.forEach(([ref, mins, source, secs]) => out.push({ id: `vr-${ref}`, at: new Date(now.getTime() - (mins + 2) * 60_000), page: 'form:f-contact', source, reached: 5, finished: true, secs, ref }));
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
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

/** Lists are parked for now (owner, 11 Nov): every way in is hidden while this is false; the data stays so they can return. */
export const LISTS_ON = false;
