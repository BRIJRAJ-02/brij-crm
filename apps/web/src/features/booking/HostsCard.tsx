// Brief
// Purpose: a team page's Hosts (spec 0029, AC-732; spec 0037, AC-1319, AC-1323, AC-1388; the owner's mock of 9 November
// 2026): who meets the guest, the teams it books one person from and who in them can be booked, who always joins, and
// how turns work (where a reschedule goes, and whether the page books only through a routing form).
// Main task: see who can be booked and whose calendar is missing; add up to 3 teams and up to 7 hosts who always join;
// pick where a reschedule goes. Each host change, and Only book through a routing form, saves at once; the reschedule
// rule waits for Save changes with the page's other settings.
// A workspace link (30 Oct 2026) leads with one switch, Include everyone in the workspace (Cal.com's "Add all team
// members"): on, it books "Everyone on the roster" and nothing else shows; off, the pickers.
// Leaves out: a team's own members, weights and how it picks (Bookings settings › Teams, linked here), and each
// member's hours (their schedules). Collective pages can't be made, so Who meets the guest only says which it is.
import { isDataError, type BookingPageView, type DataLayer, type MemberSummary, type RotationView } from '@crm/data';
import {
  Avatar,
  Button,
  ButtonLink,
  Callout,
  Card,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  RecordChip,
  Select,
  SettingsRow,
  Switch,
  Table,
  Tooltip,
  type SelectItem,
  type TableColumn,
} from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { strings as routingStrings } from '../routing/strings.ts';
import { CalendarHealthChip, useCalendarHealth, useSchedulingStore } from './CalendarHealth.tsx';
import { strings } from './rotation-strings.ts';
import { roundRobinHref } from './links.ts';
import { teamOnPage } from './team-readiness.ts';

/** The most fixed hosts, rotations, and hosts in all (spec 0037's numbers; the server checks them too). */
const LIMITS = { fixed: 7, rotations: 3, hosts: 8 } as const;

/** Props for the Hosts section. */
export interface HostsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The workspace's active members, for Add host. */
  readonly people: readonly MemberSummary[];
  /** The rotations (teams) the reader may see. */
  readonly rotations: readonly RotationView[];
  readonly isLocked: boolean;
  /** The reader's own member id, so their row reads "(you)". */
  readonly meId?: string;
  /** The draft's reschedule rule, saved with the page's other settings. */
  readonly rescheduleHost: 'same' | 'rotation';
  readonly onRescheduleChange: (value: 'same' | 'rotation') => void;
  /** A host change saved: the page as the server now has it. */
  readonly onSaved: (page: BookingPageView) => void;
  /** The page's routing rules (RulesCard), drawn after How turns work. */
  readonly rules?: ReactNode;
}

const WHO_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.member, isRowHeader: true },
  { id: 'on', label: strings.columns.on, align: 'end' },
];

/** The most people listed before "and N more": a roster can hold the whole workspace. */
const WHO_SHOWN = 8;

/** A team's way of picking, as Next booking goes to says it. */
const pickWord = (strategy: RotationView['strategy'] | undefined) =>
  strategy === 'priority' ? strings.host.priority : strings.host.fewest;

