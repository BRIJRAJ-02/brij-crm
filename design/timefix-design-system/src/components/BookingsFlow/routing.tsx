// Teams: round robin groups (Manage groups, from a page's Who) and the Routing tab (rules as sentences, skills, a Test panel, what "won" means).
import { useState } from 'react';
import { ArrowRight, Plus, Route, Trash2 } from 'lucide-react';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Sentence } from '../Sentence/Sentence.tsx';
import { Select } from '../Select/Select.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import { Section, TabToolbar, i14 } from './parts.tsx';
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

/** The Routing tab. */
export function RoutingTab({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const routing = state.routing;
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
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<Select label="Routing form" isLabelHidden className="tf-bkf__inline-select" items={[{ id: routing.formName, label: routing.formName }]} value={routing.formName} />}
        count={plural(routing.rules.length, 'rule')}
        action={<Button variant="primary" icon={<Plus {...i14} />} onPress={addRule}>Add rule</Button>} />
    <div className="tf-bkf-routing">
      <div className="tf-bkf-sections">
        <Section title="Rules" description={`Answers to ${routing.formName} are checked top to bottom; the first rule that matches decides.`}>
          <ol className="tf-bkf-rules">
            {routing.rules.map((r, n) => (
              <li key={r.id} className="tf-bkf-rule" data-hit={rule?.id === r.id || undefined}>
                <div className="tf-bkf-rule__body">
                  <Sentence lead={`${n + 1}.  If`} label={`Rule ${n + 1} conditions`} attributes={ROUTING_FIELDS} conditions={r.conditions} conjunction={r.conjunction}
                    onChange={(conditions) => setRule(r.id, { conditions })} onConjunctionChange={(conjunction) => setRule(r.id, { conjunction })} />
                  <div className="tf-bkf-rule__then">
                    <span className="tf-bkf__muted">book</span>
                    <Select label="Page" isLabelHidden className="tf-bkf__inline-select" items={pages} value={r.pageId} onChange={(v) => { if (v) setRule(r.id, { pageId: v }); }} />
                    <span className="tf-bkf__muted">with</span>
                    <Select label="Team" isLabelHidden className="tf-bkf__inline-select" items={teams} value={r.team} onChange={(v) => { if (v) setRule(r.id, { team: v }); }} />
                    <Tooltip label="Delete rule"><IconButton size="sm" label={`Delete rule ${n + 1}`} onPress={() => set({ rules: routing.rules.filter((x) => x.id !== r.id) })}><Trash2 {...i14} /></IconButton></Tooltip>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="tf-bkf-rule__foot">
            <span className="tf-bkf__muted">Everyone else books</span>
            <Select label="Fallback page" isLabelHidden className="tf-bkf__inline-select" items={pages} value={routing.fallbackPageId || null} onChange={(v) => { if (v) set({ fallbackPageId: v }); }} />
          </div>
        </Section>
        <Section title="Member skills" description="Rules book a team; the member with that skill and the fewest meetings takes it.">
          <ul className="tf-bkf__list-plain">
            {TEAM.map((name) => (
              <li key={name} className="tf-bkf-skill">
                <span className="tf-bkf__host"><Avatar name={name} size={20} />{name}</span>
                <ChoiceChips label={`${name}'s skills`} isLabelHidden selectionMode="multiple" size="sm" items={SKILLS.map((s) => ({ id: s, label: s }))}
                  selectedKeys={routing.skills[name] ?? []} onSelectionChange={(keys) => set({ skills: { ...routing.skills, [name]: [...keys] } })} />
              </li>
            ))}
          </ul>
        </Section>
        <Section title="What counts as won" description="Used to tell which rules bring in business.">
          <Select label="A routed meeting is won when" className="tf-bkf__field-w" items={WON} value={routing.wonMeans} onChange={(v) => { if (v) set({ wonMeans: v }); }} />
        </Section>
      </div>
      <aside className="tf-bkf-sections tf-bkf-routing__test" aria-label="Test the rules">
        <Section title="Test" description="Fill in answers and see where they'd go.">
          <div className="tf-bkf__stack">
            <NumberField label="Team size" value={typeof answers.size === 'number' ? answers.size : Number.NaN} minValue={1} onChange={(n) => setAnswers((a) => ({ ...a, size: Number.isFinite(n) ? n : undefined }))} />
            <Select label="Region" items={(ROUTING_FIELDS[1]?.options ?? []).map((o) => ({ id: o.id, label: o.label }))} value={typeof answers.region === 'string' ? answers.region : null} onChange={(v) => setAnswers((a) => ({ ...a, region: v ?? undefined }))} />
            <Select label="Looking for" items={(ROUTING_FIELDS[2]?.options ?? []).map((o) => ({ id: o.id, label: o.label }))} value={typeof answers.need === 'string' ? answers.need : null} onChange={(v) => setAnswers((a) => ({ ...a, need: v ?? undefined }))} />
            <div className="tf-bkf-route" role="status" aria-live="polite">
              <Route {...i14} aria-hidden="true" />
              <TextSwap swapKey={`${rule?.id ?? 'fallback'}-${who ?? ''}`}>
                <span>{rule ? <>Rule {ruleIndex} matches</> : 'No rule matches'} <ArrowRight {...i14} aria-hidden="true" /> <strong>{page?.name ?? 'No page'}</strong>{rule ? <> with {rule.team}</> : ''}{who ? <> · {first(who)} is next</> : ''}</span>
              </TextSwap>
            </div>
          </div>
        </Section>
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
