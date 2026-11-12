// Settings › Scheduling pages that change Bookings from here: Round robin groups (with their distribution), Routing's overview and skills, and Scheduling access.
// Every change goes to Bookings as an action; ending actions (delete a group or a skill, remove access) ask first.
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { ArrowRight, MoreHorizontal, Pencil, Plus, Scale, Share2, Trash2, UserPlus, X } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch, RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Meter } from '../Progress/Progress.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { BookingsAction, BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import type { RoundRobinGroup, SchedulingGrant } from '../BookingsFlow/state.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const first = (n: string) => n.split(' ')[0] ?? n;
let seq = 0;
const newId = (p: string) => { seq += 1; return `${p}-${Date.now().toString(36)}-${seq}`; };
/** Twelve weeks, the window fair share is judged over. */
const WINDOW_DAYS = 84;

/** What every page here gets: Bookings as it stands, a way to change it, who is signed in, and the workspace's people. */
interface PageProps {
  readonly bookings: BookingsState;
  readonly act: (a: BookingsAction) => void;
  readonly me: string;
  readonly isAdmin: boolean;
  readonly people: ReadonlyArray<{ readonly name: string; readonly role: string; readonly title?: string }>;
}

/* ------------------------------------------------------------------ Round robin */

/** Each member's meetings from a group's pages over the last twelve weeks, plus any count changed by hand, against their fair share by weight. */
export function distribution(bookings: BookingsState, g: RoundRobinGroup, now = new Date()) {
  const pages = bookings.pages.filter((p) => p.groupId === g.id).map((p) => p.id);
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const counted = (name: string) => bookings.meetings.filter((m) => m.host === name && m.pageId !== undefined && pages.includes(m.pageId) && m.status !== 'cancelled' && m.start.getTime() >= since).length;
  const adjusted = (name: string) => (g.adjustments ?? []).filter((a) => a.member === name).reduce((n, a) => n + a.by, 0);
  const rows = g.members.map((m) => ({ name: m.name, weight: m.weight ?? 1, paused: m.paused, meetings: counted(m.name), adjusted: adjusted(m.name) }));
  const total = rows.reduce((n, r) => n + r.meetings + r.adjusted, 0);
  const weights = rows.filter((r) => !r.paused).reduce((n, r) => n + r.weight, 0) || 1;
  return rows.map((r) => ({ ...r, count: r.meetings + r.adjusted, fair: r.paused ? 0 : Math.round((total * r.weight) / weights * 10) / 10 }));
}

