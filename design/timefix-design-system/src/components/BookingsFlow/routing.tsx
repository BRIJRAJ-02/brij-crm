// Teams: round robin groups (Manage groups, from a page's Who) and the Routing tab (rules as sentences, skills, a Test panel, what "won" means).
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { ArrowDown, ArrowUp, CornerDownRight, FlaskConical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
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
  type BookedMeeting, type BookingsAction, type BookingsState, type Routing, type RoutingAnswers, type RoutingRule,
} from './state.ts';

const SKILLS = ['Sales', 'Support', 'Onboarding', 'Partnerships'];
const WON = [{ id: 'won', label: 'The deal moves to Won' }, { id: 'created', label: 'A deal is created' }, { id: 'held', label: 'The meeting happens' }];

/** Who on a team takes the next routed meeting: the member with that skill and the fewest upcoming meetings. */
function nextOnTeam(state: BookingsState, team: string): string | undefined {
  const members = TEAM.filter((n) => state.routing.skills[n]?.includes(team));
  const load = (n: string) => state.meetings.filter((m) => m.host === n && m.status !== 'cancelled' && m.end > new Date()).length;
  return [...members].sort((a, b) => load(a) - load(b))[0];
}

/** The Routing tab: a top-to-bottom flow of rules ending in "Otherwise", with a live Try panel beside it. */
export function RoutingTab({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const routing = state.routing;
  const { toast } = useToast();
  const set = (patch: Partial<Routing>) => dispatch({ type: 'routing/set', routing: { ...routing, ...patch } });
  const setRule = (id: string, patch: Partial<RoutingRule>) => set({ rules: routing.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const pages = state.pages.map((p) => ({ id: p.id, label: p.name }));
  const teams = SKILLS.map((s) => ({ id: s, label: s }));
  const [answers, setAnswers] = useState<RoutingAnswers>({ size: 80, region: 'eu', need: 'buy' });
  const rule = routeFor(routing, answers);
  const page = state.pages.find((p) => p.id === (rule?.pageId ?? routing.fallbackPageId));
  const who = rule ? nextOnTeam(state, rule.team) : page?.hosts[0];
  const ruleIndex = rule ? routing.rules.findIndex((r) => r.id === rule.id) + 1 : 0;
  const addRule = () => set({ rules: [...routing.rules, { id: nextId('rule'), conditions: [{ id: nextId('c'), attributeId: 'size', operator: 'gt', value: undefined }], conjunction: 'and', pageId: state.pages[0]?.id ?? '', team: 'Sales' }] });
  const move = (from: number, to: number) => {
    const rules = [...routing.rules];
    const [r] = rules.splice(from, 1);
    if (r) { rules.splice(to, 0, r); set({ rules }); }
  };
  const remove = (n: number) => {
    const before = routing;
    set({ rules: routing.rules.filter((_, i) => i !== n) });
    toast({ message: `Rule ${n + 1} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'routing/set', routing: before }) } });
  };
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<Select label="Routing form" isLabelHidden className="tf-bkf__inline-select" items={[{ id: routing.formName, label: routing.formName }]} value={routing.formName} />}
        count={plural(routing.rules.length, 'rule')}
        action={<Button variant="primary" icon={<Plus {...i14} />} onPress={addRule}>Add rule</Button>} />
      <div className="tf-bkf-routing">
        <div className="tf-bkf-cards">
          <Section title="Rules" description={`Checked top to bottom. The first match decides where the answer to ${routing.formName} books.`}>
            <ol className="tf-bkf-flow">
              {routing.rules.map((r, n) => {
                const hit = rule?.id === r.id;
                return (
                  <li key={r.id} className="tf-bkf-flow__step" data-hit={hit || undefined}>
                    <span className="tf-bkf-flow__num tf-num" aria-hidden="true">{n + 1}</span>
                    <div className="tf-bkf-flow__card">
                      <header className="tf-bkf-flow__head">
                        <span className="tf-bkf-flow__title">Rule {n + 1}</span>
                        {hit && <Tag size="sm" hue="blue">Matches the test</Tag>}
                        <span className="tf-bkf__spacer" />
                        <MenuTrigger>
                          <IconButton size="sm" label={`More for rule ${n + 1}`}><MoreHorizontal {...i16} /></IconButton>
                          <Menu aria-label={`Rule ${n + 1} actions`} placement="bottom end" onAction={(k: Key) => {
                            if (k === 'up') move(n, n - 1);
                            else if (k === 'down') move(n, n + 1);
                            else if (k === 'delete') remove(n);
                          }}>
                            <MenuItem id="up" icon={<ArrowUp {...i16} />} isDisabled={n === 0}>Move up</MenuItem>
                            <MenuItem id="down" icon={<ArrowDown {...i16} />} isDisabled={n === routing.rules.length - 1}>Move down</MenuItem>
                            <MenuSeparator />
                            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem>
                          </Menu>
                        </MenuTrigger>
                      </header>
                      <Sentence lead="When" label={`Rule ${n + 1} conditions`} attributes={ROUTING_FIELDS} conditions={r.conditions} conjunction={r.conjunction}
                        onChange={(conditions) => setRule(r.id, { conditions })} onConjunctionChange={(conjunction) => setRule(r.id, { conjunction })} />
                      <div className="tf-bkf-flow__then">
                        <span className="tf-bkf-flow__word tf-bkf-flow__word--lead">Book</span>
                        <Select label={`Rule ${n + 1} page`} isLabelHidden className="tf-bkf__inline-select" items={pages} value={r.pageId} onChange={(v) => { if (v) setRule(r.id, { pageId: v }); }} />
                        <span className="tf-bkf-flow__word">with</span>
                        <Select label={`Rule ${n + 1} team`} isLabelHidden className="tf-bkf__inline-select" items={teams} value={r.team} onChange={(v) => { if (v) setRule(r.id, { team: v }); }} />
                      </div>
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
                  <div className="tf-bkf-flow__then tf-bkf-flow__then--flush">
                    <span className="tf-bkf-flow__word">Book</span>
                    <Select label="Fallback page" isLabelHidden className="tf-bkf__inline-select" items={pages} value={routing.fallbackPageId || null} onChange={(v) => { if (v) set({ fallbackPageId: v }); }} />
                  </div>
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
            <Select label="Region" items={(ROUTING_FIELDS[1]?.options ?? []).map((o) => ({ id: o.id, label: o.label }))} value={typeof answers.region === 'string' ? answers.region : null} onChange={(v) => setAnswers((a) => ({ ...a, region: v ?? undefined }))} />
            <Select label="Looking for" items={(ROUTING_FIELDS[2]?.options ?? []).map((o) => ({ id: o.id, label: o.label }))} value={typeof answers.need === 'string' ? answers.need : null} onChange={(v) => setAnswers((a) => ({ ...a, need: v ?? undefined }))} />
          </div>
          <div className="tf-bkf-try__result" role="status" aria-live="polite">
            <span className="tf-bkf__label">Goes to</span>
            <div key={`${rule?.id ?? 'fallback'}-${page?.id ?? ''}-${who ?? ''}`} className="tf-bkf-try__dest">
              <strong className="tf-bkf-try__page">{page?.name ?? 'No page'}</strong>
              <span className="tf-bkf__muted">{rule ? `Rule ${ruleIndex} · ${rule.team} team` : 'Otherwise'}</span>
              {who && <span className="tf-bkf__host"><Avatar name={who} size={20} />{first(who)} is next</span>}
            </div>
          </div>
        </aside>
      </div>
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
