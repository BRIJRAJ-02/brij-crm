// Grow: Links (everything you share in one place: your page, booking pages, forms, the menu; each with Copy, QR, Open and its numbers),
// the Link page editor (beside the phone; Publish keeps it in the workspace), and Insights, one analytics home with two tabs:
// Pages (what came in through your links, from real bookings and form answers) and Reports (saved CRM charts: new, rename, delete).
import { useRef, useState, type ReactNode } from 'react';
import { NoResults } from '../EmptyState/EmptyState.tsx';
import { Link } from '../Link/Link.tsx';
import { DialogTrigger } from 'react-aria-components';
import { Popover } from '../Popover/Popover.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { ArrowLeft, BarChart3, CalendarDays, Copy, Download, ExternalLink, FileText, IdCard, MoreHorizontal, Pencil, Plus, QrCode as QrIcon, Share2, Store, Trash2, Users, UtensilsCrossed } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { ShareSheet } from '../ShareSheet/ShareSheet.tsx';
import { SocialMark } from '../SocialLinks/SocialLinks.tsx';
import { SharedInsights, ClaimHandle, InsightsNumbers, InsightsShareDialog, LinkInsightsDrawer, SessionsTable, TeamPagesDialog, inScope, sessionsCsv, sessionsOf } from './growparts.tsx';
import { LinkEditor, type LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import { LinkPage } from '../LinkPage/LinkPage.tsx';
import { demoBlocks, demoBooking, demoProfile, demoSocials } from '../LinkPage/LinkPage.demo.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { BarChart, BarList, ChartCard, DonutChart } from '../Chart/Chart.tsx';
import { StatCard } from '../Card/Card.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Select } from '../Select/Select.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { TextField } from '../Field/Field.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { lengthOf, placeLabel, unmanage, type BookingPage, type BookingsAction } from '../BookingsFlow/state.ts';
import { StopManaging } from '../BookingsFlow/editor.tsx';
import { dayFrom, inr, newId, ymdOf, type AppAction, type AppState, type ObjectId, type Report, type SharedLinkPage } from './data.ts';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TileGrid } from '../Card/Card.tsx';
import { isOpenDeal, kindOf, oddsOf, ownFields, stagesOf, viewRows, wordsOf } from './model.tsx';
import { Stat } from '../Chart/Chart.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** The starter page until someone publishes their own. */
export const STARTER: LinkPageDraft = { profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' };
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
/** Whose address the links live under: the business's handle, or the host's own name on a team. */
export const handleFor = (state: AppState, bookings: BookingsState | undefined) => bookings?.business?.handle || state.linkHandle || state.me.split(' ')[0]?.toLowerCase() || 'me';

/** The link page editor: edit beside the phone; Publish keeps it in the workspace. Unpublished work is kept in the app, so See it and leaving never lose it. */
export function LinkPageScreen({ state, dispatch, handle: ownHandle, onBack, bookings, isEmbedded = false, pageId, onCopyToWorkspace }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly handle: string; readonly onBack: () => void; readonly bookings?: BookingsState; /** Inside a partner's frame: no way back into the rest of Timefix. */ readonly isEmbedded?: boolean;
  /** A team's or company's page instead of your own. */ readonly pageId?: string; /** "Copy to another workspace…" in the ⋯ menu. */ readonly onCopyToWorkspace?: () => void }) {
  const { toast } = useToast();
  const shared = pageId ? (state.linkPages ?? []).find((x) => x.id === pageId) : undefined;
  const live = shared ? shared.page : state.linkPage ?? STARTER;
  const draft = shared ? shared.draft : state.linkDraft;
  const handle = shared ? shared.handle : ownHandle;
  const isPrivate = shared ? !shared.live : Boolean(state.linkOffline);
  const published = shared ? shared.live : (state.linkPage !== undefined || state.setupDone.includes('link')) && !state.linkOffline;
  const setLive = (on: boolean) => { if (shared) dispatch({ type: 'linkpage/patch', id: shared.id, patch: { live: on } }); else dispatch({ type: 'link/offline', offline: !on }); };
  const [offlineAsk, setOfflineAsk] = useState(false);
  const [seeing, setSeeing] = useState(false);
  const [qr, setQr] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [stats, setStats] = useState(false);
  const [team, setTeam] = useState(false);
  const [people, setPeople] = useState(false);
  const [dropping, setDropping] = useState(false);
  const url = `timefix.com/${handle}`;
  const name = shared ? `the ${shared.name} page` : 'your link page';
  const members = shared && shared.kind !== 'me' ? shared.members.map((m) => ({ name: m, title: state.members.find((x) => x.name === m)?.title })) : undefined;
  const copy = () => { void copyText(`https://${url}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Your link is ${url}`, tone: 'danger' })); };
  /** A visitor joins the list: they're filed in People (matched by email), tagged with the signup's heading. */
  const signup = (email: string, heading: string) => {
    const match = state.people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (match) dispatch({ type: 'records/fields', object: 'people', changes: [{ id: match.id, patch: { tags: [...new Set([...match.tags, heading])] } }] });
    else dispatch({ type: 'person/set', person: { id: newId('p'), name: email.split('@')[0] ?? email, email, title: '', owner: state.me, tags: [heading], created: new Date() } });
    toast({ message: `${email} joined “${heading}” and is in People`, tone: 'success' });
  };
  return (
    <>
      {seeing && (
        <div className="tf-grow__see">
          <div className="tf-forms__guestbar"><Button size="sm" variant="secondary" icon={<ArrowLeft {...i14} />} onPress={() => setSeeing(false)}>Back to editing</Button><span className="tf-rec__muted">{url}</span>
            {draft && <Tag size="sm" hue="orange">This is the live page; your changes aren’t published yet</Tag>}</div>
          <LinkPage {...live} booking={demoBooking} onSignup={signup} closing={live.details?.closing} members={members} />
        </div>
      )}
      <div className="tf-grow" hidden={seeing}>
        <div className="tf-rec__bar">
          {!isEmbedded && <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>Links</Button>}
          <span className="tf-grow__url tf-num">{url}</span>
          {shared && <Tag size="sm" hue="purple">{shared.kind === 'company' ? 'Company' : shared.kind === 'team' ? 'Team' : 'Me'}</Tag>}
          <Tag size="sm" hue={published ? 'green' : 'gray'}>{published ? 'Live' : isPrivate ? 'Private' : 'Not published'}</Tag>
          <span className="tf-rec__spacer" />
          {/* The same header as every editor's: see it as a guest, Share, ⋯. */}
          <Button variant="ghost" icon={<ExternalLink {...i14} />} isDisabled={!published} onPress={() => setSeeing(true)}>See it as a guest</Button>
          <Button variant="ghost" icon={<Share2 {...i14} />} isDisabled={!published} onPress={() => setSharing(true)}>Share</Button>
          <MenuTrigger>
            <IconButton label="More for this link page"><MoreHorizontal {...i16} /></IconButton>
            <Menu aria-label="Link page" placement="bottom end" onAction={(k) => { if (k === 'qr') setQr(true); else if (k === 'copy') copy(); else if (k === 'insights') setStats(true); else if (k === 'team') setTeam(true); else if (k === 'people') setPeople(true); else if (k === 'copyws') onCopyToWorkspace?.(); else if (k === 'delete') setDropping(true); }}>
              <MenuItem id="copy" icon={<Copy {...i16} />} isDisabled={!published}>Copy link</MenuItem>
              <MenuItem id="qr" icon={<QrIcon {...i16} />} isDisabled={!published}>QR code</MenuItem>
              <MenuItem id="insights" icon={<BarChart3 {...i16} />} description="Views, clicks and sources">Insights</MenuItem>
              {shared && shared.kind !== 'me' && <MenuItem id="people" icon={<Users {...i16} />} description="Who shows on it, and who can edit it">Members and editors</MenuItem>}
              {!shared && !isEmbedded && <MenuItem id="team" icon={<Users {...i16} />}>Team pages</MenuItem>}
              {onCopyToWorkspace && !isEmbedded && <MenuItem id="copyws" icon={<Copy {...i16} />}>Copy to another workspace…</MenuItem>}
              {shared && <MenuSeparator />}
              {shared && <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete page</MenuItem>}
            </Menu>
          </MenuTrigger>
          {(shared || state.linkPage) && <span className="tf-gp__live"><Switch aria-label="Live" isSelected={!isPrivate} onChange={(on) => { if (on) { setLive(true); toast({ message: 'Your page is live', tone: 'success' }); } else setOfflineAsk(true); }}>{isPrivate ? 'Private' : 'Live'}</Switch></span>}
          {offlineAsk && <Dialog isOpen onOpenChange={(o) => { if (!o) setOfflineAsk(false); }} title="Make this page private?" description={`Visitors to ${url} see that it’s not available. Nothing is deleted, and you can turn on Live any time.`}
            actions={<><Button variant="ghost" slot="close">Keep it live</Button><Button variant="danger" onPress={() => { setOfflineAsk(false); setLive(false); toast({ message: 'Private. Turn on Live to share it.', action: { label: 'Undo', onAction: () => setLive(true) } }); }}>Make private</Button></>} />}
        </div>
        {!shared && !state.linkHandle && !bookings?.business && !isEmbedded && <ClaimHandle state={state} dispatch={dispatch} suggestion={handle} />}
        <ShareSheet isOpen={sharing} onOpenChange={setSharing} title={`Share ${shared ? shared.name : 'your page'}`} url={url} name={name}
          onSite={() => { void copyText(`<iframe src="https://${url}?embed=1" style="width:100%;min-height:640px;border:0" title="${shared?.name ?? 'Link page'}"></iframe>`).then((ok) => toast(ok ? { message: 'Embed code copied. Paste it into your site’s HTML.', tone: 'success' } : { message: 'Copy didn’t work. Try again.', tone: 'danger' })); }}
          extra={<>{(['x', 'linkedin', 'facebook'] as const).map((n) => <Button key={n} size="sm" variant="ghost" icon={<SocialMark network={n} size={14} />} onPress={() => window.open(n === 'x' ? `https://x.com/intent/post?url=${encodeURIComponent(`https://${url}`)}` : n === 'linkedin' ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://${url}`)}` : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://${url}`)}`, '_blank', 'noopener')}>{n === 'x' ? 'X' : n === 'linkedin' ? 'LinkedIn' : 'Facebook'}</Button>)}</>} />
        {stats && <LinkInsightsDrawer state={state} page={live} pageKey={shared ? `link:${shared.id}` : 'link'} onClose={() => setStats(false)} />}
        {team && <TeamPagesDialog state={state} dispatch={dispatch} onClose={() => setTeam(false)} />}
        {people && shared && <MembersDialog state={state} page={shared} onClose={() => setPeople(false)} onSave={(patch) => { dispatch({ type: 'linkpage/patch', id: shared.id, patch }); setPeople(false); toast({ message: 'Saved. It’s on the page now.', tone: 'success' }); }} />}
        {dropping && shared && <Dialog isOpen onOpenChange={(o) => { if (!o) setDropping(false); }} title={`Delete the ${shared.name} page?`} description={`${url} stops working at once, and its blocks go with it.`}
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { const was = shared; dispatch({ type: 'linkpage/remove', id: shared.id }); onBack(); toast({ message: `Deleted the ${was.name} page.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'linkpage/set', page: was }) } }); }}>Delete page</Button></>} />}
        <LinkEditor key={pageId ?? 'me'} live={live} booking={demoBooking} initialDraft={draft} neverPublished={!published && !isPrivate} members={members}
          forms={state.forms.map((f) => ({ slug: f.slug, name: f.name, live: f.status === 'live' }))}
          bookingPages={(bookings?.pages ?? []).filter((p) => p.kind !== 'table' && p.isOn).map((p) => { const where = p.places?.[0] ?? 'video'; return { slug: p.slug, name: p.name, minutes: lengthOf(p), location: { kind: where === 'phone' ? 'phone' as const : where === 'in-person' ? 'place' as const : 'video' as const, label: placeLabel(p, where) } }; })}
          onDraftChange={(d) => { if (JSON.stringify(d) === JSON.stringify(draft)) return; if (shared) dispatch({ type: 'linkpage/patch', id: shared.id, patch: { draft: d } }); else dispatch({ type: 'link/draft', page: d }); }}
          onPublish={(page) => new Promise<void>((resolve) => { window.setTimeout(() => { if (shared) dispatch({ type: 'linkpage/patch', id: shared.id, patch: { page, draft: undefined } }); else dispatch({ type: 'link/publish', page }); resolve(); }, 500); })} />
        {qr && <QrSheet url={url} name={name} onClose={() => setQr(false)} />}
      </div>
    </>
  );
}

/** Who shows on a team's or company's page, and who can edit it. */
function MembersDialog({ state, page, onClose, onSave }: { readonly state: AppState; readonly page: SharedLinkPage; readonly onClose: () => void; readonly onSave: (p: Partial<SharedLinkPage>) => void }) {
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set(page.members));
  const [editors, setEditors] = useState<ReadonlySet<string>>(new Set(page.editors));
  const people = state.members.filter((m) => m.role !== 'Guest');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Members and editors" description={`Members show on timefix.com/${page.handle}. Editors can change the page; owners and admins always can.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={members.size === 0} onPress={() => onSave({ members: [...members], editors: [...editors] })}>Save</Button></>}>
      <div className="tf-rec__form">
        <ChoiceChips label="Shown on the page" selectionMode="multiple" size="sm" selectedKeys={members} items={people.map((m) => ({ id: m.name, label: m.name }))} onSelectionChange={setMembers} />
        <ChoiceChips label="Can edit it" selectionMode="multiple" size="sm" selectedKeys={editors} items={people.map((m) => ({ id: m.name, label: m.name }))} onSelectionChange={setEditors} />
      </div>
    </Dialog>
  );
}

/** New page: which kind (you, a team, the company), then its name, address, members and editors. It starts Private. */
export function NewLinkPage({ state, bookings, workspace, onClose, onMade, onMine }: { readonly state: AppState; readonly bookings: BookingsState | undefined; readonly workspace: string; readonly onClose: () => void; readonly onMade: (p: SharedLinkPage) => void; readonly onMine: () => void }) {
  const [kind, setKind] = useState<'me' | 'team' | 'company'>('team');
  const teams = state.prefs.teams;
  const [teamId, setTeamId] = useState(teams[0]?.id ?? 'new');
  const companyName = state.prefs.workspace.name;
  const team = teams.find((t) => t.id === teamId);
  const [name, setName] = useState(team?.name ?? '');
  const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const [handle, setHandle] = useState(slugify(`${companyName}-${team?.name ?? 'team'}`));
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set(team?.members ?? []));
  const [editors, setEditors] = useState<ReadonlySet<string>>(new Set([state.me]));
  const people = state.members.filter((m) => m.role !== 'Guest');
  const taken = new Set([handleFor(state, bookings), ...(state.linkPages ?? []).map((x) => x.handle), ...(state.teamPages ?? []).map((x) => x.handle)]);
  const bad = !/^[a-z0-9-]{2,30}$/.test(handle); const isTaken = taken.has(handle);
  const pick = (k: string) => {
    const nk = k === 'me' ? 'me' : k === 'company' ? 'company' : 'team'; setKind(nk);
    if (nk === 'company') { setName(companyName); setHandle(slugify(`${companyName}-${workspace === 'northwind' ? 'hq' : 'team'}`)); setMembers(new Set(people.map((m) => m.name))); }
    if (nk === 'team') { setName(team?.name ?? ''); setHandle(slugify(`${companyName}-${team?.name ?? 'team'}`)); setMembers(new Set(team?.members ?? [])); }
  };
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title="New page" description="A link page for you, a team or the whole company. Each has its own address; all of them list here in Links."
      actions={kind === 'me' ? <><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={onMine}>Open your page</Button></>
        : <><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || bad || isTaken || members.size === 0} onPress={() => onMade({ id: newId('lp'), kind, name: name.trim(), handle, members: [...members], editors: [...editors], live: false, made: new Date(), workspace,
          page: { profile: { name: name.trim(), bio: kind === 'company' ? `Everyone at ${companyName}, in one place.` : `The ${name.trim()} team at ${companyName}.` }, socials: [], blocks: [{ kind: 'next', id: newId('lb'), title: kind === 'company' ? 'Talk to us' : `Book the ${name.trim()} team`, durationMinutes: 30, location: { kind: 'video', label: 'Google Meet' } }], look: 'calm', accent: '#0F766E' } })}>Create page</Button></>}>
      <div className="tf-rec__form">
        <TileGrid label="Whose page" columns={3} value={kind} onChange={pick} items={[{ id: 'me', title: 'Me', description: 'Your own page', icon: <IdCard {...i16} /> }, { id: 'team', title: 'A team', description: 'Its people, booked by whoever is free', icon: <Users {...i16} /> }, { id: 'company', title: 'The company', description: `${companyName}, for everyone`, icon: <Store {...i16} /> }]} />
        {kind === 'me' ? <p className="tf-rec__muted">You have one already at timefix.com/{handleFor(state, bookings)}. It opens in the same editor.</p> : <>
          {kind === 'team' && teams.length > 0 && <Select label="Team" value={teamId} onChange={(v) => { const t = teams.find((x) => x.id === v); setTeamId(v ?? 'new'); if (t) { setName(t.name); setMembers(new Set(t.members)); setHandle(slugify(`${companyName}-${t.name}`)); } else setName(''); }} items={[...teams.map((t) => ({ id: t.id, label: t.name, description: `${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}` })), { id: 'new', label: 'Another team…' }]} />}
          <div className="tf-bkf__pair"><TextField label="Name" value={name} onChange={setName} placeholder="Sales" />
            <TextField label="Link" value={handle} onChange={(v) => setHandle(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} icon={<span className="tf-rec__muted tf-num">timefix.com/</span>} isInvalid={bad || isTaken} errorMessage={isTaken ? 'Taken. Pick another.' : 'Use 2 to 30 letters, numbers or hyphens.'} description={!bad && !isTaken ? `/${handle} is available.` : undefined} /></div>
          <ChoiceChips label="Shown on the page" selectionMode="multiple" size="sm" selectedKeys={members} items={people.map((m) => ({ id: m.name, label: m.name }))} onSelectionChange={setMembers} />
          <ChoiceChips label="Can edit it" selectionMode="multiple" size="sm" selectedKeys={editors} items={people.map((m) => ({ id: m.name, label: m.name }))} onSelectionChange={setEditors} />
          <p className="tf-rec__muted">It starts Private. Turn on Live to share it.</p>
        </>}
      </div>
    </Dialog>
  );
}

/** One QR code in a dialog, with Download. */
/** A QR code for any public address, with download. */
export function QrSheet({ url, name, onClose }: { readonly url: string; readonly name: string; readonly onClose: () => void }) {
  const { toast } = useToast();
  const svg = useRef<SVGSVGElement>(null);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`QR code for ${name}`} description="For a card, a table, a poster or a slide."
      actions={<><Button variant="ghost" slot="close">Done</Button><Button variant="secondary" icon={<Download {...i14} />} onPress={() => { if (svg.current) void downloadQr(svg.current, url.replace(/[^a-z0-9]+/gi, '-'), 'png').then((o) => { if (o === 'saved') toast({ message: 'Saved', tone: 'success' }); }); }}>Download PNG</Button></>}>
      <div className="tf-grow__qr"><QrCode value={`https://${url}`} label={`QR code for ${name}`} withLogo ref={svg} /><span className="tf-num">{url}</span></div>
    </Dialog>
  );
}

/** One thing you share. */
interface ShareRow { /** Me, Team or Company, on link pages. */ readonly kind?: string; /** A managed page's template: not bookable itself, so no Copy or Open, only its editor and its ending. */ readonly managed?: { readonly count: number; readonly onStop: () => void }; /** Copy to another workspace. */ readonly copyWs?: () => void; readonly id: string; readonly icon: ReactNode; readonly name: string; readonly url: string; readonly live: boolean; readonly off?: string; readonly numbers: string; readonly open: () => void; readonly edit: () => void; readonly editLabel: string; /** One more thing its ⋯ menu offers ("Submissions"). */ readonly extra?: { readonly label: string; readonly run: () => void } }

/** Links: everything you share, in one place. */
export function LinksScreen({ state, dispatch, bookings, appsMenu, onLinkPage, onBookingPage, onBookings, onForm, onOpenPage, workspace = 'northwind', onCopy, onBookingsAction, onEditBookingPage }: {
  /** Bookings' own changes (a managed template's ending). */ readonly onBookingsAction?: (a: BookingsAction) => void;
  /** Opens a booking page's editor. */ readonly onEditBookingPage?: (pageId: string) => void;
  readonly state: AppState; readonly bookings: BookingsState | undefined; readonly appsMenu: boolean;
  readonly onLinkPage: () => void; readonly onBookingPage: (pageId: string | undefined, scenario: 'book' | 'profile' | 'menu') => void; readonly onBookings: (tab: string) => void;
  readonly onForm: (id: string, visit: boolean) => void;
  /** Team and company pages: dispatch makes one, onOpenPage edits it. */
  readonly dispatch?: (a: AppAction) => void; readonly onOpenPage?: (id: string) => void;
  /** The workspace shown: pages copied elsewhere stay there. */ readonly workspace?: string;
  /** "Copy to another workspace…" on a link page's ⋯ ('me' is your own). */ readonly onCopy?: (pageId: string) => void;
}) {
  const { toast } = useToast();
  const [making, setMaking] = useState(false);
  const [stopping, setStopping] = useState<BookingPage>();
  const shared = (state.linkPages ?? []).filter((x) => (x.workspace ?? 'northwind') === workspace);
  const [qr, setQr] = useState<ShareRow>();
  const [query, setQuery] = useState('');
  const handle = handleFor(state, bookings);
  const business = bookings?.business;
  const now = new Date();
  const upcoming = (pageId?: string) => (bookings?.meetings ?? []).filter((m) => (pageId === undefined || m.pageId === pageId) && m.status !== 'cancelled' && m.start > now).length;
  const sharedRows: ReadonlyArray<ShareRow> = shared.map((x) => ({ id: x.id, kind: x.kind === 'company' ? 'Company' : x.kind === 'team' ? 'Team' : 'Me', icon: x.kind === 'company' ? <Store {...i16} /> : x.kind === 'team' ? <Users {...i16} /> : <IdCard {...i16} />, name: x.name, url: `timefix.com/${x.handle}`, live: x.live, off: 'Private',
          numbers: `${x.page.blocks.filter((b) => !b.archived).length} blocks · ${x.members.length} ${x.members.length === 1 ? 'person' : 'people'}`, open: () => onOpenPage?.(x.id), edit: () => onOpenPage?.(x.id), editLabel: 'Edit page', copyWs: onCopy ? () => onCopy(x.id) : undefined }));
  const rows: ReadonlyArray<{ readonly title: string; readonly rows: ReadonlyArray<ShareRow> }> = [
    { title: business ? 'Your page' : 'Link pages', rows: business
      ? [{ id: 'home', icon: <Store {...i16} />, name: bookings?.workspace ?? 'Your business page', url: `timefix.com/${handle}`, live: business.published, off: 'Not published', numbers: `${upcoming()} upcoming bookings`, open: () => onBookingPage(undefined, 'profile'), edit: () => onBookings('pages'), editLabel: 'Edit page' }]
      : [{ id: 'link', kind: 'Me', icon: <IdCard {...i16} />, name: 'Link page', url: `timefix.com/${handle}`, live: !state.linkOffline && state.linkPage !== undefined || state.setupDone.includes('link'), off: 'Not published', numbers: (() => { const blocks = (state.linkPage ?? STARTER).blocks; const n = blocks.filter((b) => b.kind === 'link' && !b.hidden && b.href.trim()).length; const clicks = blocks.reduce((t, b) => t + (b.kind === 'link' ? b.clicks ?? 0 : 0), 0); return `${n} links${clicks ? ` · ${clicks >= 1000 ? `${(clicks / 1000).toFixed(1)}K` : clicks} clicks` : ''}`; })(), open: onLinkPage, edit: onLinkPage, editLabel: 'Edit page', copyWs: onCopy ? () => onCopy('me') : undefined },
        ...sharedRows] },
    ...(business && sharedRows.length ? [{ title: 'Link pages', rows: sharedRows }] : []),
    { title: 'Managed pages', rows: (bookings?.pages ?? []).filter((p) => p.hostMode === 'managed').map((p) => ({ id: p.id, icon: <Users {...i16} />, name: p.name, url: `timefix.com/${handle}/${p.slug}-…`, live: true,
      numbers: 'One page you set up, with a copy for each person on it', open: () => (onEditBookingPage ?? (() => onBookings('pages')))(p.id), edit: () => (onEditBookingPage ?? (() => onBookings('pages')))(p.id), editLabel: 'Edit managed page',
      managed: { count: p.hosts.length, onStop: () => setStopping(p) } })) },
    { title: business ? (business.kind === 'restaurant' ? 'Tables and bookings' : 'Services') : 'Booking pages', rows: (bookings?.pages ?? []).filter((p) => p.hostMode !== 'managed').map((p) => ({ id: p.id, icon: <CalendarDays {...i16} />, name: p.name, url: `timefix.com/${handle}/${p.slug}`, live: p.isOn,
      numbers: `${upcoming(p.id)} upcoming`, open: () => onBookingPage(p.id, 'book'), edit: () => onBookings('pages'), editLabel: 'Edit in Bookings' })) },
    ...(bookings?.menu && appsMenu ? [{ title: 'Menu', rows: [{ id: 'menu', icon: <UtensilsCrossed {...i16} />, name: 'Menu', url: `timefix.com/${handle}/menu`, live: true, numbers: `${bookings.menu.dishes.length} dishes`, open: () => onBookingPage(undefined, 'menu'), edit: () => onBookings('menu'), editLabel: 'Edit menu' }] }] : []),
    { title: 'Forms', rows: state.forms.filter((f) => !f.workspace || f.workspace === workspace).map((f) => ({ id: f.id, icon: <FileText {...i16} />, name: f.name, url: `timefix.com/f/${f.slug}`, live: f.status === 'live', off: f.status === 'draft' ? 'Not published' : 'Paused', numbers: `${f.responses.filter((r) => !r.spam).length} responses`, open: () => onForm(f.id, true), edit: () => onForm(f.id, false), editLabel: 'Edit form' })) },
    { title: 'Team pages', rows: (state.teamPages ?? []).map((t) => ({ id: t.id, icon: <Users {...i16} />, name: t.name, url: `timefix.com/${t.handle}`, live: t.status === 'live', off: 'Invited', numbers: t.status === 'live' ? `${t.blocks} blocks` : 'Waiting for them', open: onLinkPage, edit: onLinkPage, editLabel: 'Team pages' })) },
  ].filter((g) => g.rows.length > 0);
  const q = query.trim().toLowerCase();
  const total = rows.reduce((n, g) => n + g.rows.length, 0);
  const live = rows.reduce((n, g) => n + g.rows.filter((r) => r.live).length, 0);
  const shown = q ? rows.map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.name} ${r.url}`.toLowerCase().includes(q)) })).filter((g) => g.rows.length > 0) : rows;
  const copy = (r: ShareRow) => { void copyText(`https://${r.url}`).then((ok) => toast(ok ? { message: `${r.name} link copied`, tone: 'success' } : { message: `Copy didn’t work. The link is ${r.url}`, tone: 'danger' })); };
  return (
    <div className="tf-links">
      <div className="tf-you__bar">
        <SearchField label="Search links" placeholder="Search links" size="sm" value={query} onChange={setQuery} className="tf-rec__search" />
        {dispatch && !business && <Button size="sm" variant="primary" icon={<Plus {...i14} />} onPress={() => setMaking(true)}>New page</Button>}
        <span className="tf-rec__muted tf-num">{total} links · {live} live</span>
      </div>
      {shown.length === 0 && <NoResults size="sm" query={query} noun="links" onClearFilters={() => setQuery('')} />}
      {shown.map((g) => (
        <section key={g.title} className="tf-links__group" aria-label={g.title}>
          <h2 className="tf-links__h">{g.title}</h2>
          <ul className="tf-links__list">
            {g.rows.map((r) => (
              <li key={r.id} className="tf-links__row">
                <span className="tf-links__icon" aria-hidden>{r.icon}</span>
                <span className="tf-links__what"><strong>{r.name}</strong><span className="tf-rec__muted tf-num">{r.url}</span></span>
                <span className="tf-links__nums tf-rec__muted tf-num">{r.numbers}</span>
                <span className="tf-links__tags">{r.managed ? <><Tag size="sm" hue="purple">Managed page</Tag><Tag size="sm" hue="gray">{r.managed.count === 1 ? '1 person' : `${r.managed.count} people`}</Tag></> : <>{r.kind && <Tag size="sm" hue="purple">{r.kind}</Tag>}<Tag size="sm" hue={r.live ? 'green' : 'gray'}>{r.live ? 'Live' : r.off ?? 'Off'}</Tag></>}</span>
                {r.managed ? <span className="tf-links__acts">
                  <Button size="sm" variant="ghost" icon={<Pencil {...i14} />} onPress={r.edit}>Edit</Button>
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${r.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`Actions for ${r.name}`} placement="bottom end" onAction={(k) => { if (k === 'edit') r.edit(); else if (k === 'stop') r.managed?.onStop(); }}>
                      <MenuItem id="edit" icon={<Pencil {...i16} />}>{r.editLabel}</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="stop" isDanger>Stop managing these pages…</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </span> : <span className="tf-links__acts">
                  <Button size="sm" variant="ghost" icon={<Copy {...i14} />} isDisabled={!r.live} onPress={() => copy(r)}>Copy</Button>
                  <IconButton size="sm" label={`Open ${r.name}`} onPress={r.open}><ExternalLink {...i14} /></IconButton>
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${r.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`Actions for ${r.name}`} placement="bottom end" onAction={(k) => { if (k === 'edit') r.edit(); else if (k === 'qr') setQr(r); else if (k === 'copy') copy(r); else if (k === 'email') window.open(`mailto:?subject=${encodeURIComponent(r.name)}&body=${encodeURIComponent(`https://${r.url}`)}`, '_blank', 'noopener'); else if (k === 'open') r.open(); else if (k === 'copyws') r.copyWs?.(); }}>
                      <MenuItem id="edit" icon={<Pencil {...i16} />}>{r.editLabel}</MenuItem>
                      <MenuItem id="open" icon={<ExternalLink {...i16} />}>Open</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="copy" icon={<Copy {...i16} />} isDisabled={!r.live}>Copy link</MenuItem>
                      <MenuItem id="qr" icon={<QrIcon {...i16} />} isDisabled={!r.live}>QR code</MenuItem>
                      <MenuItem id="email" icon={<Share2 {...i16} />} isDisabled={!r.live}>Send by email</MenuItem>
                      {r.copyWs && <MenuSeparator />}
                      {r.copyWs && <MenuItem id="copyws" icon={<Copy {...i16} />}>Copy to another workspace…</MenuItem>}
                    </Menu>
                  </MenuTrigger>
                </span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {stopping && <StopManaging title={stopping.name} count={stopping.hosts.length} onClose={() => setStopping(undefined)} onConfirm={() => {
        const p = stopping; const made = unmanage(p); const index = (bookings?.pages ?? []).findIndex((x) => x.id === p.id); setStopping(undefined);
        onBookingsAction?.({ type: 'page/delete', id: p.id }); made.forEach((page) => onBookingsAction?.({ type: 'page/upsert', page }));
        toast({ message: `${p.name} is no longer managed. Everyone’s own page is untouched.`, action: { label: 'Undo', onAction: () => { made.forEach((x) => onBookingsAction?.({ type: 'page/delete', id: x.id })); onBookingsAction?.({ type: 'page/restore', page: p, index }); } } }); }} />}
      {qr && <QrSheet url={qr.url} name={qr.name} onClose={() => setQr(undefined)} />}
      {making && dispatch && <NewLinkPage state={state} bookings={bookings} workspace={workspace} onClose={() => setMaking(false)} onMine={() => { setMaking(false); onLinkPage(); }}
        onMade={(p) => { dispatch({ type: 'linkpage/set', page: p }); setMaking(false); toast({ message: `Made /${p.handle}. It starts Private; turn on Live to share it.`, tone: 'success' }); onOpenPage?.(p.id); }} />}
    </div>
  );
}

/** The points of one report, from the workspace's records: any object, filtered by a saved view and an owner, grouped by any field (dates by month or week), counted or summed or averaged. */
export function reportPoints(state: AppState, r: Report): ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: number; readonly valueText: string }> {
  const object = r.object ?? 'deals';
  const view = r.viewId ? (state.views[object] ?? []).find((v) => v.id === r.viewId) : undefined;
  const rows = viewRows(state, object, view).filter((x) => !r.owner || x.values.owner === r.owner);
  const fields = ownFields(state, object);
  const groupId = r.group === 'tag' ? 'tags' : r.group;
  const gf = fields.find((f) => f.id === groupId);
  const measureId = r.measure === 'amount' ? 'amount' : r.field;
  const mf = fields.find((f) => f.id === measureId);
  const isDate = gf ? kindOf(gf.type) === 'date' : false;
  const bucket = (v: unknown): ReadonlyArray<string> => {
    const s0 = v === undefined || v === '' ? '' : String(v);
    if (!s0) return [`No ${gf?.name.toLowerCase() ?? 'value'}`];
    if (isDate) { const d = dayFrom(s0); if (!d) return [s0]; if (r.dateBy === 'week') { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [ymdOf(m)]; } return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`]; }
    if (gf?.type === 'multiSelect') return s0.split(/,\s*/).filter(Boolean);
    return [s0];
  };
  const groups = new Map<string, Array<typeof rows[number]>>();
  if (gf?.options && !isDate) gf.options.filter((o) => o.id !== '').forEach((o) => groups.set(o.id, []));
  if (groupId === 'owner') state.members.forEach((m) => groups.set(m.name, []));
  rows.forEach((x) => bucket(x.values[groupId]).forEach((k) => groups.set(k, [...(groups.get(k) ?? []), x])));
  const keys = isDate ? [...groups.keys()].sort() : [...groups.keys()];
  const money = mf?.money === true;
  return keys.map((k) => {
    const xs = groups.get(k) ?? [];
    const nums = xs.map((x) => Number(x.values[measureId ?? ''] ?? 0)).filter((n) => !Number.isNaN(n));
    const value = r.measure === 'count' || !measureId ? xs.length : r.measure === 'avg' ? (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0) : nums.reduce((a, b) => a + b, 0);
    const label = isDate ? (r.dateBy === 'week' ? `${dayFrom(k)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) ?? k}` : `${dayFrom(`${k}-01`)?.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) ?? k}`)
      : groupId === 'owner' ? k.split(' ')[0] ?? k : gf?.options?.find((o) => o.id === k)?.label ?? k;
    return { id: k, label, value, valueText: r.measure === 'count' || !measureId ? String(value) : money ? inr(value) : value.toLocaleString('en-IN') };
  });
}

/** Insights: Pages (visits to forms, booking pages and the link page: figures, sources, where people stop, sessions, named share links) and Reports. */
export function InsightsScreen({ state, dispatch, bookings, startTab, startReport }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly bookings: BookingsState | undefined; readonly startTab?: 'pages' | 'reports'; readonly startReport?: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>(startTab ?? 'pages');
  const [kind, setKind] = useState('all');
  const [range, setRange] = useState('30');
  const [from0, setFrom0] = useState<string>();
  const [to0, setTo0] = useState<string>();
  const now = new Date();
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const firstEver = [...(bookings?.meetings ?? []).map((m) => m.start), ...state.forms.flatMap((f) => f.responses.map((r) => r.at))].reduce((a, b) => (b < a ? b : a), now);
  const from = range === 'all' ? dayStart(firstEver) : range === 'custom' && from0 ? dayFrom(from0, 0) ?? dayStart(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(range === 'custom' ? 30 : range) + 1);
  const until = range === 'custom' && to0 ? new Date((dayFrom(to0, 0) ?? now).getTime() + 86_400_000) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const days = Math.max(1, Math.round((until.getTime() - from.getTime()) / 86_400_000));
  const before = new Date(from.getTime() - days * 86_400_000);
  // One page or form, or a whole kind. Everything counted comes from real bookings and answers.
  const sessions = sessionsOf(state, bookings, from, until).filter((x) => inScope(x, kind));
  const prevSessions = sessionsOf(state, bookings, before, from).filter((x) => inScope(x, kind));
  const [sharing, setSharing] = useState(false);
  const [openShare, setOpenShare] = useState<string>();
  const exportCsv = async () => { const o = await saveFile(`insights-${range}.csv`, new Blob([sessionsCsv(sessions)], { type: 'text/csv' })); if (o === 'saved') toast({ message: 'Exported what the screen shows.', tone: 'success' }); };
  // How they heard about you: questions marked for Insights, tallied over the period's answers.
  const heard = state.forms.filter((f) => kind === 'all' || kind === 'forms' || kind === `form:${f.id}`).flatMap((f) => (f.live ?? f.questions).filter((q) => q.insights).map((q) => ({ f, q })));
  const heardCounts = [...heard.flatMap(({ f, q }) => f.responses.filter((r) => !r.spam && r.at >= from && r.at < until).map((r) => r.answers[q.id] ?? '').filter(Boolean)).reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]).map(([v, n]) => ({ id: v, label: v, value: n }));
  const kinds = [{ id: 'forms', label: 'All forms' }, { id: 'booking', label: 'All booking pages' }, { id: 'link', label: 'Link page' }, ...state.forms.map((f) => ({ id: `form:${f.id}`, label: f.name })), ...(bookings?.pages ?? []).map((p) => ({ id: `page:${p.id}`, label: p.name }))];

  const reports = state.reports;
  const [report, setReport] = useState(startReport ?? reports[0]?.id ?? '');
  const [making, setMaking] = useState<Report | 'new'>();
  const r = reports.find((x) => x.id === report) ?? reports[0];
  const points = r ? reportPoints(state, r) : [];
  return (
    <div className="tf-grow tf-grow--wide">
      <Tabs aria-label="Insights" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'pages', label: 'Pages' }, { id: 'reports', label: 'Reports', count: reports.length }, { id: 'forecast', label: 'Forecast' }]}>
        <TabPanel id="pages" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="What" isLabelHidden className="tf-rec__view" value={kind} onChange={(v) => setKind(v ?? 'all')}
              items={[{ id: 'all', label: 'All pages' }, { id: 'booking', label: 'All booking pages' }, { id: 'forms', label: 'All forms' }, { id: 'link', label: 'Link page', description: `timefix.com/${handleFor(state, bookings)}` },
                ...(bookings?.pages ?? []).map((p) => ({ id: `page:${p.id}`, label: p.name, description: 'Booking page' })), ...state.forms.map((f) => ({ id: `form:${f.id}`, label: f.name, description: 'Form' }))]} />
            <Select label="When" isLabelHidden className="tf-you__select" value={range} onChange={(v) => setRange(v ?? '30')}
              items={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }, { id: '365', label: 'Last 12 months' }, { id: 'all', label: 'All time' }, { id: 'custom', label: 'Pick dates…' }]} />
            {range === 'custom' && <>
              <TextField label="From" isRequired type="date" value={from0 ?? ''} onChange={(v) => setFrom0(v || undefined)} />
              <TextField label="To" type="date" value={to0 ?? ''} onChange={(v) => setTo0(v || undefined)} />
            </>}
            <span className="tf-rec__spacer" />
            <Button variant="ghost" icon={<Download {...i14} />} onPress={() => { void exportCsv(); }}>Export CSV</Button>
            <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => setSharing(true)}>{(state.insightsShares ?? []).some((x) => !x.revoked && (!x.expires || x.expires > new Date())) ? 'Shared' : 'Share'}</Button>
          </div>
          {sessions.length === 0 && prevSessions.length === 0 ? <EmptyState icon={<BarChart3 size={20} strokeWidth={1.75} />} title="No visits in this period" description="Try a longer period, or share a form, a booking page or your link page." /> : <>
            <InsightsNumbers state={state} sessions={sessions} prev={prevSessions} kind={kind} days={days} />
            {heardCounts.length > 0 && <section className="tf-recp__sec"><h3>How they heard about you</h3><BarList label="How they heard about you" items={heardCounts} /></section>}
            <SessionsTable key={`${kind}-${range}`} sessions={sessions} />
          </>}
          {sharing && <InsightsShareDialog state={state} dispatch={dispatch} kinds={kinds} onClose={() => setSharing(false)} onOpen={(id) => { setSharing(false); setOpenShare(id); }} />}
          {openShare && <SharedInsights state={state} bookings={bookings} shareId={openShare} onClose={() => setOpenShare(undefined)} />}
        </TabPanel>
        <TabPanel id="reports" className="tf-forms__panel">
          {reports.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No reports yet" description="Chart your deals, people or companies, and keep it for the team." action={<Button size="sm" variant="primary" onPress={() => setMaking('new')}>New report</Button>} /> : (
            <>
              <div className="tf-rec__bar">
                <Select label="Report" isLabelHidden className="tf-rec__view" value={r?.id ?? null} onChange={(v) => { if (v) setReport(v); }} items={reports.map((x) => ({ id: x.id, label: x.name, description: `${wordsOf(state, x.object ?? 'deals').Many} by ${ownFields(state, x.object ?? 'deals').find((f) => f.id === (x.group === 'tag' ? 'tags' : x.group))?.name.toLowerCase() ?? x.group}${x.owner ? `, ${x.owner}'s` : ''}` }))} />
                <span className="tf-rec__spacer" />
                {r && <Button size="sm" variant="ghost" icon={<Pencil {...i14} />} onPress={() => setMaking(r)}>Change</Button>}
                {r && <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { const was = r; const at = reports.findIndex((y) => y.id === r.id); dispatch({ type: 'report/remove', id: r.id }); setReport(reports.find((y) => y.id !== r.id)?.id ?? ''); toast({ message: `${was.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'report/set', report: was }); void at; setReport(was.id); } } }); }}>Delete</Button>}
                <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setMaking('new')}>New report</Button>
              </div>
              {r && (() => {
                const totalNum = r.measure === 'avg' ? Math.round(points.reduce((n, p) => n + p.value, 0) / Math.max(1, points.filter((p) => p.value).length)) : points.reduce((n, p) => n + p.value, 0);
                const money = r.measure !== 'count' && (ownFields(state, r.object ?? 'deals').find((f) => f.id === (r.measure === 'amount' ? 'amount' : r.field))?.money ?? false);
                const totalText = money ? inr(totalNum) : totalNum.toLocaleString('en-IN');
                if (points.every((p) => p.value === 0)) return <p className="tf-rec__muted">Nothing to count yet.</p>;
                if (r.chart === 'number') return <div className="tf-home__stats tf-grow__one"><Stat label={r.name} value={totalText} delta={`${points.filter((p) => p.value).length} groups · ${r.measure === 'avg' ? 'average' : 'total'}`} /></div>;
                return (
                  <div className="tf-home__grid">
                    <ChartCard title={r.name}><BarChart label={r.name} points={points} look={r.chart === 'line' ? 'line' : 'bars'} /></ChartCard>
                    <ChartCard title="Share of the total"><DonutChart label={r.name} segments={points.filter((p) => p.value > 0).map((p, n) => ({ id: p.id, label: p.label, value: p.value, valueText: p.valueText, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'gray'] as const)[n % 6] ?? 'gray' }))}
                      total={totalText} totalLabel={r.measure === 'avg' ? 'Average' : 'Total'} /></ChartCard>
                  </div>
                );
              })()}
            </>
          )}
        </TabPanel>
        <TabPanel id="forecast" className="tf-forms__panel"><Forecast state={state} dispatch={dispatch} /></TabPanel>
      </Tabs>
      {making && <ReportDialog state={state} report={making === 'new' ? undefined : making} members={state.members.map((m) => m.name)} onClose={() => setMaking(undefined)} onSave={(x) => { dispatch({ type: 'report/set', report: x }); setReport(x.id); setMaking(undefined); toast({ message: `${x.name} saved`, tone: 'success' }); }} />}
    </div>
  );
}