/** Settings › Scheduling › Round robin: groups with their members (taking meetings, weight, weekly cap), returning guests, editors and the distribution. */
export function RoundRobinPage({ bookings, act, me, isAdmin, people }: PageProps) {
  const { toast } = useToast();
  const [naming, setNaming] = useState<{ readonly id?: string; readonly name: string; readonly members: ReadonlyArray<string> }>();
  const [deleting, setDeleting] = useState<RoundRobinGroup>();
  const [sharing, setSharing] = useState<RoundRobinGroup>();
  const [editors, setEditors] = useState<ReadonlyArray<string>>([]);
  const [spread, setSpread] = useState<string>();
  const groups = bookings.groups;
  const setGroups = (next: ReadonlyArray<RoundRobinGroup>) => act({ type: 'groups/set', groups: next });
  const patch = (id: string, fn: (g: RoundRobinGroup) => RoundRobinGroup) => setGroups(groups.map((g) => (g.id === id ? fn(g) : g)));
  const canEdit = (g: RoundRobinGroup) => isAdmin || (g.editors ?? []).includes(me);
  const save = () => {
    if (!naming || !naming.name.trim()) return;
    const name = naming.name.trim();
    if (naming.id) { patch(naming.id, (g) => ({ ...g, name })); toast({ message: 'Group renamed', tone: 'success' }); }
    else { setGroups([...groups, { id: newId('g'), name, members: naming.members.map((n) => ({ name: n, paused: false, weight: 1 })), returning: 'turn' }]); toast({ message: `${name} made`, tone: 'success' }); }
    setNaming(undefined);
  };
  const shown = groups.find((g) => g.id === spread);
  return (
    <>
      <SettingsSection title="Groups" description="People who share pages in turn. Whoever is free and furthest below their fair share takes the next booking."
        action={isAdmin ? <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setNaming({ name: '', members: [] })}>New group</Button> : undefined}>
        {groups.length === 0 ? <EmptyState size="sm" icon={<UserPlus size={20} strokeWidth={1.75} />} title="No groups yet" description="Make one, then pick it on a round robin page." /> : (
          <ul className="tf-set__list">{groups.map((g) => { const pages = bookings.pages.filter((p) => p.groupId === g.id); return (
            <li key={g.id}><span><strong>{g.name}</strong> <span className="tf-rec__muted">{g.members.length} people · {pages.length ? pages.map((p) => p.name).join(', ') : 'No pages yet'}</span></span>
              <span className="tf-row">
                <Button size="sm" variant="ghost" icon={<Scale {...i14} />} onPress={() => setSpread(g.id)}>Distribution</Button>
                {canEdit(g) && <MenuTrigger>
                  <IconButton size="sm" label={`More for ${g.name}`}><MoreHorizontal {...i16} /></IconButton>
                  <Menu aria-label={`${g.name} actions`} placement="bottom end" onAction={(k: Key) => {
                    if (k === 'rename') setNaming({ id: g.id, name: g.name, members: [] });
                    else if (k === 'share') { setEditors(g.editors ?? []); setSharing(g); }
                    else if (k === 'delete') setDeleting(g);
                  }}>
                    <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename</MenuItem>
                    <MenuItem id="share" icon={<Share2 {...i16} />} description={(g.editors ?? []).length ? `${(g.editors ?? []).map(first).join(', ')} can change it` : 'Only admins change it'}>Share with editors</MenuItem>
                    {isAdmin && <MenuSeparator />}
                    {isAdmin && <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete group</MenuItem>}
                  </Menu>
                </MenuTrigger>}
              </span>
            </li>); })}</ul>
        )}
      </SettingsSection>
      {groups.map((g) => (
        <SettingsSection key={g.id} title={g.name} description={canEdit(g) ? 'Who takes turns, how big a share each gets, and their most a week.' : 'Only admins and the group’s editors change this.'}>
          <ul className="tf-set__list tf-rr__members" aria-label={`${g.name} members`}>
            <li className="tf-rr__member tf-rr__member--head" aria-hidden="true"><span>Person</span><span>Weight</span><span>Most a week</span><span /></li>
            {g.members.map((m) => (
              <li key={m.name} className="tf-rr__member">
                <span className="tf-rr__who"><Avatar name={m.name} size={24} /><span className="tf-rr__name"><strong>{m.name}</strong>{m.paused && <span className="tf-rec__muted"> · paused</span>}</span></span>
                <NumberField aria-label={`${m.name}: weight, their share of meetings`} value={m.weight ?? 1} minValue={1} maxValue={10} isDisabled={!canEdit(g)}
                  onChange={(n) => patch(g.id, (x) => ({ ...x, members: x.members.map((y) => (y.name === m.name ? { ...y, weight: Number.isFinite(n) ? n : 1 } : y)) }))} />
                <NumberField aria-label={`${m.name}: most meetings a week from this group`} showSteppers={false} value={(m.weeklyCap ?? 0) || Number.NaN} minValue={1} maxValue={60} placeholder="No cap" isDisabled={!canEdit(g)}
                  onChange={(n) => patch(g.id, (x) => ({ ...x, members: x.members.map((y) => (y.name === m.name ? { ...y, weeklyCap: Number.isFinite(n) ? n : undefined } : y)) }))} />
                <Switch isSelected={!m.paused} isDisabled={!canEdit(g)} onChange={(on) => patch(g.id, (x) => ({ ...x, members: x.members.map((y) => (y.name === m.name ? { ...y, paused: !on } : y)) }))}>Taking meetings</Switch>
              </li>
            ))}
          </ul>
          <div className="tf-rec__form tf-set__narrow">
            <Select label="Returning guests go to" value={g.returning ?? 'turn'} isDisabled={!canEdit(g)} onChange={(v) => { if (v) { patch(g.id, (x) => ({ ...x, returning: v as RoundRobinGroup['returning'] })); toast({ message: 'Saved', tone: 'success' }); } }}
              items={[{ id: 'turn', label: 'Whoever’s turn it is' }, { id: 'owner', label: 'Their record’s owner, when free' }, { id: 'last', label: 'Whoever hosted them last, when free' }]}
              description="Matched by email. If that person isn’t free, it’s whoever’s turn." />
          </div>
        </SettingsSection>
      ))}
      <Dialog isOpen={naming !== undefined} onOpenChange={(o) => { if (!o) setNaming(undefined); }} size="md" title={naming?.id ? 'Rename group' : 'New group'} description={naming?.id ? undefined : 'Pick who takes turns. You can change weights and caps after.'}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!naming?.name.trim() || (!naming.id && naming.members.length < 2)} onPress={save}>{naming?.id ? 'Rename' : 'Make group'}</Button></>}>
        <div className="tf-rec__form">
          <TextField label="Name" value={naming?.name ?? ''} onChange={(name) => setNaming((n) => (n ? { ...n, name } : n))} placeholder="Sales team" autoFocus />
          {!naming?.id && <ChoiceChips label="Who takes turns" selectionMode="multiple" selectedKeys={[...(naming?.members ?? [])]} items={people.filter((p) => p.role !== 'Guest').map((p) => ({ id: p.name, label: p.name === me ? `${first(p.name)} (you)` : first(p.name) }))}
            onSelectionChange={(k) => setNaming((n) => (n ? { ...n, members: [...k].map(String) } : n))} />}
          {!naming?.id && (naming?.members.length ?? 0) < 2 && <p className="tf-rec__muted">Pick at least two people.</p>}
        </div>
      </Dialog>
      <Dialog isOpen={sharing !== undefined} onOpenChange={(o) => { if (!o) setSharing(undefined); }} size="md" title={`Share ${sharing?.name ?? 'this group'} with editors`} description="Admins always can. Editors change its members, weights, caps and returning guests."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { if (sharing) { patch(sharing.id, (x) => ({ ...x, editors })); toast({ message: editors.length ? `${editors.map(first).join(', ')} can change ${sharing.name}` : `Only admins change ${sharing.name} now`, tone: 'success' }); } setSharing(undefined); }}>Save</Button></>}>
        <ChoiceChips label="Editors" selectionMode="multiple" selectedKeys={[...editors]} items={people.filter((p) => p.role === 'Member').map((p) => ({ id: p.name, label: p.name }))} onSelectionChange={(k) => setEditors([...k].map(String))} />
      </Dialog>
      <ConfirmDialog isOpen={deleting !== undefined} onOpenChange={(o) => { if (!o) setDeleting(undefined); }} title={`Delete ${deleting?.name ?? 'this group'}?`}
        consequence={(() => { const n = bookings.pages.filter((p) => p.groupId === deleting?.id).length; return n ? `${n === 1 ? 'Its page keeps its hosts' : `Its ${n} pages keep their hosts`} but stop using the group’s weights and caps. Booked meetings stay.` : 'No page uses it. Booked meetings stay.'; })()}
        confirmLabel="Delete group" onConfirm={() => {
          if (!deleting) return;
          bookings.pages.filter((p) => p.groupId === deleting.id).forEach((p) => act({ type: 'page/upsert', page: { ...p, groupId: undefined } }));
          setGroups(groups.filter((g) => g.id !== deleting.id)); toast({ message: `${deleting.name} deleted` }); setDeleting(undefined);
        }} />
      <DistributionDrawer group={shown} bookings={bookings} me={me} canAdjust={shown ? isAdmin : false} onClose={() => setSpread(undefined)} onPatch={(fn) => { if (shown) patch(shown.id, fn); }} />
    </>
  );
}

