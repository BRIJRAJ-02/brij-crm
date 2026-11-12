// Settings › Members, Roles, Sign in rules and an object's Access, as the real app has them: the 36 powers in their groups, custom roles
// with a description, read-only data and scheduling reach, a role's People, moving people when a role goes, bulk role changes,
// "What can X do", the guest-demotion impact, team-delete warnings, and a step-up check before sensitive changes.
import { useState, type ReactNode } from 'react';
import { ArrowLeft, KeyRound, CalendarCheck2, ChevronRight, Eye, Lock, Plus, ShieldCheck, ShieldOff, UserCog, Users, X } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { RolePowers } from '../RolePowers/RolePowers.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { ConfirmDialog, Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Select, type SelectOption } from '../Select/Select.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Link } from '../Link/Link.tsx';
import { InfoTip } from '../Popover/Popover.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { BarButton, BulkActionBar, SaveBar } from '../FloatingBar/FloatingBar.tsx';
import { Menu, MenuItem, MenuSection, MenuTrigger } from '../Menu/Menu.tsx';
import { DisclosureGroup, DisclosureItem } from '../Disclosure/Disclosure.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { Member as ListMember } from '../TeamList/TeamList.tsx';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { newId, type AppAction, type AppState, type CustomRole, type Member, type ObjectSchema } from './data.ts';

type Dispatch = (a: AppAction) => void;
type Grant = 'any' | 'admin' | 'owner';
/** One power: the catalog label (role page, Compare) and the phrase "What can X do" reads. */
export interface PowerDef { readonly id: string; readonly label: string; readonly phrase: string; readonly grant: Grant }
const P = (id: string, label: string, grant: Grant = 'any', phrase = label): PowerDef => ({ id, label, phrase, grant });

/** The real app's 36 powers in their catalog groups. Scheduling's four are set by the two reach selects, not checkboxes. */
export const POWER_GROUPS: ReadonlyArray<{ readonly id: string; readonly title: string; readonly powers: ReadonlyArray<PowerDef> }> = [
  { id: 'workspace', title: 'Workspace', powers: [P('workspace.manage', 'Change workspace settings', 'admin'), P('jobs.manage', 'Manage everyone’s background jobs', 'admin', 'Manage everyone’s imports and jobs'), P('audit.read', 'Read the audit log', 'admin', 'See the workspace’s history')] },
  { id: 'people', title: 'People', powers: [P('members.invite', 'Invite people', 'admin'), P('members.manage', 'Change roles and remove people', 'admin'), P('teams.manage', 'Manage teams', 'admin', 'Change teams'), P('access.manage', 'Manage roles and access', 'admin', 'Change who sees what'), P('link_pages.manage_team', 'Manage team link pages', 'any', 'Edit everyone’s link page and QR code')] },
  { id: 'data', title: 'Data', powers: [P('schema.manage', 'Change objects and attributes', 'any', 'Change objects and fields'), P('views.manage', 'Manage shared views', 'any', 'Lock views and change locked ones'), P('lists.manage', 'Make lists', 'any', 'Make lists and pipelines'), P('records.purge', 'Delete records forever'), P('forms.manage', 'Build forms', 'any', 'Build, publish and pause forms'), P('records.export', 'Export records'), P('automations.manage', 'Build automations', 'any', 'Manage automations'), P('comments.manage', 'Delete anyone’s comments', 'any', 'Delete other people’s comments')] },
  { id: 'scheduling', title: 'Scheduling', powers: [P('booking.manage', 'Take bookings', 'any', 'Make booking pages'), P('booking.admin', 'Manage every booking page', 'any', 'Change other people’s booking pages'), P('availability.own', 'Change your own hours', 'any', 'Change their own hours'), P('schedule.view', 'See everyone’s scheduling'), P('schedule.view.team', 'See their teams’ scheduling'), P('schedule.manage', 'Manage everyone’s scheduling'), P('schedule.manage.team', 'Manage their teams’ scheduling'), P('routing.manage', 'Set up routing', 'admin')] },
  { id: 'business', title: 'Business', powers: [P('hospitality.manage', 'Manage hospitality', 'any', 'Set up the Hospitality apps'), P('hospitality.service', 'Run service'), P('services.manage', 'Manage services', 'any', 'Set up services and staff'), P('services.calendar', 'Run the calendar', 'any', 'Run everyone’s calendar')] },
  { id: 'integrations', title: 'Integrations', powers: [P('api_keys.manage', 'Manage API keys', 'admin'), P('webhooks.manage', 'Manage webhooks', 'admin')] },
  { id: 'owner', title: 'Owner only', powers: [P('workspace.delete', 'Delete the workspace', 'owner'), P('workspace.export', 'Export the whole workspace', 'owner'), P('billing.manage', 'Manage billing', 'owner'), P('support.grant', 'Let support in', 'owner', 'Let support into the workspace'), P('security.manage', 'Change how people sign in', 'owner'), P('connected_apps.manage', 'Connect apps', 'owner', 'Connect outside apps')] },
];
const ALL_POWERS = POWER_GROUPS.flatMap((g) => g.powers);
const SCHED_POWERS = ['schedule.view', 'schedule.view.team', 'schedule.manage', 'schedule.manage.team'];
/** The eight areas "What can X do" reads, in order. */
const AREAS: ReadonlyArray<{ readonly title: string; readonly ids: ReadonlyArray<string> }> = [
  { title: 'Records', ids: ['records.export', 'records.purge'] }, { title: 'Objects and fields', ids: ['schema.manage', 'views.manage', 'lists.manage'] },
  { title: 'Forms and booking', ids: ['forms.manage', 'booking.manage', 'booking.admin'] }, { title: 'Scheduling', ids: ['availability.own', 'schedule.view.team', 'schedule.view', 'schedule.manage.team', 'schedule.manage', 'routing.manage'] },
  { title: 'Business', ids: ['hospitality.manage', 'hospitality.service', 'services.manage', 'services.calendar'] },
  { title: 'People and access', ids: ['members.invite', 'members.manage', 'teams.manage', 'access.manage', 'comments.manage', 'jobs.manage', 'link_pages.manage_team'] },
  { title: 'Connections', ids: ['api_keys.manage', 'webhooks.manage', 'automations.manage', 'connected_apps.manage'] },
  { title: 'Workspace', ids: ['workspace.manage', 'security.manage', 'audit.read', 'billing.manage', 'workspace.export', 'support.grant', 'workspace.delete'] },
];
const BUILT_IN: Readonly<Record<string, ReadonlyArray<string>>> = {
  owner: ALL_POWERS.map((p) => p.id), admin: ALL_POWERS.filter((p) => p.grant !== 'owner').map((p) => p.id), member: ['lists.manage', 'records.export', 'booking.manage', 'availability.own', 'schedule.view.team'], guest: [],
};
const BUILT_NAMES: Readonly<Record<string, string>> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
const BUILT_DESC: Readonly<Record<string, string>> = { owner: 'Everything, including billing and deleting the workspace.', admin: 'Settings, members and every booking page.', member: 'Their own calendar, pages and the shared records.', guest: 'Only what’s shared with guests, read only.' };