/** A chart of any object's records: count, total or average of a number field, grouped by any field (dates by month or week), from a saved view, as bars, a line or one number. */
function ReportDialog({ state, report, members, onClose, onSave }: { readonly state: AppState; readonly report?: Report; readonly members: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (r: Report) => void }) {
  const [object, setObject] = useState<ObjectId>(report?.object ?? 'deals');
  const [measure, setMeasure] = useState<'count' | 'sum' | 'avg'>(report?.measure === 'amount' ? 'sum' : report?.measure ?? 'sum');
  const fields = ownFields(state, object);
  const numbers = fields.filter((f) => kindOf(f.type) === 'number');
  const [field, setField] = useState(report?.measure === 'amount' ? 'amount' : report?.field ?? numbers[0]?.id ?? '');
  const groupable = fields.filter((f) => ['select', 'status', 'multiSelect', 'actor', 'date', 'timestamp', 'checkbox'].includes(f.type) || f.id === 'company' || f.id === 'city');
  const [group, setGroup] = useState<string>(report?.group === 'tag' ? 'tags' : report?.group ?? groupable[0]?.id ?? 'owner');
  const [dateBy, setDateBy] = useState<'month' | 'week'>(report?.dateBy ?? 'month');
  const [owner, setOwner] = useState<string>(report?.owner ?? 'all');
  const [viewId, setViewId] = useState<string>(report?.viewId ?? 'all');
  const [chart, setChart] = useState<'bar' | 'line' | 'number'>(report?.chart ?? 'bar');
  const [name, setName] = useState(report?.name ?? '');
  const gf = fields.find((f) => f.id === group);
  const isDate = gf ? kindOf(gf.type) === 'date' : false;
  const useMeasure = numbers.length > 0 ? measure : 'count';
  const w = wordsOf(state, object);
  const auto = `${useMeasure === 'count' ? w.Many : `${useMeasure === 'avg' ? 'Average' : 'Total'} ${numbers.find((f) => f.id === field)?.name.replace(/ \(₹\)$/, '').toLowerCase() ?? ''}`} by ${gf?.name.toLowerCase() ?? group}${isDate ? ` (${dateBy})` : ''}`;
  const objects = state.objects.filter((o) => !o.archived);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={report ? 'Change report' : 'New report'} description="A chart of your records, saved for the team."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!gf} onPress={() => onSave({ id: report?.id ?? newId('rep'), name: name.trim() || auto, object, measure: useMeasure, field: useMeasure === 'count' ? undefined : field, group, dateBy: isDate ? dateBy : undefined, owner: owner === 'all' ? undefined : owner, viewId: viewId === 'all' ? undefined : viewId, chart })}>Save report</Button></>}>
      <div className="tf-rec__form">
        <div className="tf-bkf__pair">
          <Select label="Records" value={object} onChange={(v) => { const o = v ?? 'deals'; setObject(o); const f = ownFields(state, o); setGroup(f.find((x) => ['status', 'select', 'actor'].includes(x.type))?.id ?? 'owner'); setField(f.find((x) => kindOf(x.type) === 'number')?.id ?? ''); setViewId('all'); }} items={objects.map((o) => ({ id: o.id, label: o.many }))} />
          <Select label="From view" value={viewId} onChange={(v) => setViewId(v ?? 'all')} items={[{ id: 'all', label: `All ${w.many}` }, ...(state.views[object] ?? []).map((v) => ({ id: v.id, label: v.name }))]} />
        </div>
        <div className="tf-bkf__pair">
          <Select label="Measure" value={useMeasure} onChange={(v) => setMeasure(v === 'count' ? 'count' : v === 'avg' ? 'avg' : 'sum')} items={[{ id: 'count', label: `Number of ${w.many}` }, ...(numbers.length ? [{ id: 'sum', label: 'Total of a number' }, { id: 'avg', label: 'Average of a number' }] : [])]} />
          {useMeasure !== 'count' && <Select label="Of" value={field || null} onChange={(v) => setField(v ?? '')} items={numbers.map((f) => ({ id: f.id, label: f.name }))} />}
        </div>
        <div className="tf-bkf__pair">
          <Select label="Grouped by" value={group} onChange={(v) => { if (v) setGroup(v); }} items={groupable.map((f) => ({ id: f.id, label: f.name }))} />
          {isDate && <Select label="Per" value={dateBy} onChange={(v) => setDateBy(v === 'week' ? 'week' : 'month')} items={[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]} />}
        </div>
        <div className="tf-bkf__pair">
          <Select label="Owned by" value={owner} onChange={(v) => setOwner(v ?? 'all')} items={[{ id: 'all', label: 'Everyone' }, ...members.map((m) => ({ id: m, label: m }))]} />
          <Select label="Show as" value={chart} onChange={(v) => setChart(v === 'line' ? 'line' : v === 'number' ? 'number' : 'bar')} items={[{ id: 'bar', label: 'Bars' }, { id: 'line', label: 'A line' }, { id: 'number', label: 'One number' }]} />
        </div>
        <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder={auto} />
      </div>
    </Dialog>
  );
}