/** The distribution: each member's meetings over twelve weeks against their fair share by weight; admins change a count by hand with a note (Undo). */
function DistributionDrawer({ group, bookings, me, canAdjust, onClose, onPatch }: { readonly group: RoundRobinGroup | undefined; readonly bookings: BookingsState; readonly me: string; readonly canAdjust: boolean; readonly onClose: () => void; readonly onPatch: (fn: (g: RoundRobinGroup) => RoundRobinGroup) => void }) {
  const { toast } = useToast();
  const [adjusting, setAdjusting] = useState<string>();
  const [by, setBy] = useState(1);
  const [note, setNote] = useState('');
  const rows = group ? distribution(bookings, group) : [];
  const max = Math.max(1, ...rows.map((r) => Math.max(r.count, r.fair)));
  return (
    <Drawer isOpen={group !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} title={group ? `${group.name} · distribution` : 'Distribution'} subtitle="The last 12 weeks. Fair share follows each person’s weight.">
      {group && <div className="tf-rr__dist">
        <ul className="tf-set__list" aria-label="Distribution">
          {rows.map((r) => (
            <li key={r.name} className="tf-rr__distrow">
              <span className="tf-rr__who"><Avatar name={r.name} size={24} /><span className="tf-rr__name"><strong>{r.name}</strong><span className="tf-rec__muted tf-num"> · weight {r.weight}{r.paused ? ' · paused' : ''}{r.adjusted ? ` · ${r.meetings} booked, ${r.adjusted > 0 ? '+' : ''}${r.adjusted} by hand` : ''}</span></span></span>
              <Meter label={`${r.count} of a fair ${r.fair}`} value={r.count} maxValue={max} valueLabel={r.count > r.fair + 0.5 ? 'Ahead' : r.count < r.fair - 0.5 ? 'Behind, goes sooner' : 'Even'} warnAt={2} dangerAt={2} />
              {canAdjust && <Button size="sm" variant="ghost" onPress={() => { setBy(1); setNote(''); setAdjusting(r.name); }}>Adjust</Button>}
            </li>
          ))}
        </ul>
        <section className="tf-rr__adjlog" aria-label="Changed by hand">
          <h3 className="tf-rr__h">Changed by hand</h3>
          {(group.adjustments ?? []).length === 0 ? <p className="tf-rec__muted">Nothing yet. An admin can add or take away meetings from someone’s count, with a note.</p> : (
            <ul className="tf-set__list">{[...(group.adjustments ?? [])].reverse().map((a) => <li key={a.id}><span><strong>{a.member}</strong> <span className="tf-num">{a.by > 0 ? `+${a.by}` : a.by}</span> <span className="tf-rec__muted">· {a.note} · {first(a.who)}, {a.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span></li>)}</ul>
          )}
        </section>
        {!canAdjust && <p className="tf-rec__muted">Only admins change counts.</p>}
      </div>}
      {adjusting && group && <Dialog isOpen onOpenChange={(o) => { if (!o) setAdjusting(undefined); }} size="md" title={`Adjust ${first(adjusting)}’s count`} description="Added to their count for fair share. Kept with your note."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={by === 0 || !note.trim()} onPress={() => {
          const entry = { id: newId('adj'), member: adjusting, by, note: note.trim(), at: new Date(), who: me };
          const before = group.adjustments;
          onPatch((g) => ({ ...g, adjustments: [...(g.adjustments ?? []), entry] }));
          setAdjusting(undefined);
          toast({ message: `${first(entry.member)}’s count ${by > 0 ? 'raised' : 'lowered'} by ${Math.abs(by)}`, action: { label: 'Undo', onAction: () => onPatch((g) => ({ ...g, adjustments: before })) } });
        }}>Adjust count</Button></>}>
        <div className="tf-rec__form">
          <NumberField label="Change by" description="Negative takes meetings away." value={by} minValue={-20} maxValue={20} onChange={(n) => setBy(Number.isFinite(n) ? n : 0)} />
          <TextArea label="Why" rows={2} value={note} onChange={setNote} placeholder="Took two calls by phone" isRequired />
        </div>
      </Dialog>}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Routing overview and skills */

/** Settings › Scheduling › Routing: every routed form and team page with its fallback and the last 30 days, then skills in groups. */
export function RoutingOverview({ bookings, act, onOpen }: PageProps & { readonly onOpen: () => void }) {
  const { toast } = useToast();
  const r = bookings.routing;
  const since = Date.now() - 30 * 86_400_000;
  const log = (r.log ?? []).filter((d) => d.at.getTime() >= since);
  const fallback = (r.fallbackOutcome ?? 'page') === 'page' ? `Book ${bookings.pages.find((p) => p.id === r.fallbackPageId)?.name ?? 'a page'}` : r.fallbackOutcome === 'message' ? 'Show a message' : 'Send to a link';
  const teamLinks = bookings.pages.filter((p) => p.linkKind === 'team');
  const groups = r.skillGroups ?? [{ id: 'sg-all', name: 'Skills', skills: [...new Set(Object.values(r.skills).flat())] }];
  const [renaming, setRenaming] = useState<{ readonly skill: string; readonly to: string }>();
  const [removing, setRemoving] = useState<string>();
  const [adding, setAdding] = useState<{ readonly group: string; readonly name: string }>();
  const [newGroup, setNewGroup] = useState<string>();
  /** Rules that still ask for a skill. */
  const needs = (skill: string) => r.rules.map((x, n) => ({ x, n })).filter(({ x }) => x.team === skill);
  const setRouting = (patch: Partial<typeof r>) => act({ type: 'routing/set', routing: { ...r, ...patch } });
  const renameSkill = (from: string, to: string) => setRouting({
    skillGroups: groups.map((g) => ({ ...g, skills: g.skills.map((s) => (s === from ? to : s)) })),
    skills: Object.fromEntries(Object.entries(r.skills).map(([k, v]) => [k, v.map((s) => (s === from ? to : s))])),
    rules: r.rules.map((x) => (x.team === from ? { ...x, team: to } : x)),
  });
  return (
    <>
      <SettingsSection title="Routed forms and pages" description="Each one, what happens when nothing matches, and the last 30 days." action={<Button variant="secondary" iconEnd={<ArrowRight {...i14} />} onPress={onOpen}>Open Routing</Button>}>
        <div className="tf-rr__table" role="table" aria-label="Routed forms and pages">
          <div className="tf-rr__trow tf-rr__trow--head" role="row">{['Form or page', 'No match', 'Matched', 'Booked'].map((h) => <span key={h} role="columnheader">{h}</span>)}</div>
          <div className="tf-rr__trow" role="row">
            <span role="rowheader"><strong>{r.formName}</strong> <Tag size="sm" hue="gray">Form</Tag><span className="tf-rec__muted tf-rr__sub">{r.rules.length} {r.rules.length === 1 ? 'rule' : 'rules'}, top first</span></span>
            <span role="cell">{fallback}</span>
            <span role="cell" className="tf-num">{log.filter((d) => d.ruleId).length} of {log.length}</span>
            <span role="cell" className="tf-num">{log.filter((d) => d.booked).length}</span>
          </div>
          {teamLinks.map((p) => { const ms = bookings.meetings.filter((m) => m.pageId === p.id && m.start.getTime() >= since); return (
            <div key={p.id} className="tf-rr__trow" role="row">
              <span role="rowheader"><strong>{p.name}</strong> <Tag size="sm" hue="blue">Team page</Tag><span className="tf-rec__muted tf-rr__sub">No rules: the whole group shares it</span></span>
              <span role="cell">The whole group</span>
              <span role="cell" className="tf-num">{ms.length}</span>
              <span role="cell" className="tf-num">{ms.filter((m) => m.status !== 'cancelled').length}</span>
            </div>); })}
        </div>
      </SettingsSection>
      <SettingsSection title="Skills" description="A rule can ask for members with a skill. Group them so they’re easy to find." action={<Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setNewGroup('')}>New skill group</Button>}>
        <div className="tf-rr__skillgroups">
          {groups.map((g) => (
            <div key={g.id} className="tf-rr__skillgroup" role="group" aria-label={g.name}>
              <span className="tf-rr__h">{g.name}</span>
              <ul className="tf-rr__skills">
                {g.skills.map((s) => { const held = Object.entries(r.skills).filter(([, v]) => v.includes(s)).map(([k]) => first(k)); return (
                  <li key={s} className="tf-rr__skill">
                    <span><strong>{s}</strong> <span className="tf-rec__muted">{held.length ? held.join(', ') : 'Nobody yet'}{needs(s).length ? ` · ${needs(s).length === 1 ? '1 rule' : `${needs(s).length} rules`}` : ''}</span></span>
                    <MenuTrigger>
                      <IconButton size="sm" label={`More for ${s}`}><MoreHorizontal {...i16} /></IconButton>
                      <Menu aria-label={`${s} actions`} placement="bottom end" onAction={(k: Key) => { if (k === 'rename') setRenaming({ skill: s, to: s }); else setRemoving(s); }}>
                        <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename</MenuItem>
                        <MenuSeparator />
                        <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete skill</MenuItem>
                      </Menu>
                    </MenuTrigger>
                  </li>); })}
              </ul>
              <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setAdding({ group: g.id, name: '' })}>Add a skill</Button>
            </div>
          ))}
        </div>
      </SettingsSection>
      <Dialog isOpen={renaming !== undefined} onOpenChange={(o) => { if (!o) setRenaming(undefined); }} size="md" title={`Rename ${renaming?.skill ?? 'skill'}`} description="Rules and people with it keep it under the new name."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!renaming?.to.trim() || groups.some((g) => g.skills.includes(renaming.to.trim()) && renaming.to.trim() !== renaming.skill)} onPress={() => { if (renaming) { renameSkill(renaming.skill, renaming.to.trim()); toast({ message: 'Skill renamed', tone: 'success' }); } setRenaming(undefined); }}>Rename</Button></>}>
        <TextField label="Name" value={renaming?.to ?? ''} onChange={(to) => setRenaming((x) => (x ? { ...x, to } : x))} autoFocus />
      </Dialog>
      {removing && (() => { const rules = needs(removing); return (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setRemoving(undefined); }} size="md" title={`Delete ${removing}?`} description={rules.length ? 'A rule still needs it. Change the rule first, or delete the skill and the rule books anyone on its page.' : 'Nobody loses anything else: people just stop having it.'}
          actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" onPress={() => {
            setRouting({ skillGroups: groups.map((g) => ({ ...g, skills: g.skills.filter((s) => s !== removing) })), skills: Object.fromEntries(Object.entries(r.skills).map(([k, v]) => [k, v.filter((s) => s !== removing)])) });
            toast({ message: `${removing} deleted` }); setRemoving(undefined);
          }}>Delete skill</Button></>}>
          {rules.length > 0 && <div className="tf-rr__needs"><span className="tf-rr__h">Where a rule still needs it</span><ul className="tf-set__list">{rules.map(({ x, n }) => <li key={x.id}><span><strong>Rule {n + 1}</strong> <span className="tf-rec__muted">books {bookings.pages.find((p) => p.id === x.pageId)?.name ?? 'a page'} with {x.team}</span></span></li>)}</ul></div>}
        </Dialog>); })()}
      <Dialog isOpen={adding !== undefined} onOpenChange={(o) => { if (!o) setAdding(undefined); }} size="md" title="Add a skill" actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!adding?.name.trim()} onPress={() => { if (adding) { setRouting({ skillGroups: groups.map((g) => (g.id === adding.group ? { ...g, skills: [...g.skills, adding.name.trim()] } : g)) }); toast({ message: `${adding.name.trim()} added`, tone: 'success' }); } setAdding(undefined); }}>Add skill</Button></>}>
        <TextField label="Name" value={adding?.name ?? ''} onChange={(name) => setAdding((x) => (x ? { ...x, name } : x))} placeholder="Tamil" autoFocus />
      </Dialog>
      <Dialog isOpen={newGroup !== undefined} onOpenChange={(o) => { if (!o) setNewGroup(undefined); }} size="md" title="New skill group" actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!newGroup?.trim()} onPress={() => { if (newGroup?.trim()) setRouting({ skillGroups: [...groups, { id: newId('sg'), name: newGroup.trim(), skills: [] }] }); setNewGroup(undefined); }}>Make group</Button></>}>
        <TextField label="Name" value={newGroup ?? ''} onChange={setNewGroup} placeholder="Products" autoFocus />
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Scheduling access */