/** The role id a member holds: a custom role's id, or owner, admin, member, guest. */
export const roleIdOf = (m: Member) => m.customRole ?? m.role.toLowerCase();
/** A role's name by id. */
export const roleName = (state: AppState, id: string) => BUILT_NAMES[id] ?? state.prefs.roles?.find((r) => r.id === id)?.name ?? 'Member';
/** The powers a role holds. */
export const holdsOf = (state: AppState, id: string): ReadonlyArray<string> => BUILT_IN[id] ?? state.prefs.grants[id] ?? [];
const a = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const rank = (state: AppState, id: string) => (id === 'owner' ? 5 : id === 'admin' ? 4 : id === 'member' ? 3 : id === 'guest' ? 0 : state.prefs.roles?.find((r) => r.id === id)?.readOnly ? 1 : 2.5);
/** Every role as a Select option: built-in first, then the workspace's own. */
export function roleOptions(state: AppState, withOwner = true): ReadonlyArray<SelectOption> {
  return [...(withOwner ? ['owner'] : []), 'admin', 'member', 'guest'].map((id) => ({ id, label: BUILT_NAMES[id] ?? id, description: BUILT_DESC[id] }))
    .concat((state.prefs.roles ?? []).map((r) => ({ id: r.id, label: r.name, description: r.description || 'Custom role' })));
}
const reachOf = (state: AppState, id: string): { readonly see: 'own' | 'team' | 'all'; readonly manage: 'own' | 'team' | 'all' } => {
  if (id === 'owner' || id === 'admin') return { see: 'all', manage: 'all' };
  const c = state.prefs.roles?.find((r) => r.id === id);
  if (c) return { see: c.see ?? 'own', manage: c.manage ?? 'own' };
  return id === 'member' ? { see: 'team', manage: 'own' } : { see: 'own', manage: 'own' };
};
const REACH: Readonly<Record<string, string>> = { own: 'Only their own', team: 'Their teams', all: 'Everyone' };

/** What changes when someone becomes a guest: pages they alone host pause, round robins, bookings needing a host, scheduling shares. */
export function guestImpact(state: AppState, bookings: BookingsState | undefined, name: string): ReadonlyArray<string> {
  const n = (k: number, one: string, many: string) => (k === 1 ? one : many).replace('{n}', String(k));
  const out: string[] = [];
  const owned = state.people.filter((x) => x.owner === name).length + state.deals.filter((x) => x.owner === name).length + state.companies.filter((x) => x.owner === name).length;
  if (owned) out.push(n(owned, '{n} record stays theirs, read only', '{n} records stay theirs, read only'));
  if (bookings) {
    const pages = bookings.pages.filter((p) => p.isOn && p.hosts.length === 1 && p.hosts[0] === name).length; if (pages) out.push(n(pages, '{n} page paused', '{n} pages paused'));
    const rr = bookings.groups.filter((g) => g.members.some((x) => x.name === name)).length; if (rr) out.push(n(rr, 'Leaves {n} round robin', 'Leaves {n} round robins'));
    const need = bookings.meetings.filter((m) => m.host === name && m.start > new Date() && m.status !== 'cancelled').length; if (need) out.push(n(need, '{n} booking needs a host', '{n} bookings need a host'));
    const shares = (bookings.grants ?? []).filter((g) => g.owner === name || g.to === name).length; if (shares) out.push(n(shares, '{n} scheduling share removed', '{n} scheduling shares removed'));
  }
  return out;
}

/** The rows TeamList draws: role (custom roles too), invited by and expiry, works in, two factor and calendar. */
export function memberRows(state: AppState, now: Date): ReadonlyArray<ListMember> {
  const p = state.prefs; const isMgr = ['Owner', 'Admin'].includes(state.members.find((m) => m.name === state.me)?.role ?? '');
  const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);
  return [
    ...state.members.map((m, k) => {
      const teams = p.teams.filter((t) => t.members.includes(m.name)).map((t) => t.name);
      const twofa = m.name === state.me ? p.twoFactor : m.twoFactor === true;
      return { id: m.id, name: m.name, email: m.email, role: roleIdOf(m), status: 'active' as const, seen: new Date(now.getTime() - k * 3_600_000 * 5), isYou: m.name === state.me,
        sub: `${m.email}${m.name === state.me ? ' · You' : ''}${teams.length ? ` · ${teams.join(', ')}` : ''}`,
        isRoleLocked: m.role === 'Owner' && state.members.find((x) => x.name === state.me)?.role !== 'Owner',
        details: isMgr ? <>
          <Tag size="sm" hue={twofa ? 'green' : 'gray'} icon={twofa ? <ShieldCheck size={12} strokeWidth={1.75} /> : <ShieldOff size={12} strokeWidth={1.75} />}>{twofa ? '2FA' : 'No 2FA'}</Tag>
          {m.role !== 'Guest' && <Tag size="sm" hue={m.calendar === 'connected' ? 'green' : m.calendar === 'reconnect' ? 'orange' : 'gray'} icon={<CalendarCheck2 size={12} strokeWidth={1.75} />}>{m.calendar === 'connected' ? 'Calendar' : m.calendar === 'reconnect' ? 'Reconnect' : 'No calendar'}</Tag>}
        </> : undefined };
    }),
    ...p.invites.map((iv) => {
      const left = iv.expires ? days(iv.expires) : undefined; const gone = left !== undefined && left < 0;
      return { id: iv.id, name: iv.email, email: iv.email, role: iv.role, status: 'invited' as const, seen: iv.at,
        sub: `Invited by ${iv.by ?? state.me}${left === undefined ? '' : gone ? ' · expired' : left === 0 ? ' · expires today' : ` · expires in ${left} ${left === 1 ? 'day' : 'days'}`}`,
        statusTag: gone ? { label: 'Invitation expired', status: 'failed' as const } : undefined };
    }),
  ];
}