/** Forecast: open pipeline, won, and the weighted forecast; each stage's win chance can be changed, and the forecast follows. */
function Forecast({ state, dispatch }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void }) {
  const { toast } = useToast();
  const stages = stagesOf(state);
  const open = state.deals.filter((d) => isOpenDeal(state, d));
  const wonIds = new Set(stages.filter((s) => s.outcome === 'won').map((s) => s.id));
  const won = state.deals.filter((d) => wonIds.has(d.stage));
  const pipeline = open.reduce((n, d) => n + d.amount, 0);
  const weighted = open.reduce((n, d) => n + Math.round((d.amount * oddsOf(state, d.stage)) / 100), 0);
  const byMonth = new Map<string, number>();
  open.forEach((d) => { const k = `${d.close.getFullYear()}-${String(d.close.getMonth() + 1).padStart(2, '0')}`; byMonth.set(k, (byMonth.get(k) ?? 0) + Math.round((d.amount * oddsOf(state, d.stage)) / 100)); });
  const months = [...byMonth.keys()].sort().map((k) => ({ id: k, label: dayFrom(`${k}-01`)?.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) ?? k, value: byMonth.get(k) ?? 0, valueText: inr(byMonth.get(k) ?? 0) }));
  return (
    <>
      <div className="tf-home__stats">
        <StatCard label="Open pipeline" value={pipeline} delta={{ value: `${open.length} open ${open.length === 1 ? 'deal' : 'deals'}`, direction: 'flat' }} format={inr} />
        <StatCard label="Won" value={won.reduce((n, d) => n + d.amount, 0)} delta={{ value: `${won.length} won`, direction: 'flat' }} format={inr} />
        <StatCard label="Weighted forecast" value={weighted} delta={{ value: pipeline ? `${Math.round((weighted / pipeline) * 100)}% of open` : '—', direction: 'flat' }} format={inr} />
      </div>
      <div className="tf-home__grid">
        <ChartCard title="Expected by close month"><BarChart label="Weighted amount by close month" points={months} emptyText="No open deals." /></ChartCard>
        <ChartCard title="Win chance by stage">
          <ul className="tf-set__list tf-forecast">
            {stages.filter((s) => !s.outcome).map((s) => {
              const ds = open.filter((d) => d.stage === s.id); const amt = ds.reduce((n, d) => n + d.amount, 0);
              return (
                <li key={s.id}>
                  <span><strong>{s.label}</strong> <span className="tf-rec__muted tf-num">{ds.length} · {inr(amt)} · {inr(Math.round((amt * oddsOf(state, s.id)) / 100))} weighted</span></span>
                  <TextField aria-label={`${s.label} win chance`} className="tf-forecast__pct" value={String(oddsOf(state, s.id))} suffix={<span className="tf-rec__muted">%</span>} inputMode="numeric"
                    onChange={(v) => { const n = Math.max(0, Math.min(100, Number(v.replace(/[^\d]/g, '')) || 0)); const was = state.prefs.winChance; dispatch({ type: 'prefs/update', fn: (p) => ({ winChance: { ...(p.winChance ?? {}), [s.id]: n } }) }); void was; }}
                    onBlur={() => toast({ message: `${s.label}: ${oddsOf(state, s.id)}% likely`, tone: 'success' })} />
                </li>
              );
            })}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}
