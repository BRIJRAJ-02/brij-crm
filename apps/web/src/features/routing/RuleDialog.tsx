// Brief
// Purpose: make or change one routing rule (spec 0043, AC-1601, AC-1604, AC-1608): when these answers or fields match, then this route, with a tag.
// Main task: set the conditions, where the lead goes (a booking page and who can take it, a message, a web page; on a team page, who can take it: named people or members with skills) and Qualified or not.
// Leaves out: the order of rules and removing one (the list's menu), and the report (beside the list).
import type { BookingPageView, MemberSkills, Route, RouteHosts, RoutingRule, RoutingSkill } from '@crm/data';
import { namedHosts, REQUIRED_SKILLS_MAX, requiredSkills } from '@crm/data/forms';
import { Button, Callout, ChoiceChips, Field, Modal, SegmentedControl, Select, SettingsStack } from '@crm/ui';
import { useState } from 'react';
import { ConditionsEditor, firstConditions } from './ConditionsEditor.tsx';
import { isComplete, storedShowWhen, type Fact } from './facts.ts';
import { strings } from './strings.ts';

/** Someone a route may narrow to. */
export interface PoolMember {
  readonly id: string;
  readonly name: string;
}

/** Where a surface's rules may send a lead. */
export type RuleSurface =
  | {
      readonly kind: 'form';
      /** The booking pages the reader may send visitors on to. */
      readonly pages: readonly BookingPageView[];
      /** A team page's people (its rotations' members); empty for a personal page. */
      readonly poolOf: (pageId: string) => readonly PoolMember[];
    }
  | {
      readonly kind: 'page';
      /** The team page itself: its Routing card reads the page's rules from the data layer by it. */
      readonly pageId: string;
      readonly pool: readonly PoolMember[];
    };

/** Props for RuleDialog. */
export interface RuleDialogProps {
  readonly isOpen: boolean;
  /** The rule being changed, or undefined for a new one. */
  readonly rule?: RoutingRule;
  /** Its place in the list, for its title. */
  readonly index: number;
  readonly surface: RuleSurface;
  readonly facts: readonly Fact[];
  readonly factLabel: string;
  readonly isBusy?: boolean;
  /** A refusal from saving, shown at the top. */
  readonly failure?: string;
  /** The workspace's skills and who holds them (spec 0037, AC-1356), for "Members with skills"; absent: people only. */
  readonly skills?: { readonly skills: readonly RoutingSkill[]; readonly members: readonly MemberSkills[] };
  readonly onSave: (rule: RoutingRule) => void;
  readonly onClose: () => void;
}

/** A skill's group, as the picker heads it. */
const GROUP_NAMES: Readonly<Record<RoutingSkill['group'], string>> = {
  language: 'Language',
  region: 'Region',
  segment: 'Segment',
  product: 'Product',
  other: 'Other',
};

/** Members with skills: the route's hosts requiring `ids`, or none when no skill is picked. */
const skillHosts = (ids: readonly string[]): RouteHosts | undefined =>
  ids.length === 0 ? undefined : { requireSkillIds: [...ids], ifNoneFree: 'whole_rotation' };

type Tag = 'none' | 'yes' | 'no';

/** The route a new rule starts with. */
function firstRoute(surface: RuleSurface): Route {
  if (surface.kind === 'page') return { kind: 'hosts', hosts: [] };
  const [page] = surface.pages;
  return page === undefined ? { kind: 'message', message: '' } : { kind: 'book', bookingPageId: page.id, message: '' };
}

/** True when an address is one a rule may send to: https, or http on localhost. */
function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
}

/** The dialog: its own draft of the rule, kept until Save or Cancel. Mounted fresh each time it opens. */
export function RuleDialog(props: RuleDialogProps) {
  return props.isOpen ? <RuleDialogBody {...props} /> : null;
}