/** Settings › Scheduling access: who can see or manage your scheduling, whose you can reach, and taking access back (asks first). */
export function AccessGrants({ bookings, act, me, people }: PageProps) {
  const { toast } = useToast();
  const grants = bookings.grants ?? [];
  const mine = grants.filter((g) => g.owner === me);
  const reach = grants.filter((g) => g.to === me);
  const [giving, setGiving] = useState<{ readonly to: string; readonly level: SchedulingGrant['level'] }>();
  const [removing, setRemoving] = useState<SchedulingGrant>();
  const others = people.filter((p) => p.name !== me && p.role !== 'Guest' && !mine.some((g) => g.to === p.name));
  const set = (next: ReadonlyArray<SchedulingGrant>) => act({ type: 'grants/set', grants: next });
  const LEVELS = [{ id: 'see', label: 'See', description: 'Your hours, time off and meetings' }, { id: 'manage', label: 'Manage', description: 'Also change them and book for you' }];
  return (
    <>
      <SettingsSection title="Who can reach your scheduling" description="Besides admins. See shows your hours, time off and meetings; Manage also changes them and books for you."
        action={others.length ? <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setGiving({ to: others[0]?.name ?? '', level: 'see' })}>Give access</Button> : undefined}>
        {mine.length === 0 ? <p className="tf-rec__muted">Only you and admins.</p> : (
          <ul className="tf-set__list" aria-label="Who can reach your scheduling">{mine.map((g) => (
            <li key={g.id}><span className="tf-rr__who"><Avatar name={g.to} size={24} /><strong className="tf-rr__name">{g.to}</strong></span>
              <span className="tf-row">
                <Select label={`${g.to}'s access`} isLabelHidden className="tf-you__select" value={g.level} items={LEVELS} onChange={(v) => { if (v) { set(grants.map((x) => (x.id === g.id ? { ...x, level: v === 'manage' ? 'manage' : 'see' } : x))); toast({ message: 'Saved', tone: 'success' }); } }} />
                <IconButton size="sm" label={`Remove ${g.to}'s access`} onPress={() => setRemoving(g)}><X {...i14} /></IconButton>
              </span></li>))}</ul>
        )}
      </SettingsSection>
      <SettingsSection title="Scheduling you can reach" description="Colleagues who gave you access. Their hours and meetings show in Bookings, under Whose meetings.">
        {reach.length === 0 ? <p className="tf-rec__muted">Nobody has shared theirs with you yet.</p> : (
          <ul className="tf-set__list" aria-label="Scheduling you can reach">{reach.map((g) => (
            <li key={g.id}><span className="tf-rr__who"><Avatar name={g.owner} size={24} /><strong className="tf-rr__name">{g.owner}</strong></span><Tag size="sm" hue={g.level === 'manage' ? 'blue' : 'gray'}>{g.level === 'manage' ? 'Manage' : 'See'}</Tag></li>))}</ul>
        )}
      </SettingsSection>
      <Dialog isOpen={giving !== undefined} onOpenChange={(o) => { if (!o) setGiving(undefined); }} size="md" title="Give access to your scheduling" description="They’re emailed. You can change or take it back any time."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!giving?.to} onPress={() => { if (giving) { set([...grants, { id: newId('gr'), owner: me, to: giving.to, level: giving.level }]); toast({ message: `${first(giving.to)} can ${giving.level === 'manage' ? 'manage' : 'see'} your scheduling`, tone: 'success' }); } setGiving(undefined); }}>Give access</Button></>}>
        <div className="tf-rec__form">
          <Select label="Who" value={giving?.to ?? null} onChange={(v) => setGiving((x) => (x && v ? { ...x, to: v } : x))} items={others.map((p) => ({ id: p.name, label: p.name, description: p.title, icon: <Avatar name={p.name} size={20} /> }))} />
          <RadioGroup label="They can" value={giving?.level ?? 'see'} onChange={(v) => setGiving((x) => (x ? { ...x, level: v === 'manage' ? 'manage' : 'see' } : x))}>
            <Radio value="see">See your hours, time off and meetings</Radio>
            <Radio value="manage">Manage them, and book for you</Radio>
          </RadioGroup>
        </div>
      </Dialog>
      <ConfirmDialog isOpen={removing !== undefined} onOpenChange={(o) => { if (!o) setRemoving(undefined); }} title={`Remove ${removing?.to ?? ''}’s access?`}
        consequence={`${first(removing?.to ?? '')} stops seeing your scheduling at once${removing?.level === 'manage' ? ' and can’t change it or book for you' : ''}. Meetings they booked for you stay.`}
        confirmLabel="Remove access" onConfirm={() => { if (removing) { set(grants.filter((g) => g.id !== removing.id)); toast({ message: `${first(removing.to)} can’t reach your scheduling now` }); } setRemoving(undefined); }} />
    </>
  );
}
