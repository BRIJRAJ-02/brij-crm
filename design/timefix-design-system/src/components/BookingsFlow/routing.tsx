// Teams: round robin groups (Manage groups, from a page's Who) and the Routing tab (rules as sentences, skills, a Test panel, what "won" means).
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { ArrowDown, ArrowRight, ArrowUp, BadgeCheck, BadgeX, CornerDownRight, FlaskConical, Minus, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { TextField } from '../Field/Field.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Sentence } from '../Sentence/Sentence.tsx';
import { Select } from '../Select/Select.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import {
  ROUTING_FIELDS, TEAM, first, nextId, plural, routeFor,
  type BookedMeeting, type BookingsAction, type BookingsState, type RouteOutcome, type RouteTag, type Routing, type RoutingAnswers, type RoutingRule, isRecordField } from './state.ts';

const SKILLS = ['Sales', 'Support', 'Onboarding', 'Partnerships'];
const WON = [{ id: 'won', label: 'The deal moves to Won' }, { id: 'created', label: 'A deal is created' }, { id: 'held', label: 'The meeting happens' }];

/** Who on a team takes the next routed meeting: the member with that skill and the fewest upcoming meetings. */
function nextOnTeam(state: BookingsState, team: string): string | undefined {
  const members = TEAM.filter((n) => state.routing.skills[n]?.includes(team));
  const load = (n: string) => state.meetings.filter((m) => m.host === n && m.status !== 'cancelled' && m.end > new Date()).length;
  return [...members].sort((a, b) => load(a) - load(b))[0];
}

/** What a rule (or Otherwise) does, as one row: Book [page] with [team], Show [message], or Send to [link]. */
function OutcomeRow({ lead, outcome, pageId, team, message, url, pages, teams, withTeam, onChange }: {
  readonly lead: string; readonly outcome: RouteOutcome; readonly pageId: string; readonly team?: string; readonly message?: string; readonly url?: string;
  readonly pages: ReadonlyArray<{ id: string; label: string }>; readonly teams: ReadonlyArray<{ id: string; label: string }>; readonly withTeam: boolean;
  readonly onChange: (patch: { outcome?: RouteOutcome; pageId?: string; team?: string; message?: string; url?: string }) => void;
}) {
  return (
    <div className="tf-bkf-flow__then">
      <Select label={`${lead}: what happens`} isLabelHidden className="tf-bkf__inline-select tf-bkf-flow__kind" value={outcome} onChange={(v) => { if (v) onChange({ outcome: v as RouteOutcome }); }}
        items={OUTCOMES} />
      {outcome === 'page' && <>
        <Select label={`${lead} page`} isLabelHidden className="tf-bkf__inline-select" items={pages} value={pageId || null} onChange={(v) => { if (v) onChange({ pageId: v }); }} />
        {withTeam && <><span className="tf-bkf-flow__word">with</span>
          <Select label={`${lead} team`} isLabelHidden className="tf-bkf__inline-select" items={teams} value={team ?? null} onChange={(v) => { if (v) onChange({ team: v }); }} /></>}
      </>}
      {outcome === 'message' && <TextField aria-label={`${lead} message`} className="tf-bkf-flow__text" value={message ?? ''} onChange={(m) => onChange({ message: m })} placeholder="Thanks! We'll email you within a day." />}
      {outcome === 'redirect' && <TextField aria-label={`${lead} link`} className="tf-bkf-flow__text" type="url" value={url ?? ''} onChange={(u) => onChange({ url: u })} placeholder="https://northwind.com/partners" />}
    </div>
  );
}