function RuleDialogBody({
  rule,
  index,
  surface,
  facts,
  factLabel,
  isBusy = false,
  failure,
  skills,
  onSave,
  onClose,
}: RuleDialogProps) {
  const [name, setName] = useState(rule?.name ?? '');
  const [when, setWhen] = useState(rule?.when ?? firstConditions(facts));
  const [route, setRoute] = useState<Route>(rule?.then ?? firstRoute(surface));
  const [tag, setTag] = useState<Tag>(rule?.qualified === undefined ? 'none' : rule.qualified ? 'yes' : 'no');
  const [shown, setShown] = useState<string | undefined>();

  const pool =
    surface.kind === 'page' ? surface.pool : route.kind === 'book' ? surface.poolOf(route.bookingPageId) : [];
  const routeHosts: RouteHosts | undefined =
    route.kind === 'book' ? route.hosts : route.kind === 'hosts' ? route.hosts : undefined;
  const hosts = namedHosts(routeHosts) ?? [];
  const skillIds = requiredSkills(routeHosts) ?? [];
  // People or skills (spec 0037, AC-1356): skills are offered once the workspace has some, or the rule names them.
  const [by, setBy] = useState<'people' | 'skills'>(requiredSkills(routeHosts) === undefined ? 'people' : 'skills');
  const offersSkills = (skills?.skills.length ?? 0) > 0 || by === 'skills';
  const holders = pool.filter((member) => {
    const held = skills?.members.find((each) => each.memberId === member.id)?.skillIds ?? [];
    return skillIds.length > 0 && skillIds.every((id) => held.includes(id));
  });

  const problem = (): string | undefined => {
    if (!isComplete(when)) return strings.conditionsIncomplete;
    if (route.kind === 'redirect' && !isWebAddress(route.url)) return strings.urlInvalid;
    if (route.kind === 'hosts' && pool.length === 0) return strings.poolEmpty;
    if (route.kind === 'hosts' && by === 'skills' && skillIds.length === 0) return strings.skillsNeeded;
    if (route.kind === 'hosts' && by === 'people' && hosts.length === 0) return strings.hostsNeeded;
    return undefined;
  };

  const save = () => {
    const found = problem();
    setShown(found);
    if (found !== undefined) return;
    const trimmed = name.trim();
    onSave({
      id: rule?.id ?? crypto.randomUUID(),
      ...(trimmed === '' ? {} : { name: trimmed }),
      when: storedShowWhen(when),
      then: route,
      ...(tag === 'none' ? {} : { qualified: tag === 'yes' }),
    });
  };

  /** The route's hosts, replaced: named people, members with skills, or (a form's route only) nobody narrowed. */
  const setRouteHosts = (next: RouteHosts | undefined) => {
    if (route.kind === 'hosts') setRoute({ kind: 'hosts', hosts: next ?? [] });
    if (route.kind === 'book') {
      const { hosts: _old, ...rest } = route;
      setRoute(next === undefined ? rest : { ...rest, hosts: next });
    }
  };
  const setHosts = (picked: readonly string[]) => setRouteHosts(picked.length === 0 ? undefined : [...picked]);
  const setSkills = (picked: readonly string[]) => setRouteHosts(skillHosts(picked.slice(0, REQUIRED_SKILLS_MAX)));

  const title = rule === undefined ? strings.newRule : strings.editRule(strings.ruleTitle(index, rule.name));
  const message = failure ?? shown;

  return (
    <Modal
      title={title}
      variant="window"
      isOpen
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            isPending={isBusy}
            isDisabled={surface.kind === 'page' && pool.length === 0}
            onPress={save}
          >
            {isBusy ? strings.saving : rule === undefined ? strings.addRuleAction : strings.save}
          </Button>
        </>
      }
    >
      <SettingsStack>
        {message !== undefined && <Callout tone="danger">{message}</Callout>}
        <Field
          label={strings.name}
          hint={strings.nameHint}
          placeholder={strings.namePlaceholder}
          value={name}
          onChange={setName}
        />
        <ConditionsEditor value={when} facts={facts} factLabel={factLabel} onChange={setWhen} />
        {surface.kind === 'form' && (
          <Select
            label={strings.routeKind}
            items={[
              { id: 'book', label: strings.routeBook, isDisabled: surface.pages.length === 0 },
              { id: 'message', label: strings.routeMessage },
              { id: 'redirect', label: strings.routeRedirect },
            ]}
            value={route.kind}
            {...(surface.pages.length === 0 ? { hint: strings.noPages } : {})}
            onChange={(kind) => {
              const [page] = surface.pages;
              if (kind === 'book' && page !== undefined)
                setRoute({ kind: 'book', bookingPageId: page.id, message: '' });
              if (kind === 'message') setRoute({ kind: 'message', message: '' });
              if (kind === 'redirect') setRoute({ kind: 'redirect', url: 'https://' });
            }}
          />
        )}
        {surface.kind === 'form' && route.kind === 'book' && (
          <Select
            label={strings.page}
            items={surface.pages.map((page) => ({
              id: page.id,
              label: strings.pageItem(page.title, page.durations[0] ?? 30),
            }))}
            value={route.bookingPageId}
            onChange={(pageId) => {
              if (pageId !== null) setRoute({ kind: 'book', bookingPageId: pageId, message: route.message });
            }}
          />
        )}
        {surface.kind === 'page' && pool.length === 0 && <Callout tone="info">{strings.poolEmpty}</Callout>}
        {pool.length > 0 && offersSkills && (
          <SegmentedControl
            label={strings.hostsBy}
            size="compact"
            value={by}
            onChange={(value) => {
              if (value !== 'people' && value !== 'skills') return;
              setBy(value);
              // Switching drops the other way's picks: a route names people or skills, never both.
              setRouteHosts(undefined);
            }}
            segments={[
              { value: 'people', label: strings.byPeople },
              { value: 'skills', label: strings.bySkills },
            ]}
          />
        )}
        {pool.length > 0 && by === 'people' && (
          <ChoiceChips
            label={route.kind === 'book' ? strings.hostsOptional : strings.hosts}
            choices={pool.map((member) => ({ id: member.id, label: member.name }))}
            selected={hosts}
            onChange={setHosts}
            {...(route.kind === 'hosts' && shown === strings.hostsNeeded ? { error: strings.hostsNeeded } : {})}
          />
        )}
        {pool.length > 0 && by === 'skills' && (
          <Select
            label={strings.skills}
            selectionMode="multiple"
            optionStyle="tag"
            isSearchable
            maxVisible={REQUIRED_SKILLS_MAX}
            items={(skills?.skills ?? []).map((skill) => ({
              id: skill.id,
              label: skill.name,
              group: GROUP_NAMES[skill.group],
              // Three at most: the rest wait until one is taken off.
              isDisabled: skillIds.length >= REQUIRED_SKILLS_MAX && !skillIds.includes(skill.id),
            }))}
            values={skillIds}
            onValuesChange={setSkills}
            placeholder={(skills?.skills.length ?? 0) === 0 ? strings.noSkills : undefined}
            hint={skillIds.length === 0 ? undefined : strings.heldBy(holders.map((member) => member.name))}
            {...(shown === strings.skillsNeeded ? { error: strings.skillsNeeded } : {})}
          />
        )}
        {(route.kind === 'message' || route.kind === 'book') && (
          <Field
            label={route.kind === 'book' ? strings.bookingMessage : strings.message}
            hint={strings.messageHint}
            isMultiline
            value={route.message}
            onChange={(text) => setRoute({ ...route, message: text })}
          />
        )}
        {route.kind === 'redirect' && (
          <Field
            label={strings.url}
            type="url"
            {...(shown === strings.urlInvalid ? { error: strings.urlInvalid } : {})}
            value={route.url}
            onChange={(url) => setRoute({ kind: 'redirect', url })}
          />
        )}
        <Select
          label={strings.tag}
          items={[
            { id: 'none', label: strings.tagNone },
            { id: 'yes', label: strings.tagQualified },
            { id: 'no', label: strings.tagNotQualified },
          ]}
          value={tag}
          onChange={(picked) => {
            if (picked === 'none' || picked === 'yes' || picked === 'no') setTag(picked);
          }}
        />
      </SettingsStack>
    </Modal>
  );
}