/** "What Sam can do": their role's powers by area (All, Some, None), and how far they reach into scheduling. */
export function CapabilitiesDialog({ state, member, onClose, onOpenRole }: { readonly state: AppState; readonly member: Member; readonly onClose: () => void; readonly onOpenRole: (id: string) => void }) {
  const id = roleIdOf(member); const held = holdsOf(state, id); const first = member.name.split(' ')[0] ?? member.name;
  const ro = id === 'guest' || state.prefs.roles?.find((r) => r.id === id)?.readOnly;
  const reach = reachOf(state, id);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`What ${first} can do`} size="wide"
      actions={<>{id !== 'guest' && <Button variant="ghost" onPress={() => { onClose(); onOpenRole(id); }}>Open role</Button>}<Button variant="primary" slot="close">Done</Button></>}>
      <div className="tf-set__caps">
        <p className="tf-set__capsum"><Tag size="sm" hue="blue">{roleName(state, id)}</Tag> {ro ? 'Can see records, but not change them.' : 'Everyone can see and change records, and make notes, tasks and comments.'}</p>
        <ul className="tf-set__list tf-set__list--center" aria-label={`What the ${roleName(state, id)} role can do`}>{AREAS.map((ar) => {
          const has = ar.ids.filter((x) => held.includes(x)); const not = ar.ids.filter((x) => !held.includes(x));
          const standing = has.length === ar.ids.length ? 'All' : has.length ? 'Some' : 'None';
          return <li key={ar.title}><span><strong>{ar.title}</strong>{standing === 'Some' && <span className="tf-rec__muted">Can’t: {not.map((x) => ALL_POWERS.find((p) => p.id === x)?.phrase.toLowerCase()).join(', ')}</span>}</span>
            <Tag size="sm" hue={standing === 'All' ? 'green' : standing === 'Some' ? 'orange' : 'gray'}>{standing}</Tag></li>;
        })}</ul>
        {id !== 'guest' && <dl className="tf-set__facts"><div><dt>Sees scheduling of</dt><dd>{reach.see === 'all' && rank(state, id) < 4 ? 'Everyone but owners and admins' : REACH[reach.see]}</dd></div><div><dt>Manages scheduling of</dt><dd>{REACH[reach.manage]}</dd></div><div><dt>Scheduling managed by</dt><dd>Owners and admins</dd></div></dl>}
      </div>
    </Dialog>
  );
}