const OUTCOMES = [{ id: 'page', label: 'Book a page' }, { id: 'message', label: 'Show a message' }, { id: 'redirect', label: 'Send to a link' }];
const TAG_LABEL: Readonly<Record<RouteTag, string>> = { qualified: 'Qualified', not: 'Not qualified' };
const ago = (d: Date, now: Date) => { const m = Math.round((now.getTime() - d.getTime()) / 60_000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** The Routing tab: Rules (a flow ending in Otherwise, beside a Try panel) or Results (each rule's numbers, and the latest answers). */
export function RoutingTab({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const routing = state.routing;
  const { toast } = useToast();
  const [view, setView] = useState<'rules' | 'results'>('rules');
  const set = (patch: Partial<Routing>) => dispatch({ type: 'routing/set', routing: { ...routing, ...patch } });
  const setRule = (id: string, patch: Partial<RoutingRule>) => set({ rules: routing.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const pages = state.pages.map((p) => ({ id: p.id, label: p.name }));
  const teams = SKILLS.map((s) => ({ id: s, label: s }));
  const [answers, setAnswers] = useState<RoutingAnswers>({ size: 80, region: 'eu', need: 'buy', source: 'web', known: 'no' });
  const rule = routeFor(routing, answers);
  const outcome: RouteOutcome = rule ? rule.outcome ?? 'page' : routing.fallbackOutcome ?? 'page';
  const page = state.pages.find((p) => p.id === (rule?.pageId ?? routing.fallbackPageId));
  const who = outcome === 'page' ? (rule ? nextOnTeam(state, rule.team) : page?.hosts[0]) : undefined;
  const ruleIndex = rule ? routing.rules.findIndex((r) => r.id === rule.id) + 1 : 0;
  const addRule = () => set({ rules: [...routing.rules, { id: nextId('rule'), conditions: [{ id: nextId('c'), attributeId: 'size', operator: 'gt', value: undefined }], conjunction: 'and', pageId: state.pages[0]?.id ?? '', team: 'Sales', outcome: 'page' }] });
  const move = (from: number, to: number) => { const rules = [...routing.rules]; const [r] = rules.splice(from, 1); if (r) { rules.splice(to, 0, r); set({ rules }); } };
  const remove = (n: number) => {
    const before = routing;
    set({ rules: routing.rules.filter((_, i) => i !== n) });
    toast({ message: `Rule ${n + 1} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'routing/set', routing: before }) } });
  };
  const opt = (id: string, v: string | number | undefined) => ROUTING_FIELDS.find((f) => f.id === id)?.options?.find((o) => o.id === v)?.label;

  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          <Select label="Routing form" isLabelHidden className="tf-bkf__inline-select" items={[{ id: routing.formName, label: routing.formName }]} value={routing.formName} />
          <SegmentedControl aria-label="Show" selectedKey={view} onSelectionChange={(k) => setView(k === 'results' ? 'results' : 'rules')}
            items={[{ id: 'rules', label: 'Rules' }, { id: 'results', label: 'Results' }]} />
        </>}
        action={view === 'rules' ? <Button variant="primary" icon={<Plus {...i14} />} onPress={addRule}>Add rule</Button> : undefined} />

      {view === 'rules' ? (
        <div className="tf-bkf-routing">
          <div className="tf-bkf-cards">
            <Section title="Rules" description={`Checked top to bottom. The first match decides what happens after someone answers ${routing.formName}.`}>
              <ol className="tf-bkf-flow">
                {routing.rules.map((r, n) => {
                  const hit = rule?.id === r.id;
                  return (
                    <li key={r.id} className="tf-bkf-flow__step" data-hit={hit || undefined}>
                      <span className="tf-bkf-flow__num tf-num" aria-hidden="true">{n + 1}</span>
                      <div className="tf-bkf-flow__card">
                        <header className="tf-bkf-flow__head">
                          <span className="tf-bkf-flow__title">Rule {n + 1}</span>
                          {r.tag && <Tag size="sm" hue={r.tag === 'qualified' ? 'green' : 'gray'}>{TAG_LABEL[r.tag]}</Tag>}
                          {hit && <Tag size="sm" hue="blue">Matches the test</Tag>}
                          <span className="tf-bkf__spacer" />
                          <MenuTrigger>
                            <IconButton size="sm" label={`More for rule ${n + 1}`}><MoreHorizontal {...i16} /></IconButton>
                            <Menu aria-label={`Rule ${n + 1} actions`} placement="bottom end" onAction={(k: Key) => {
                              if (k === 'up') move(n, n - 1);
                              else if (k === 'down') move(n, n + 1);
                              else if (k === 'delete') remove(n);
                              else if (k === 'qualified' || k === 'not') setRule(r.id, { tag: k });
                              else if (k === 'notag') setRule(r.id, { tag: undefined });
                            }}>
                              <MenuSection title="Tag people it routes">
                                <MenuItem id="qualified" icon={<BadgeCheck {...i16} />}>Qualified</MenuItem>
                                <MenuItem id="not" icon={<BadgeX {...i16} />}>Not qualified</MenuItem>
                                <MenuItem id="notag" icon={<Minus {...i16} />} isDisabled={!r.tag}>No tag</MenuItem>
                              </MenuSection>
                              <MenuSeparator />
                              <MenuItem id="up" icon={<ArrowUp {...i16} />} isDisabled={n === 0}>Move up</MenuItem>
                              <MenuItem id="down" icon={<ArrowDown {...i16} />} isDisabled={n === routing.rules.length - 1}>Move down</MenuItem>
                              <MenuSeparator />
                              <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem>
                            </Menu>
                          </MenuTrigger>
                        </header>
                        <Sentence lead="When" label={`Rule ${n + 1} conditions`} attributes={ROUTING_FIELDS} conditions={r.conditions} conjunction={r.conjunction}
                          onChange={(conditions) => setRule(r.id, { conditions })} onConjunctionChange={(conjunction) => setRule(r.id, { conjunction })} />
                        <OutcomeRow lead={`Rule ${n + 1}`} outcome={r.outcome ?? 'page'} pageId={r.pageId} team={r.team} message={r.message} url={r.url} pages={pages} teams={teams} withTeam
                          onChange={(patch) => setRule(r.id, patch)} />
                      </div>
                    </li>
                  );
                })}
                <li className="tf-bkf-flow__step tf-bkf-flow__step--else" data-hit={!rule || undefined}>
                  <span className="tf-bkf-flow__num" aria-hidden="true"><CornerDownRight {...i14} /></span>
                  <div className="tf-bkf-flow__card">
                    <header className="tf-bkf-flow__head">
                      <span className="tf-bkf-flow__title">Otherwise</span>
                      {!rule && <Tag size="sm" hue="blue">Matches the test</Tag>}
                    </header>
                    <OutcomeRow lead="Otherwise" outcome={routing.fallbackOutcome ?? 'page'} pageId={routing.fallbackPageId} message={routing.fallbackMessage} url={routing.fallbackUrl} pages={pages} teams={teams} withTeam={false}
                      onChange={(p) => set({ ...(p.outcome ? { fallbackOutcome: p.outcome } : {}), ...(p.pageId ? { fallbackPageId: p.pageId } : {}), ...(p.message !== undefined ? { fallbackMessage: p.message } : {}), ...(p.url !== undefined ? { fallbackUrl: p.url } : {}) })} />
                  </div>
                </li>
              </ol>
            </Section>
            <Section className="tf-bkf-card" title="Who takes routed meetings" description="A rule books a team. Whoever on it has the fewest upcoming meetings goes next.">
              <ul className="tf-bkf__list-plain">
                {TEAM.map((name) => (
                  <li key={name} className="tf-bkf-skill">
                    <span className="tf-bkf__host"><Avatar name={name} size={24} />{name}</span>
                    <ChoiceChips label={`${name}'s teams`} isLabelHidden selectionMode="multiple" size="sm" items={teams}
                      selectedKeys={routing.skills[name] ?? []} onSelectionChange={(keys) => set({ skills: { ...routing.skills, [name]: [...keys] } })} />
                  </li>
                ))}
              </ul>
            </Section>
            <Section className="tf-bkf-card" title="Reporting" description="Tells you which rules bring in business.">
              <Select label="A routed meeting counts as won when" className="tf-bkf__field-w" items={WON} value={routing.wonMeans} onChange={(v) => { if (v) set({ wonMeans: v }); }} />
            </Section>
          </div>
          <aside className="tf-bkf-try" aria-label="Try the rules">
            <header className="tf-bkf-try__head">
              <FlaskConical {...i16} aria-hidden="true" />
              <span className="tf-bkf-flow__title">Try an answer</span>
            </header>
            <div className="tf-bkf-try__fields">
              <NumberField label="Team size" value={typeof answers.size === 'number' ? answers.size : Number.NaN} minValue={1} onChange={(n) => setAnswers((a) => ({ ...a, size: Number.isFinite(n) ? n : undefined }))} />
              {ROUTING_FIELDS.filter((f) => f.type === 'select').map((f) => (
                <Select key={f.id} label={f.name} description={isRecordField(f.id) ? 'From their CRM record' : f.id === 'source' || f.id === 'known' ? 'Hidden field' : undefined} items={(f.options ?? []).map((o) => ({ id: o.id, label: o.label }))}
                  value={typeof answers[f.id] === 'string' ? (answers[f.id] as string) : null} onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v ?? undefined }))} />
              ))}
              {ROUTING_FIELDS.filter((f) => f.type === 'number' && isRecordField(f.id)).map((f) => (
                <NumberField key={f.id} label={f.name} description="From their CRM record" value={typeof answers[f.id] === 'number' ? (answers[f.id] as number) : Number.NaN} minValue={1}
                  onChange={(n) => setAnswers((a) => ({ ...a, [f.id]: Number.isFinite(n) ? n : undefined }))} />
              ))}
            </div>
            <div className="tf-bkf-try__result" role="status" aria-live="polite">
              <span className="tf-bkf__label">Goes to</span>
              <div key={`${rule?.id ?? 'fallback'}-${outcome}-${page?.id ?? ''}-${who ?? ''}`} className="tf-bkf-try__dest">
                <strong className="tf-bkf-try__page">{outcome === 'page' ? page?.name ?? 'No page' : outcome === 'message' ? 'A message' : 'A link'}</strong>
                <span className="tf-bkf__muted">{rule ? `Rule ${ruleIndex}${outcome === 'page' ? ` · ${rule.team} team` : ''}` : 'Otherwise'}{rule?.tag ? ` · ${TAG_LABEL[rule.tag]}` : ''}</span>
                {outcome === 'message' && <span className="tf-bkf__muted">“{(rule ? rule.message : routing.fallbackMessage) || 'No message yet'}”</span>}
                {outcome === 'redirect' && <span className="tf-bkf__muted tf-num">{(rule ? rule.url : routing.fallbackUrl) || 'No link yet'}</span>}
                {who && <span className="tf-bkf__host"><Avatar name={who} size={20} />{first(who)} is next</span>}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <RoutingResults state={state} opt={opt} />
      )}
    </div>
  );
}