/** The Hosts section: who meets the guest, Teams, Always included, How turns work, then the routing rules. */
export function HostsCard({
  data,
  slug,
  page,
  people,
  rotations,
  isLocked,
  meId,
  rescheduleHost,
  onRescheduleChange,
  onSaved,
  rules,
}: HostsCardProps) {
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Removing a host or a team ends something, so it asks first (house rule).
  const [confirming, setConfirming] = useState<
    { readonly kind: 'fixed' | 'rotation'; readonly id: string } | undefined
  >(undefined);
  // Which team's people show under it.
  const [openTeam, setOpenTeam] = useState<string | undefined>(undefined);
  // Only book through a routing form, as switched before the server answered.
  const [formOnlyShown, setFormOnlyShown] = useState<boolean | undefined>(undefined);
  const fixed = page.hosts?.fixed ?? [];
  const linked = page.hosts?.rotations ?? [];
  const nameOf = (memberId: string) => people.find((person) => person.id === memberId)?.name ?? '';
  const rotationName = (rotationId: string) => rotations.find((each) => each.id === rotationId)?.name ?? '';
  const isFull = fixed.length + linked.length >= LIMITS.hosts;
  // A workspace link books "Everyone on the roster" while its one switch is on; off, its hosts are picked as on any page.
  const isWorkspace = page.scope === 'workspace';
  const roster = rotations.find((each) => each.follows === 'everyone');
  const followsEveryone = roster !== undefined && fixed.length === 0 && linked.length === 1 && linked[0] === roster.id;
  const [isPicking, setPicking] = useState(false);
  const isEveryone = isWorkspace && followsEveryone && !isPicking;
  const { groups } = teamOnPage(page, rotations);
  const healthStore = useSchedulingStore(data);
  const health = useCalendarHealth(
    healthStore,
    slug,
    groups.flatMap((group) => group.members.map((member) => member.memberId)),
  );
  const teamsLeft = rotations.filter((each) => !linked.includes(each.id) && each.follows !== 'everyone');
  const peopleLeft = people.filter((person) => !fixed.includes(person.id));
  const formOnly = formOnlyShown ?? page.formOnly;

  /** Saves the hosts; true once the server has them. */
  const save = (next: {
    readonly fixed: readonly string[];
    readonly rotations: readonly string[];
  }): Promise<boolean> => {
    if (isSaving) return Promise.resolve(false);
    setSaving(true);
    setFailure(undefined);
    return data.bookingPages
      .update(slug, page.id, {}, { hosts: { fixed: [...next.fixed], rotations: [...next.rotations] } })
      .then(
        (saved) => {
          setSaving(false);
          onSaved(saved);
          return true;
        },
        (error: unknown) => {
          setSaving(false);
          setFailure(isDataError(error) ? error.message : strings.somethingWrong);
          return false;
        },
      );
  };
  const move = (index: number, by: -1 | 1) => {
    const other = index + by;
    const here = fixed[index];
    const there = fixed[other];
    if (here === undefined || there === undefined) return;
    void save({
      fixed: fixed.map((each, at) => (at === index ? there : at === other ? here : each)),
      rotations: linked,
    });
  };
  const confirmRemove = () => {
    if (confirming === undefined) return;
    const next =
      confirming.kind === 'fixed'
        ? { fixed: fixed.filter((each) => each !== confirming.id), rotations: linked }
        : { fixed, rotations: linked.filter((each) => each !== confirming.id) };
    void save(next).then((saved) => {
      // A refusal stays in the dialog, saying why.
      if (saved) setConfirming(undefined);
    });
  };
  const switchFormOnly = (next: boolean) => {
    // One host change at a time: a second waits until the first has answered.
    if (isSaving) return;
    setFormOnlyShown(next);
    setSaving(true);
    setFailure(undefined);
    data.bookingPages.update(slug, page.id, { formOnly: next }).then(
      (saved) => {
        setSaving(false);
        setFormOnlyShown(undefined);
        onSaved(saved);
      },
      (error: unknown) => {
        setSaving(false);
        setFormOnlyShown(undefined);
        setFailure(isDataError(error) ? error.message : routingStrings.formOnlyFailed);
      },
    );
  };
  const teamItems = (keep: string): SelectItem[] =>
    rotations
      .filter((each) => each.id === keep || (!linked.includes(each.id) && each.follows !== 'everyone'))
      .map((each) => ({
        id: each.id,
        label: each.name,
        description: strings.peopleCount(each.members.length),
      }));
  const isTeamPage = page.kind === 'round_robin';
  const firstTeam = rotations.find((each) => each.id === linked[0]);

  return (
    <>
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <Card>
        {/* The page's kind is set when it is made (a collective page can't be made yet), so it is said, not offered. */}
        <SettingsRow
          title={strings.host.whoMeets}
          meta={<InfoTip label={strings.host.whoMeets}>{strings.host.whoMeetsHelp}</InfoTip>}
          description={page.kind === 'collective' ? strings.host.together : strings.host.inTurns}
        />
        {/* Only on the page that books everyone (or was just switched off it): every team page shares the workspace's
            scope, and on one that books a team, one press would drop its team and its hosts unasked. */}
        {isWorkspace && roster !== undefined && (followsEveryone || isPicking) && (
          <Switch
            label={strings.everyoneSwitch}
            {...(isEveryone
              ? { description: strings.everyoneSwitchOn(roster.members.filter((each) => each.isOn).length) }
              : {})}
            isSelected={isEveryone}
            isReadOnly={isLocked}
            isDisabled={isSaving}
            onChange={(isOn) => {
              if (!isOn) {
                setPicking(true);
                return;
              }
              void save({ fixed: [], rotations: [roster.id] }).then((saved) => {
                if (saved) setPicking(false);
              });
            }}
          />
        )}
        {!isEveryone && (
          <Card tone="sunken">
            <p>
              {strings.host.summary(
                fixed.map(nameOf).filter((name) => name !== ''),
                linked.map(rotationName).filter((name) => name !== ''),
              )}
            </p>
          </Card>
        )}
      </Card>
      {!isEveryone && isTeamPage && (
        <Card
          title={strings.host.teams}
          description={strings.host.teamsLine}
          actions={
            <>
              <ButtonLink href={roundRobinHref(slug)} variant="ghost" iconRight="arrow-right">
                {strings.host.manageTeams}
              </ButtonLink>
              {!isLocked && (
                <MenuTrigger>
                  <Button
                    icon="plus"
                    isDisabled={isSaving || linked.length >= LIMITS.rotations || isFull || teamsLeft.length === 0}
                  >
                    {strings.host.addTeam}
                  </Button>
                  <Menu
                    label={strings.host.addTeam}
                    onAction={(key) => {
                      void save({ fixed, rotations: [...linked, String(key)] });
                    }}
                  >
                    {teamsLeft.map((team) => (
                      <MenuItem key={team.id} id={team.id} description={strings.peopleCount(team.members.length)}>
                        {team.name}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              )}
            </>
          }
        >
          {linked.length === 0 ? (
            <p>{strings.host.noTeams}</p>
          ) : (
            linked.map((rotationId, index) => {
              const team = rotations.find((each) => each.id === rotationId);
              const members = team?.members ?? [];
              const onCount = members.filter((member) => member.isOn).length;
              const isOpen = openTeam === rotationId;
              return (
                <SettingsRow
                  key={rotationId}
                  title={strings.host.teamAt(index)}
                  control="field"
                  {...(isOpen && members.length > 0
                    ? {
                        description: (
                          <Table
                            label={strings.whoIsOn}
                            isScrollable
                            columns={WHO_COLUMNS}
                            rows={members.slice(0, WHO_SHOWN)}
                            getRowId={(row) => row.memberId}
                            {...(members.length > WHO_SHOWN
                              ? { footer: strings.andMore(members.length - WHO_SHOWN) }
                              : {})}
                            renderCell={(row, column) =>
                              column === 'name' ? (
                                <>
                                  <RecordChip display={{ type: 'member', id: row.memberId, name: row.name }} isFlat />
                                  <CalendarHealthChip
                                    state={health.get(row.memberId)}
                                    name={row.name}
                                    isQuiet
                                    showsHidden
                                  />
                                </>
                              ) : row.isOn ? (
                                strings.isOn
                              ) : (
                                strings.isOff
                              )
                            }
                          />
                        ),
                      }
                    : {})}
                >
                  <Select
                    savesOnPick
                    label={strings.host.teamAt(index)}
                    isLabelHidden
                    items={teamItems(rotationId)}
                    value={rotationId}
                    isReadOnly={isLocked}
                    isDisabled={isSaving}
                    onChange={(next) => {
                      if (next === null || next === rotationId) return;
                      void save({ fixed, rotations: linked.map((each) => (each === rotationId ? next : each)) });
                    }}
                  />
                  <Button
                    variant="ghost"
                    iconRight={isOpen ? 'chevron-up' : 'chevron-down'}
                    isExpanded={isOpen}
                    onPress={() => setOpenTeam(isOpen ? undefined : rotationId)}
                  >
                    {strings.host.bookable(onCount, members.length)}
                  </Button>
                  {!isLocked && linked.length > 1 && (
                    <Tooltip content={strings.host.stopTeamTip}>
                      <Button
                        variant="ghost-danger"
                        icon="trash"
                        label={strings.host.stopTeam(team?.name ?? '')}
                        isDisabled={isSaving}
                        onPress={() => setConfirming({ kind: 'rotation', id: rotationId })}
                      />
                    </Tooltip>
                  )}
                </SettingsRow>
              );
            })
          )}
        </Card>
      )}
      {!isEveryone && (
        <Card
          title={strings.host.always}
          description={strings.host.alwaysLine}
          {...(isLocked
            ? {}
            : {
                actions: (
                  <MenuTrigger>
                    <Button
                      icon="plus"
                      isDisabled={isSaving || fixed.length >= LIMITS.fixed || isFull || peopleLeft.length === 0}
                    >
                      {strings.host.addHost}
                    </Button>
                    <Menu
                      label={strings.host.addHost}
                      onAction={(key) => {
                        void save({ fixed: [...fixed, String(key)], rotations: linked });
                      }}
                    >
                      {peopleLeft.map((person) => (
                        <MenuItem
                          key={person.id}
                          id={person.id}
                          leading={<Avatar name={person.name} size="xs" isDecorative />}
                          description={person.email}
                        >
                          {person.name}
                        </MenuItem>
                      ))}
                    </Menu>
                  </MenuTrigger>
                ),
              })}
        >
          {fixed.length === 0 ? (
            <p>{strings.host.noOne}</p>
          ) : (
            fixed.map((memberId, index) => (
              <SettingsRow
                key={memberId}
                title={memberId === meId ? strings.host.you(nameOf(memberId)) : nameOf(memberId)}
                leading={<Avatar name={nameOf(memberId)} size="md" isDecorative />}
                leadingAlign="center"
              >
                {!isLocked && (
                  <MenuTrigger>
                    <Button variant="ghost" icon="ellipsis" label={strings.host.hostActions(nameOf(memberId))} />
                    <Menu
                      label={strings.host.hostActions(nameOf(memberId))}
                      onAction={(key) => {
                        if (key === 'up') move(index, -1);
                        if (key === 'down') move(index, 1);
                        if (key === 'remove') setConfirming({ kind: 'fixed', id: memberId });
                      }}
                    >
                      <MenuItem id="up" icon="arrow-up" isDisabled={index === 0}>
                        {strings.host.moveUp}
                      </MenuItem>
                      <MenuItem id="down" icon="arrow-down" isDisabled={index === fixed.length - 1}>
                        {strings.host.moveDown}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem id="remove" icon="trash" isDanger>
                        {strings.host.remove}
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                )}
              </SettingsRow>
            ))
          )}
        </Card>
      )}
      {isTeamPage && (
        <Card title={strings.host.turns}>
          <SettingsRow
            title={strings.host.nextGoesTo}
            meta={<InfoTip label={strings.host.nextGoesTo}>{strings.host.setByTeam}</InfoTip>}
            description={pickWord(firstTeam?.strategy)}
          />
          <SettingsRow title={strings.host.ifReschedules}>
            <Select
              label={strings.host.ifReschedules}
              isLabelHidden
              variant="inline"
              optionDescription="below"
              items={[
                { id: 'same', label: strings.host.keepSame, description: strings.host.keepSameLine },
                { id: 'rotation', label: strings.host.pickAgain },
              ]}
              value={rescheduleHost}
              isReadOnly={isLocked}
              onChange={(value) => {
                if (value === 'same' || value === 'rotation') onRescheduleChange(value);
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={strings.host.formOnly}
            meta={<InfoTip label={strings.host.formOnly}>{strings.host.formOnlyHelp}</InfoTip>}
          >
            <Switch
              label={strings.host.formOnly}
              isLabelHidden
              isSelected={formOnly}
              isReadOnly={isLocked}
              isDisabled={isSaving}
              onChange={switchFormOnly}
            />
          </SettingsRow>
        </Card>
      )}
      {isTeamPage && rules}
      <Modal
        title={
          confirming?.kind === 'rotation'
            ? strings.stopRotationTitle(rotationName(confirming.id))
            : strings.removeFixedTitle(nameOf(confirming?.id ?? ''))
        }
        variant="confirm"
        tone="danger"
        isOpen={confirming !== undefined}
        isBusy={isSaving}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSaving) setConfirming(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isSaving}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isSaving} onPress={confirmRemove}>
              {isSaving
                ? strings.removing
                : confirming?.kind === 'rotation'
                  ? strings.stopRotationAction
                  : strings.removeFixedAction}
            </Button>
          </>
        }
      >
        {failure ?? (confirming?.kind === 'rotation' ? strings.stopRotationText : strings.removeFixedText)}
      </Modal>
    </>
  );
}