/** Changing a role that takes access away asks first; to Guest it lists what changes. */
export function RoleChangeDialog({ state, bookings, member, to, onClose, onConfirm }: { readonly state: AppState; readonly bookings?: BookingsState; readonly member: Member; readonly to: string; readonly onClose: () => void; readonly onConfirm: () => void }) {
  const from = roleIdOf(member); const name = roleName(state, to);
  const body = to === 'guest' ? `${member.name} will see only what’s shared with guests.` : from === 'owner' ? `${member.name} can no longer manage billing or owners.` : from === 'admin' ? `${member.name} can no longer manage members or settings.` : `${member.name} will lose some of what they can do now.`;
  const impact = to === 'guest' ? guestImpact(state, bookings, member.name) : [];
  return (
    <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Make ${member.name} ${a(name)} ${name}?`} confirmLabel={`Make ${name}`} tone="primary" onConfirm={onConfirm}
      consequence={<><span>{body}</span>{impact.length > 0 && <span className="tf-set__impact"><strong>What changes</strong><span className="tf-set__chips">{impact.map((x) => <Tag key={x} size="sm" hue="orange">{x}</Tag>)}</span></span>}</>} />
  );
}

/** The floating bar for ticked members: change their role together, after a confirm. */
export function BulkRoleBar({ state, ids, onClear, onApply }: { readonly state: AppState; readonly ids: ReadonlySet<string>; readonly onClear: () => void; readonly onApply: (role: string) => void }) {
  const [to, setTo] = useState<string>();
  const n = ids.size; const people = n === 1 ? 'person' : 'people';
  const loses = to !== undefined && state.members.filter((m) => ids.has(m.id)).some((m) => rank(state, to) < rank(state, roleIdOf(m)));
  return <>
    <BulkActionBar count={n} onClear={onClear}>
      <MenuTrigger>
        <BarButton icon={<UserCog size={16} strokeWidth={1.75} />} label={`Change role for ${n} ${people}`}>Change role</BarButton>
        <Menu aria-label="Change role" placement="top" onAction={(k) => setTo(String(k))}>{roleOptions(state, false).map((r) => <MenuItem key={r.id} id={r.id} description={r.description}>{r.label}</MenuItem>)}</Menu>
      </MenuTrigger>
    </BulkActionBar>
    {to && <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setTo(undefined); }} title={`Make ${n} ${people} ${roleName(state, to)}?`} tone={loses ? 'danger' : 'primary'} confirmLabel={`Make ${roleName(state, to)}`}
      consequence={loses ? 'Some of them will lose access they have now.' : 'They can do what this role allows straight away.'} onConfirm={() => { const r = to; setTo(undefined); onApply(r); }} />}
  </>;
}

/** Confirming it's you before a sensitive change: a code from the authenticator app (or a backup code), or an emailed code without two factor.
 *  Good for 10 minutes once passed. In the prototype any six digits work except 000000. */
export function StepUp({ twoFactor, needsSecondFactor = false, onVerified }: { readonly twoFactor: boolean; readonly needsSecondFactor?: boolean; readonly onVerified: () => void }) {
  const [backup, setBackup] = useState(false);
  const [sent, setSent] = useState(false);
  const [bad, setBad] = useState<string>();
  const [code, setCode] = useState('');
  const check = (v: string) => { if (v.replace(/\W/g, '').length < 6) { setBad('Enter the code first.'); return; } if (/^0+$/.test(v)) { setBad('That code doesn’t look right. Check it and try again.'); return; } setBad(undefined); onVerified(); };
  if (needsSecondFactor && !twoFactor) return <Callout tone="info">Needs your authenticator app or a backup code.</Callout>;
  if (twoFactor) return (
    <div className="tf-set__stepup">
      <span className="tf-rec__muted">{backup ? 'Enter a backup code. It works once.' : 'Enter the 6 digit code from your authenticator app.'}</span>
      {backup ? <div className="tf-set__row"><TextField label="Backup code" className="tf-set__grow" value={code} onChange={(v) => { setCode(v.toUpperCase()); setBad(undefined); }} placeholder="ABCD-1234" isInvalid={Boolean(bad)} errorMessage={bad} autoFocus /><Button variant="secondary" onPress={() => check(code)}>Check</Button></div>
        : <CodeInput label="Code from your authenticator app" autoFocus isInvalid={Boolean(bad)} errorMessage={bad} onChange={() => setBad(undefined)} onComplete={check} />}
      <Link onPress={() => { setBackup(!backup); setBad(undefined); setCode(''); }}>{backup ? 'Use your authenticator app' : 'Use a backup code'}</Link>
    </div>
  );
  return (
    <div className="tf-set__stepup">
      <span className="tf-rec__muted">{sent ? 'Code sent. Check your email.' : 'We’ll email you a 6 digit code.'}</span>
      {sent ? <><CodeInput label="Code from the email" autoFocus isInvalid={Boolean(bad)} errorMessage={bad} onChange={() => setBad(undefined)} onComplete={check} description="Prototype: any six digits" /><Link onPress={() => setSent(true)}>Send a new code</Link></>
        : <Button variant="secondary" onPress={() => setSent(true)}>Email me a code</Button>}
    </div>
  );
}
/** Has the person confirmed it's them in the last 10 minutes? */
export const stepFresh = (state: AppState) => (state.prefs.stepUpAt ?? 0) > Date.now() - 10 * 60_000;

/* ------------------------------------------------------------------ Roles */

/** Settings › Roles and access: the roles as a list or compared side by side, one role's page, New role, Delete with moving people. */
export function RolesPage({ state, dispatch, startRole, onPreview }: { readonly state: AppState; readonly dispatch: Dispatch; readonly startRole?: string; readonly onPreview: (r: 'Member' | 'Guest') => void }) {
  const { toast } = useToast();
  const p = state.prefs; const custom = p.roles ?? [];
  const [view, setView] = useState<'list' | 'compare'>('list');
  const [open, setOpen] = useState<string | undefined>(startRole);
  const [making, setMaking] = useState<{ readonly from?: string } | undefined>();
  const [deleting, setDeleting] = useState<CustomRole>();
  const def = p.defaultRole ?? 'member';
  const count = (id: string) => state.members.filter((m) => roleIdOf(m) === id).length;
  const all = [...['owner', 'admin', 'member', 'guest'].map((id) => ({ id, name: BUILT_NAMES[id] ?? id, description: BUILT_DESC[id] ?? '', builtIn: true })), ...custom.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '', builtIn: false }))];
  if (open && (BUILT_NAMES[open] || custom.some((r) => r.id === open))) return <RolePage key={open} state={state} dispatch={dispatch} id={open} onBack={() => setOpen(undefined)} onDuplicate={() => setMaking({ from: open })} />;
  return (
    <>
      <SettingsSection title="Roles" description={`What each role can do. A workspace can have at most 20 custom roles; ${custom.length} so far.`}
        action={<span className="tf-set__row"><SegmentedControl size="sm" aria-label="Show roles as" selectedKey={view} onSelectionChange={(k) => setView(k === 'compare' ? 'compare' : 'list')} items={[{ id: 'list', label: 'List' }, { id: 'compare', label: 'Compare' }]} />
          <Button variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />} isDisabled={custom.length >= 20} onPress={() => setMaking({})}>New role</Button></span>}>
        {view === 'list' ? <ul className="tf-set__list">{all.map((r) => (
          <li key={r.id}><button type="button" className="tf-set__open" onClick={() => setOpen(r.id)}>
            <strong>{r.name}{def === r.id && <> <Tag size="sm" hue="blue">Default</Tag></>}</strong><span className="tf-rec__muted tf-num">{r.description || 'No description'} · {count(r.id)} {count(r.id) === 1 ? 'person' : 'people'}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button>
            {!r.builtIn ? <MenuTrigger><IconButton size="sm" label={`Actions for ${r.name}`}><span aria-hidden>···</span></IconButton>
              <Menu aria-label={`Actions for ${r.name}`} placement="bottom end" onAction={(k) => {
                if (k === 'dup') setMaking({ from: r.id });
                else if (k === 'default') { dispatch({ type: 'prefs/set', prefs: { defaultRole: r.id }, note: `${state.me} made ${r.name} the default role` }); toast({ message: `New people join as ${r.name}.`, tone: 'success' }); }
                else if (k === 'delete') setDeleting(custom.find((c) => c.id === r.id));
              }}><MenuItem id="dup">Duplicate</MenuItem>{def !== r.id && <MenuItem id="default">Make default for new people</MenuItem>}<MenuItem id="delete" isDanger>Delete</MenuItem></Menu></MenuTrigger>
              : r.id === 'member' && def !== 'member' ? <Button size="sm" variant="ghost" onPress={() => { dispatch({ type: 'prefs/set', prefs: { defaultRole: 'member' } }); toast({ message: 'New people join as Member.', tone: 'success' }); }}>Make default for new people</Button> : null}
          </li>))}</ul>
          : <RolePowers roles={all.map((r) => ({ id: r.id, name: r.name, isLocked: r.id === 'owner', isFixed: r.builtIn && r.id !== 'owner', isCustom: !r.builtIn }))} defaultExpanded={['people', 'data']}
            areas={POWER_GROUPS.map((g) => ({ id: g.id, title: g.title, powers: g.powers.map((x) => ({ id: x.id, label: x.label, isBuiltInOnly: x.grant !== 'any' })) }))}
            grants={Object.fromEntries(all.map((r) => [r.id, holdsOf(state, r.id)]))} note="Built in roles can’t be changed. Make a custom role instead."
            onChange={(role, power, held) => { const was = p.grants[role] ?? []; dispatch({ type: 'prefs/set', prefs: { grants: { ...p.grants, [role]: held ? [...was, power] : was.filter((x) => x !== power) } }, note: `${state.me} changed what ${roleName(state, role)} can do` }); toast({ message: `${roleName(state, role)} saved.`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ grants: { ...q.grants, [role]: was } }) }) } }); }} />}
      </SettingsSection>
      <SettingsSection title="See it as they do" description="Look around the app as a member or a guest would. Nothing changes while you preview.">
        <div className="tf-set__row"><Button variant="secondary" onPress={() => onPreview('Member')}>Preview as a member</Button><Button variant="secondary" onPress={() => onPreview('Guest')}>Preview as a guest</Button></div>
      </SettingsSection>
      {making && <NewRoleDialog state={state} from={making.from} onClose={() => setMaking(undefined)} onCreate={(r, grants) => {
        dispatch({ type: 'prefs/set', prefs: { roles: [...custom, r], grants: { ...p.grants, [r.id]: grants } }, note: `${state.me} made the role ${r.name}` });
        setMaking(undefined); toast({ message: making.from ? `${r.name} made.` : `${r.name} created.`, tone: 'success' }); setOpen(r.id);
      }} />}
      {deleting && <DeleteRoleDialog state={state} role={deleting} onClose={() => setDeleting(undefined)} onDelete={(to) => {
        const r = deleting; const moving = state.members.filter((m) => m.customRole === r.id);
        for (const m of moving) dispatch({ type: 'member/set', member: { ...m, role: to === 'member' ? 'Member' : 'Member', customRole: to === 'member' ? undefined : to } });
        dispatch({ type: 'prefs/set', prefs: { roles: custom.filter((c) => c.id !== r.id), defaultRole: def === r.id ? 'member' : def }, note: `${state.me} deleted the role ${r.name}` });
        setDeleting(undefined); toast({ message: `${r.name} deleted. ${moving.length} ${moving.length === 1 ? 'person' : 'people'} moved.` });
      }} />}
    </>
  );
}

function NewRoleDialog({ state, from, onClose, onCreate }: { readonly state: AppState; readonly from?: string; readonly onClose: () => void; readonly onCreate: (r: CustomRole, grants: ReadonlyArray<string>) => void }) {
  const custom = state.prefs.roles ?? [];
  const src = from ? (custom.find((c) => c.id === from) ?? { id: from, name: roleName(state, from) }) : undefined;
  const [name, setName] = useState(src ? `${src.name} copy` : '');
  const [desc, setDesc] = useState('');
  const [start, setStart] = useState(from ?? 'member');
  const [tried, setTried] = useState(false);
  const clash = [...custom.map((c) => c.name), ...Object.values(BUILT_NAMES)].some((x) => x.toLowerCase() === name.trim().toLowerCase());
  const create = () => {
    setTried(true); if (!name.trim() || clash) return;
    const base = custom.find((c) => c.id === start);
    onCreate({ id: newId('role'), name: name.trim(), description: desc.trim() || undefined, readOnly: start === 'viewer' ? true : base?.readOnly, see: base?.see ?? (start === 'viewer' ? 'own' : 'team'), manage: base?.manage ?? 'own' },
      start === 'viewer' ? [] : holdsOf(state, start).filter((x) => ALL_POWERS.find((p) => p.id === x)?.grant === 'any'));
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={from ? 'Duplicate role' : 'New role'} description="It starts with the permissions you pick; change any of them after."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={create}>Create role</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} autoFocus placeholder="Sales lead" maxLength={40} isInvalid={(tried && !name.trim()) || clash} errorMessage={clash ? 'A role has this name' : tried && !name.trim() ? 'Name the role.' : undefined} />
        <TextArea label="Description" value={desc} onChange={setDesc} placeholder="What this role is for" maxLength={200} />
        {!from && <Select label="Start from" value={start} onChange={(v) => v && setStart(v)} items={[{ id: 'member', label: 'Member', description: 'Member’s permissions' }, { id: 'viewer', label: 'Viewer', description: 'Read only, no permissions' }, ...custom.map((c) => ({ id: c.id, label: c.name, description: 'Custom' }))]} />}
      </div>
    </Dialog>
  );
}

function DeleteRoleDialog({ state, role, onClose, onDelete }: { readonly state: AppState; readonly role: CustomRole; readonly onClose: () => void; readonly onDelete: (to: string) => void }) {
  const n = state.members.filter((m) => m.customRole === role.id).length;
  const [to, setTo] = useState('member');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Delete ${role.name}?`} description={n === 0 ? `Nobody has ${role.name}.` : `${n} ${n === 1 ? 'person has' : 'people have'} ${role.name} now.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => onDelete(to)}>Delete role</Button></>}>
      {n > 0 && <Select label={n === 1 ? 'Move them to' : `Move all ${n} to`} value={to} onChange={(v) => v && setTo(v)} items={[{ id: 'member', label: 'Member' }, ...(state.prefs.roles ?? []).filter((c) => c.id !== role.id).map((c) => ({ id: c.id, label: c.name, description: 'Custom' }))]} />}
    </Dialog>
  );
}

/** One role: details (name, description, data access), permissions by group with scheduling reach, and its People. Built-in roles read only. */
function RolePage({ state, dispatch, id, onBack, onDuplicate }: { readonly state: AppState; readonly dispatch: Dispatch; readonly id: string; readonly onBack: () => void; readonly onDuplicate: () => void }) {
  const { toast } = useToast();
  const p = state.prefs; const custom = p.roles ?? []; const role = custom.find((r) => r.id === id);
  const builtIn = !role;
  const saved = { name: role?.name ?? roleName(state, id), description: role?.description ?? BUILT_DESC[id] ?? '', readOnly: role?.readOnly ?? id === 'guest', see: reachOf(state, id).see, manage: reachOf(state, id).manage, grants: holdsOf(state, id).filter((x) => !SCHED_POWERS.includes(x)) };
  const [d, setD] = useState(saved);
  const [asking, setAsking] = useState(false);
  const [moving, setMoving] = useState<{ readonly m: Member; readonly to: string }>();
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const holders = state.members.filter((m) => roleIdOf(m) === id);
  const save = () => {
    if (!role) return;
    const sched = [...(d.see === 'all' ? ['schedule.view'] : d.see === 'team' ? ['schedule.view.team'] : []), ...(d.manage === 'all' ? ['schedule.manage'] : d.manage === 'team' ? ['schedule.manage.team'] : [])];
    dispatch({ type: 'prefs/set', prefs: { roles: custom.map((r) => (r.id === id ? { ...r, name: d.name.trim() || r.name, description: d.description.trim() || undefined, readOnly: d.readOnly, see: d.see, manage: d.manage } : r)), grants: { ...p.grants, [id]: [...d.grants, ...sched] } }, note: `${state.me} changed the role ${d.name}` });
    toast({ message: `${d.name} saved.`, tone: 'success' });
  };
  const access = JSON.stringify({ ...d, name: '', description: '' }) !== JSON.stringify({ ...saved, name: '', description: '' });
  const order: ReadonlyArray<'own' | 'team' | 'all'> = ['own', 'team', 'all'];
  return (
    <div className="tf-set__obj">
      <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onBack}>Roles</Button>
      {builtIn && <Callout tone="info" action={id !== 'owner' ? { label: 'Duplicate', onPress: onDuplicate } : undefined}>Built in roles can’t be changed. Make a custom role instead.</Callout>}
      <Tabs aria-label={saved.name} items={[{ id: 'perms', label: 'Permissions' }, { id: 'people', label: 'People', count: holders.length }]}>
        <TabPanel id="perms"><div className="tf-set__sections">
          <SettingsSection title={saved.name}><div className="tf-rec__form tf-set__narrow">
            {!builtIn && <TextField label="Name" value={d.name} onChange={(v) => setD({ ...d, name: v })} maxLength={40} />}
            {!builtIn ? <TextArea label="Description" value={d.description} onChange={(v) => setD({ ...d, description: v })} placeholder="What this role is for" maxLength={200} /> : <p className="tf-rec__muted">{saved.description}</p>}
            <Select label="Data access" isDisabled={builtIn} value={d.readOnly ? 'read' : 'write'} onChange={(v) => v && setD({ ...d, readOnly: v === 'read' })} items={[{ id: 'write', label: 'Read and write' }, { id: 'read', label: 'Read only' }]} description="Read only people see records but can’t create, edit or delete them." />
          </div></SettingsSection>
          {POWER_GROUPS.filter((g) => !(g.id === 'owner' && !builtIn)).map((g) => {
            const shown = g.powers.filter((x) => !SCHED_POWERS.includes(x.id)); const locked = !builtIn && shown.every((x) => x.grant !== 'any');
            return (
              <SettingsSection key={g.id} title={g.title} status={locked ? <Tag size="sm" icon={<Lock size={12} strokeWidth={1.75} />}>Only built in roles can do this</Tag> : undefined}
                description={!builtIn && !locked && shown.some((x) => x.grant !== 'any') ? 'Greyed out ones: only built in roles can do these.' : undefined}>
                <div className="tf-set__sections"><div className="tf-set__perms">{shown.map((x) => <Checkbox key={x.id} isSelected={builtIn ? holdsOf(state, id).includes(x.id) : d.grants.includes(x.id)} isDisabled={builtIn || x.grant !== 'any'}
                  onChange={(on) => setD({ ...d, grants: on ? [...d.grants, x.id] : d.grants.filter((y) => y !== x.id) })}>{x.label}</Checkbox>)}</div>
                {g.id === 'scheduling' && <div className="tf-bkf__pair">
                  <Select label="See other people’s scheduling" isDisabled={builtIn} value={d.see} items={order.map((x) => ({ id: x, label: REACH[x] ?? x }))} description="Calendars, hours, time off and bookings."
                    onChange={(v) => { if (!v) return; const see = v as 'own' | 'team' | 'all'; setD({ ...d, see, manage: order.indexOf(d.manage) > order.indexOf(see) ? see : d.manage }); }} />
                  <Select label="Manage other people’s scheduling" isDisabled={builtIn} value={d.manage} items={order.map((x) => ({ id: x, label: REACH[x] ?? x }))} description="Manage includes See."
                    onChange={(v) => { if (!v) return; const manage = v as 'own' | 'team' | 'all'; setD({ ...d, manage, see: order.indexOf(d.see) < order.indexOf(manage) ? manage : d.see }); }} />
                </div>}</div>
              </SettingsSection>
            );
          })}
        </div></TabPanel>
        <TabPanel id="people">
          {holders.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title="Nobody has this role" description="Give it to someone from Members, or here once they have it." />
            : <ul className="tf-set__list">{holders.map((m) => <li key={m.id}><PersonLine name={m.name} sub={m.email} />
              {m.role !== 'Owner' && m.name !== state.me ? <Select label={`Role for ${m.name}`} isLabelHidden className="tf-you__select" value={id} items={roleOptions(state, false)}
                onChange={(v) => { if (!v || v === id) return; if (rank(state, v) < rank(state, id)) setMoving({ m, to: v }); else { moveTo(dispatch, state, m, v); toast({ message: `${m.name} is now ${roleName(state, v)}.`, tone: 'success' }); } }} /> : <Tag size="sm">{roleName(state, id)}</Tag>}</li>)}</ul>}
        </TabPanel>
      </Tabs>
      {!builtIn && <SaveBar status={dirty ? 'unsaved' : 'hidden'} onDiscard={() => setD(saved)} onSave={() => { if (holders.length > 0 && access) setAsking(true); else save(); }} />}
      {asking && <ConfirmDialog isOpen onOpenChange={setAsking} title={`Save ${d.name}?`} tone="primary" confirmLabel="Save changes" consequence={`This changes what ${holders.length} ${holders.length === 1 ? 'person' : 'people'} can do.`} onConfirm={() => { setAsking(false); save(); }} />}
      {moving && <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setMoving(undefined); }} title={`Make ${moving.m.name} ${roleName(state, moving.to)}?`} tone="primary" confirmLabel={`Make ${roleName(state, moving.to)}`}
        consequence={`${moving.m.name} will lose some of what they can do now.`} onConfirm={() => { moveTo(dispatch, state, moving.m, moving.to); toast({ message: `${moving.m.name} is now ${roleName(state, moving.to)}.`, tone: 'success' }); setMoving(undefined); }} />}
    </div>
  );
}

/** Gives a member a role by id: built-in roles set their role, custom ones set Member plus the custom role. */
export function moveTo(dispatch: Dispatch, state: AppState, m: Member, to: string, note = true) {
  const built = BUILT_NAMES[to];
  dispatch({ type: 'member/set', member: { ...m, role: built ? (built as Member['role']) : 'Member', customRole: built ? undefined : to }, note: note ? `${state.me} made ${m.name} ${roleName(state, to)}` : undefined });
}

/* ------------------------------------------------------------------ Sign in rules */

/** Settings › Sign in rules: two factor for everyone (you need it yourself first), session length (No limit too), and Sign out everyone after a step-up. */
export function SignInRulesPage({ state, dispatch, onSetUpYours }: { readonly state: AppState; readonly dispatch: Dispatch; readonly onSetUpYours: () => void }) {
  const { toast } = useToast();
  const p = state.prefs; const ws = p.workspace.name;
  const without = state.members.filter((m) => !(m.name === state.me ? p.twoFactor : m.twoFactor)).length;
  const [asking, setAsking] = useState<'require' | 'all' | { readonly days: string }>();
  const [verified, setVerified] = useState(false);
  const fresh = stepFresh(state) || verified;
  const len = p.sessionDays ?? '30';
  const LENS = [{ id: 'none', label: 'No limit' }, { id: '1', label: '1 day' }, { id: '7', label: '7 days' }, { id: '14', label: '14 days' }, { id: '30', label: '30 days' }];
  const lenNum = (x: string) => (x === 'none' ? Infinity : Number(x));
  const setLen = (v: string) => { const was = len; dispatch({ type: 'prefs/set', prefs: { sessionDays: v }, note: `${state.me} set sessions to ${v === 'none' ? 'no limit' : `${v} days`}` }); toast({ message: v === 'none' ? 'No session limit.' : `Sessions last ${v} days.`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: { sessionDays: was } }) } }); };
  const require = (on: boolean) => { dispatch({ type: 'prefs/set', prefs: { rules: { ...p.rules, require2fa: on } }, note: `${state.me} turned required two factor ${on ? 'on' : 'off'}` }); toast({ message: on ? 'Two factor sign in is now required.' : 'Two factor sign in is no longer required.', tone: 'success' }); };
  return (
    <>
      <SettingsSection title="For everyone">
        <div className="tf-set__switch"><span><strong>Require two factor for everyone <InfoTip label="About two factor">A code from an app on their phone, after the email code.</InfoTip></strong>
          <span className="tf-rec__muted tf-num">{!p.twoFactor && !p.rules.require2fa ? <>You need it yourself first. <Link onPress={onSetUpYours}>Set up yours</Link></> : without === 0 ? 'Everyone has it set up.' : `${without} ${without === 1 ? 'person hasn’t' : 'people haven’t'} set it up.`}</span></span>
          <Switch aria-label="Require two factor for everyone" isSelected={p.rules.require2fa} isDisabled={!p.twoFactor && !p.rules.require2fa} onChange={(on) => { if (on && without > 0) setAsking('require'); else require(on); }} /></div>
        <div className="tf-set__switch"><span><strong>Session length <InfoTip label="About session length">Confirming it’s you before a risky change, like signing everyone out, also counts as signing in.</InfoTip></strong><span className="tf-rec__muted">Then everyone signs in again.</span></span>
          <Select label="Session length" isLabelHidden className="tf-you__select" value={len} items={LENS} onChange={(v) => { if (!v || v === len) return; if (lenNum(v) < lenNum(len)) setAsking({ days: v }); else setLen(v); }} /></div>
      </SettingsSection>
      <SettingsSection title="Sign out everyone" tone="danger" description={`Everyone signs in again.${p.signedOutAllAt ? ` Last done ${p.signedOutAllAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}`}
        action={<Button variant="danger" onPress={() => { setVerified(false); setAsking('all'); }}>Sign out everyone</Button>}><span /></SettingsSection>
      {asking === 'require' && <ConfirmDialog isOpen onOpenChange={() => setAsking(undefined)} title="Require two factor sign in?" tone="primary" confirmLabel="Require it" consequence={`${without} ${without === 1 ? 'person' : 'people'} must set it up to open ${ws}.`} onConfirm={() => { setAsking(undefined); require(true); }} />}
      {typeof asking === 'object' && <ConfirmDialog isOpen onOpenChange={() => setAsking(undefined)} title={`Make sessions last ${asking.days} ${asking.days === '1' ? 'day' : 'days'}?`} confirmLabel="Shorten sessions" consequence={`Anyone signed in to ${ws} over ${asking.days} ${asking.days === '1' ? 'day' : 'days'} ago signs in again.`} onConfirm={() => { const v = asking.days; setAsking(undefined); setLen(v); }} />}
      {asking === 'all' && <Dialog isOpen onOpenChange={(o) => { if (!o) setAsking(undefined); }} title="Sign out everyone?" description={`Everyone in ${ws} signs in again. Unsaved work is lost.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" isDisabled={!fresh} onPress={() => { setAsking(undefined); dispatch({ type: 'prefs/set', prefs: { devices: p.devices.filter((x) => x.current), signedOutAllAt: new Date() }, note: `${state.me} signed everyone out` }); toast({ message: 'Everyone was signed out.', tone: 'success' }); }}>Sign out everyone</Button></>}>
        {fresh ? <p className="tf-rec__muted">You confirmed it’s you a moment ago.</p> : <StepUp twoFactor={p.twoFactor} onVerified={() => { setVerified(true); dispatch({ type: 'prefs/update', fn: () => ({ stepUpAt: Date.now() }) }); }} />}
      </Dialog>}
    </>
  );
}

/* ------------------------------------------------------------------ Teams */

/** Deleting a team: one click with Undo, unless people reach scheduling through it; then it asks first. */
export function teamScheduling(state: AppState, teamId: string): number {
  const t = state.prefs.teams.find((x) => x.id === teamId); if (!t) return 0;
  return state.members.filter((m) => t.members.includes(m.name) && (roleIdOf(m) === 'member' || reachOf(state, roleIdOf(m)).see === 'team' || reachOf(state, roleIdOf(m)).manage === 'team')).length;
}
/** The possessive for a team ("Sales’s" → "Sales’"). */
export const poss = (n: string) => (n.endsWith('s') ? `${n}’` : `${n}’s`);

/* ------------------------------------------------------------------ Object access */

type Subject = { readonly id: string; readonly name: string; readonly kind: 'admins' | 'role' | 'guest' | 'team' };
/** An object's Access tab: who can see and edit (roles and teams), which records, fields hidden or read only, Preview as, and what a change took away. */
export function ObjectAccess({ state, o, save }: { readonly state: AppState; readonly o: ObjectSchema; readonly save: (patch: Partial<ObjectSchema>, message?: string) => void }) {
  const p = state.prefs;
  const [lost, setLost] = useState<ReadonlyArray<string>>([]);
  const [fieldsFor, setFieldsFor] = useState('member');
  const [preview, setPreview] = useState<Subject>();
  const roles: ReadonlyArray<Subject> = [{ id: 'admins', name: 'Owners and admins', kind: 'admins' }, { id: 'member', name: 'Members', kind: 'role' }, ...(p.roles ?? []).map((r) => ({ id: r.id, name: r.name, kind: 'role' as const })), { id: 'guest', name: 'Guests', kind: 'guest' }];
  const teams: ReadonlyArray<Subject> = Object.keys(o.teamAccess ?? {}).map((id) => ({ id, name: p.teams.find((t) => t.id === id)?.name ?? 'A team', kind: 'team' as const }));
  const level = (s: Subject): 'edit' | 'view' | 'none' => (s.kind === 'admins' ? 'edit' : s.kind === 'team' ? o.teamAccess?.[s.id] ?? 'view' : o.access?.[s.id] ?? (s.kind === 'guest' ? 'view' : 'edit'));
  const scope = (s: Subject) => (s.kind === 'admins' || s.kind === 'guest' ? 'all' : o.records?.[s.id] ?? 'all');
  const hasOwner = o.attributes.some((x) => x.type === 'actor' || x.id === 'owner');
  const who = (s: Subject) => (s.kind === 'team' ? (p.teams.find((t) => t.id === s.id)?.members.length ?? 0) : s.kind === 'admins' ? state.members.filter((m) => m.role === 'Owner' || m.role === 'Admin').length : state.members.filter((m) => roleIdOf(m) === s.id).length);
  /** What a narrower setting takes away: people, shared views and forms on this object. */
  const impact = (s: Subject) => { const n = who(s); const views = (state.views[o.id] ?? []).filter((v) => !v.isPrivate).length; const forms = state.forms.filter((f) => f.saveTo === o.id).length;
    setLost([`${n} ${n === 1 ? 'person' : 'people'}`, ...(views ? [`${views} shared ${views === 1 ? 'view' : 'views'}`] : []), ...(forms ? [`${forms} ${forms === 1 ? 'form' : 'forms'}`] : [])]); };
  const setLevel = (s: Subject, next: 'edit' | 'view' | 'none') => {
    const was = level(s); const order = ['none', 'view', 'edit'];
    if (s.kind === 'team') save({ teamAccess: { ...(o.teamAccess ?? {}), [s.id]: next === 'none' ? 'view' : next } }, 'Access changed.');
    else save({ access: { ...(o.access ?? {}), [s.id]: next } }, 'Access changed.');
    if (order.indexOf(next) < order.indexOf(was)) impact(s); else setLost([]);
  };
  const subjects = [...roles, ...teams];
  const fieldSubject = subjects.find((s) => s.id === fieldsFor) ?? roles[1];
  const fields = o.fields?.[fieldsFor] ?? {};
  const limited = Object.values(o.fields ?? {}).reduce((n, f) => n + Object.keys(f).length, 0);
  const seen = (s: Subject) => { const l = level(s); const total = (o.id === 'people' ? state.people.length : o.id === 'companies' ? state.companies.length : o.id === 'deals' ? state.deals.length : (state.customRecords[o.id] ?? []).length);
    const sc = scope(s); const own = o.id === 'people' ? state.people.filter((x) => x.owner === state.me).length : Math.ceil(total / 3); return { l, records: l === 'none' ? 0 : sc === 'all' ? total : sc === 'own' ? own : Math.min(total, own * 2), fields: o.attributes.filter((x) => !x.archived && (o.fields?.[s.id]?.[x.id] ?? 'visible') !== 'hidden').length }; };
  const summary = level(roles[1] as Subject) === 'edit' && scope(roles[1] as Subject) === 'all' ? `Everyone can edit ${o.many.toLowerCase()}.` : `Members can ${level(roles[1] as Subject) === 'none' ? 'not see' : level(roles[1] as Subject) === 'view' ? 'view' : 'edit'} ${scope(roles[1] as Subject) === 'own' ? 'their own' : scope(roles[1] as Subject) === 'team' ? 'their team’s' : 'all'} ${o.many.toLowerCase()}.`;
  return (
    <div className="tf-set__sections">
      {preview && (() => { const x = seen(preview); return <Callout tone="info" title={`Previewing as ${preview.name}`} action={{ label: 'Exit preview', onPress: () => setPreview(undefined) }}>
        <span className="tf-set__chips"><span className="tf-rec__muted">Sees</span><Tag size="sm" hue={x.l === 'none' ? 'red' : x.l === 'view' ? 'blue' : 'green'}>{x.l === 'none' ? 'Can’t see' : x.l === 'view' ? 'Can view' : 'Can edit'}</Tag><Tag size="sm">{x.records} records</Tag><Tag size="sm">{x.fields} fields</Tag></span></Callout>; })()}
      <SettingsSection title="Who can do what" description={summary}
        action={<span className="tf-set__row">
          <MenuTrigger><Button variant="secondary" size="sm" icon={<Eye size={14} strokeWidth={1.75} />}>Preview as</Button>
            <Menu aria-label="Preview as" placement="bottom end" onAction={(k) => setPreview(subjects.find((s) => s.id === String(k)) ?? (state.members.some((m) => m.id === String(k)) ? (() => { const m = state.members.find((x) => x.id === String(k)); return m ? { id: roleIdOf(m), name: m.name, kind: roleIdOf(m) === 'guest' ? 'guest' as const : 'role' as const } : undefined; })() : undefined))}>
              <MenuSection title="People">{state.members.filter((m) => m.role !== 'Owner' && m.role !== 'Admin').map((m) => <MenuItem key={m.id} id={m.id}>{m.name}</MenuItem>)}</MenuSection>
              <MenuSection title="Teams">{p.teams.map((t) => <MenuItem key={t.id} id={t.id}>{t.name}</MenuItem>)}</MenuSection>
            </Menu></MenuTrigger>
          {p.teams.length === 0 ? <Button size="sm" variant="secondary" isDisabled>Make a team first</Button> : <MenuTrigger><Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />}>Add team</Button>
            <Menu aria-label="Add team" placement="bottom end" onAction={(k) => { const t = p.teams.find((x) => x.id === String(k)); if (t) save({ teamAccess: { ...(o.teamAccess ?? {}), [t.id]: 'view' } }, `${t.name} added.`); }}>
              {p.teams.filter((t) => !(t.id in (o.teamAccess ?? {}))).map((t) => <MenuItem key={t.id} id={t.id}>{t.name}</MenuItem>)}</Menu></MenuTrigger>}
        </span>}>
        <div className="tf-set__access" role="table" aria-label={`Access to ${o.many}`}>
          <div className="tf-set__accessrow tf-set__accesshead" role="row"><span role="columnheader">Who</span><span role="columnheader">Can see</span><span role="columnheader">Can edit</span><span role="columnheader">Records</span><span role="columnheader"><span className="tf-sr-only">Actions</span></span></div>
          {subjects.map((s) => { const l = level(s); return (
            <div key={s.id} className="tf-set__accessrow" role="row">
              <span role="cell" className="tf-set__accesswho">{s.kind === 'team' ? <Users size={14} strokeWidth={1.75} aria-hidden /> : <KeyRound size={14} strokeWidth={1.75} aria-hidden />}<strong>{s.name}</strong>
                {s.kind === 'admins' && <InfoTip label="About owners and admins">They always see and edit everything.</InfoTip>}{s.kind === 'guest' && <InfoTip label="About guests">Guests can view, never edit.</InfoTip>}</span>
              <span role="cell"><Checkbox aria-label={`${s.name} can see`} isSelected={l !== 'none'} isDisabled={s.kind === 'admins' || s.kind === 'team'} onChange={(on) => setLevel(s, on ? 'view' : 'none')} /></span>
              <span role="cell"><Checkbox aria-label={`${s.name} can edit`} isSelected={l === 'edit'} isDisabled={s.kind === 'admins' || s.kind === 'guest' || l === 'none'} onChange={(on) => setLevel(s, on ? 'edit' : 'view')} /></span>
              <span role="cell">{l === 'none' ? <span className="tf-rec__muted">—</span> : <Select label={`Records ${s.name} see`} isLabelHidden className="tf-you__select" value={scope(s)} isDisabled={s.kind === 'admins' || s.kind === 'guest' || !hasOwner}
                onChange={(v) => { if (!v) return; const next = v as 'all' | 'own' | 'team'; const was = scope(s); save({ records: { ...(o.records ?? {}), [s.id]: next } }, 'Access changed.'); if (was === 'all' && next !== 'all') impact(s); else setLost([]); }}
                items={[{ id: 'all', label: 'All records' }, { id: 'own', label: 'Their own', description: 'Owner is them' }, { id: 'team', label: 'Their team’s', description: 'Owner is on their team' }]} />}</span>
              <span role="cell">{s.kind === 'team' && <IconButton size="sm" label={`Remove ${s.name}`} onPress={() => { const { [s.id]: _gone, ...rest } = o.teamAccess ?? {}; void _gone; save({ teamAccess: rest }, `${s.name} access removed.`); impact(s); }}><X size={14} strokeWidth={1.75} /></IconButton>}</span>
            </div>); })}
        </div>
        {lost.length > 0 && <span className="tf-set__chips" role="status"><Tag size="sm" hue="orange">Less access</Tag>{lost.map((x) => <Tag key={x} size="sm">{x}</Tag>)}</span>}
      </SettingsSection>
      <DisclosureGroup variant="card"><DisclosureItem id="fields" title="Fields" description="Hide a field, or let someone see it without changing it." end={limited ? <Tag size="sm" hue="orange">{limited} limited</Tag> : undefined}>
        <div className="tf-rec__form">
          <Select label="For" className="tf-set__half" value={fieldsFor} onChange={(v) => v && setFieldsFor(v)} items={subjects.filter((s) => s.kind !== 'admins').map((s) => ({ id: s.id, label: s.name }))} />
          {fieldSubject && level(fieldSubject) === 'none' ? <p className="tf-rec__muted">{fieldSubject.name} can’t see {o.many.toLowerCase()}.</p>
            : <ul className="tf-set__list tf-set__list--center">{o.attributes.filter((x) => !x.archived).map((x) => { const primary = x.id === (o.recordName ?? 'name'); return (
              <li key={x.id}><strong>{x.name}</strong><Select label={`${x.name} for ${fieldSubject?.name ?? ''}`} isLabelHidden className="tf-you__select" value={fields[x.id] ?? 'visible'}
                onChange={(v) => { if (!v) return; const nextF = { ...fields } as Record<string, 'read' | 'hidden'>; if (v === 'visible') delete nextF[x.id]; else nextF[x.id] = v as 'read' | 'hidden'; save({ fields: { ...(o.fields ?? {}), [fieldsFor]: nextF } }, 'Fields changed.'); }}
                items={[...(fieldSubject && level(fieldSubject) === 'edit' ? [{ id: 'visible', label: 'Visible' }] : [{ id: 'visible', label: 'Visible' }]), { id: 'read', label: 'Read only' }, ...(primary ? [] : [{ id: 'hidden', label: 'Hidden' }])]} /></li>); })}</ul>}
        </div>
      </DisclosureItem></DisclosureGroup>
    </div>
  );
}

/** A small row of tags, labelled. */
export function Chips({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <span className="tf-set__chips"><span className="tf-rec__muted">{label}</span>{children}</span>;
}