/** Results: each rule's numbers over the log, then the latest answers and where they went. */
function RoutingResults({ state, opt }: { readonly state: BookingsState; readonly opt: (id: string, v: string | number | undefined) => string | undefined }) {
  const routing = state.routing;
  const log = routing.log ?? [];
  const now = new Date();
  const rows = [...routing.rules.map((r, n) => ({ id: r.id as string | undefined, label: `Rule ${n + 1}`, tag: r.tag })), { id: undefined, label: 'Otherwise', tag: undefined as RouteTag | undefined }];
  const won = WON.find((w) => w.id === routing.wonMeans)?.label ?? 'Won';
  return (
    <div className="tf-bkf-cards">
      <Section className="tf-bkf-card" title="How each rule did" description={`From the last ${plural(log.length, 'answer')}. Won means: ${won.toLowerCase()}.`}>
        <div className="tf-bkf-report" role="table" aria-label="How each rule did">
          <div className="tf-bkf-report__row tf-bkf-report__row--head" role="row">
            {['Rule', 'Matched', 'Booked', 'No-shows', 'Won'].map((h) => <span key={h} role="columnheader">{h}</span>)}
          </div>
          {rows.map((row) => {
            const mine = log.filter((d) => d.ruleId === row.id);
            const booked = mine.filter((d) => d.booked).length;
            return (
              <div key={row.label} className="tf-bkf-report__row" role="row">
                <span role="rowheader" className="tf-bkf-report__name">{row.label}{row.tag && <Tag size="sm" hue={row.tag === 'qualified' ? 'green' : 'gray'}>{TAG_LABEL[row.tag]}</Tag>}</span>
                <span role="cell" className="tf-num">{mine.length}</span>
                <span role="cell" className="tf-num">{booked}{mine.length ? <span className="tf-bkf__muted"> · {Math.round((booked / mine.length) * 100)}%</span> : null}</span>
                <span role="cell" className="tf-num">{mine.filter((d) => d.noShow).length}</span>
                <span role="cell" className="tf-num">{mine.filter((d) => d.won).length}</span>
              </div>
            );
          })}
        </div>
      </Section>
      <Section className="tf-bkf-card" title="Latest answers" description="Who answered, what they said, and where the rules sent them.">
        {log.length === 0 ? <p className="tf-bkf__muted">No answers yet. Share the form and they show up here.</p> : (
          <ul className="tf-bkf__list-plain tf-bkf-log">
            {log.map((d) => {
              const n = routing.rules.findIndex((r) => r.id === d.ruleId);
              const r = routing.rules[n];
              const where = r ? (r.outcome ?? 'page') === 'page' ? state.pages.find((p) => p.id === r.pageId)?.name ?? 'A page' : r.outcome === 'message' ? 'A message' : 'A link'
                : (routing.fallbackOutcome ?? 'page') === 'page' ? state.pages.find((p) => p.id === routing.fallbackPageId)?.name ?? 'A page' : 'Otherwise';
              return (
                <li key={d.id} className="tf-bkf-log__row">
                  <Avatar name={d.name} size={28} />
                  <span className="tf-bkf-log__who"><strong>{d.name}</strong><span className="tf-bkf__muted">{d.company} · {ago(d.at, now)}</span></span>
                  <span className="tf-bkf-log__answers">
                    {typeof d.answers.size === 'number' && <Tag size="sm" hue="gray">{d.answers.size} people</Tag>}
                    {['region', 'need', 'source'].map((k) => opt(k, d.answers[k]) && <Tag key={k} size="sm" hue="gray">{opt(k, d.answers[k])}</Tag>)}
                    {d.answers.known === 'yes' && <Tag size="sm" hue="green">In CRM</Tag>}
                  </span>
                  <span className="tf-bkf-log__route"><span className="tf-bkf__muted">{r ? `Rule ${n + 1}` : 'Otherwise'}</span><ArrowRight {...i14} aria-hidden="true" /><span>{where}</span></span>
                  {d.booked && !d.won && !d.noShow ? <Tag size="sm" hue="blue">Booked</Tag> : <Tag size="sm" status={d.won ? 'done' : d.noShow ? 'failed' : 'draft'}>{d.won ? 'Won' : d.noShow ? 'No-show' : 'Didn’t book'}</Tag>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Round robin groups: members, who's paused, and handing a paused member's meetings on. */
export function GroupsDialog({ isOpen, state, onClose, dispatch, onHandOn }: {
  readonly isOpen: boolean; readonly state: BookingsState; readonly onClose: () => void; readonly dispatch: (a: BookingsAction) => void;
  /** Gives these meetings to the next in rotation; returns how many moved. */
  readonly onHandOn: (meetings: ReadonlyArray<BookedMeeting>) => number;
}) {
  const now = new Date();
  const setPaused = (gid: string, name: string, paused: boolean) => dispatch({ type: 'groups/set', groups: state.groups.map((g) => (g.id === gid ? { ...g, members: g.members.map((m) => (m.name === name ? { ...m, paused } : m)) } : g)) });
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} size="wide" title="Round robin groups" description="Pause someone and new meetings skip them. Their booked meetings can be handed on."
      actions={<Button variant="secondary" slot="close">Done</Button>}>
      <div className="tf-bkf__stack">
        {state.groups.length === 0 && <p className="tf-bkf__muted">No groups yet. A page set to round robin makes one.</p>}
        {state.groups.map((g) => {
          const pages = state.pages.filter((p) => p.groupId === g.id);
          return (
            <section key={g.id} className="tf-bkf-group" aria-label={g.name}>
              <div className="tf-bkf__row"><strong>{g.name}</strong><span className="tf-bkf__muted">{pages.map((p) => p.name).join(', ') || 'No pages'}</span></div>
              <ul className="tf-bkf__list-plain">
                {g.members.map((m) => {
                  const theirs = state.meetings.filter((x) => x.host === m.name && x.status !== 'cancelled' && x.start > now && pages.some((p) => p.id === x.pageId));
                  return (
                    <li key={m.name} className="tf-bkf-group__member">
                      <span className="tf-bkf__host"><Avatar name={m.name} size={20} />{m.name}</span>
                      {m.paused && <Tag size="sm" status="waiting">Paused</Tag>}
                      <span className="tf-bkf__spacer" />
                      {m.paused && theirs.length > 0 && (
                        <Button size="sm" variant="ghost" onPress={() => onHandOn(theirs)}>Hand on {plural(theirs.length, 'meeting')}</Button>
                      )}
                      <Switch isSelected={!m.paused} onChange={(on) => setPaused(g.id, m.name, !on)}>Taking meetings</Switch>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
